import { array, assert, boolean, constantFrom, integer, pre, property, string, tuple } from 'fast-check';
import { describe, expect, it } from 'vitest';

import { DEFAULT_TEMPLATE } from '~/constants/numbering';
import { emptySupplier } from '~/schemas/suppliers';
import parity from '~/utils/fixtures/document-number-parity.json';
import {
	continuedStart,
	fitsTemplate,
	formatNumber,
	nextNumber,
	parseSeq,
	templateOf,
	validateNumber,
	validateTemplate,
} from '~/utils/numbering';

describe('templateOf', () => {
	it('prázdná šablona i chybějící dodavatel znamenají výchozí', () => {
		expect(templateOf(null)).toBe(DEFAULT_TEMPLATE);
		expect(
			templateOf({
				...emptySupplier(),
				invoiceNumberFormat: '  ',
			}),
		).toBe(DEFAULT_TEMPLATE);
		expect(
			templateOf({
				...emptySupplier(),
				invoiceNumberFormat: ' F{RRRR}-{NNN} ',
			}),
		).toBe('F{RRRR}-{NNN}');
	});
});

describe('fitsTemplate', () => {
	it('přijme číslo z řady v libovolném roce a s přetečenou šířkou', () => {
		expect(fitsTemplate(DEFAULT_TEMPLATE, '20260137')).toBe(true);
		expect(fitsTemplate(DEFAULT_TEMPLATE, '20250099')).toBe(true);
		expect(fitsTemplate(DEFAULT_TEMPLATE, '202612345')).toBe(true);
		expect(fitsTemplate('F{RRRR}-{NNN}', 'F2026-007')).toBe(true);
		expect(fitsTemplate('FA-{NNNNN}-{RRRR}', 'FA-00003-2026')).toBe(true);
		expect(fitsTemplate('F-{NNN}{RRRR}', 'F-0072026')).toBe(true);
		expect(fitsTemplate(DEFAULT_TEMPLATE, '20264294967295')).toBe(true);
	});

	it('odmítne pořadí, které řada nepřečte', () => {
		expect(fitsTemplate(DEFAULT_TEMPLATE, '20264294967296')).toBe(false);
	});

	it('odmítne číslo mimo tvar šablony', () => {
		expect(fitsTemplate(DEFAULT_TEMPLATE, 'F2026-001')).toBe(false);
		expect(fitsTemplate(DEFAULT_TEMPLATE, '2026')).toBe(false);
		expect(fitsTemplate(DEFAULT_TEMPLATE, '2026-0001')).toBe(false);
		expect(fitsTemplate('F{RRRR}-{NNN}', 'X2026-007')).toBe(false);
		expect(fitsTemplate('F{RRRR}-{NNN}', 'F2026-')).toBe(false);
		expect(fitsTemplate('F{RRRR}-{NNN}', 'F2026-007x')).toBe(false);
		expect(fitsTemplate('F{RRRR}-{NNN}', 'xF2026-007')).toBe(false);
	});

	it('znaky šablony bere doslova, ne jako regulární výraz', () => {
		expect(fitsTemplate('F.{RRRR}.{NNN}', 'F.2026.007')).toBe(true);
		expect(fitsTemplate('F.{RRRR}.{NNN}', 'FX2026X007')).toBe(false);
	});

	it('šablona bez pořadí nepřijme nic', () => {
		expect(fitsTemplate('{RRRR}', '2026')).toBe(false);
	});
});

describe('formatNumber', () => {
	it('výchozí šablona dává původní formát', () => {
		expect(formatNumber(DEFAULT_TEMPLATE, 2026, 1)).toBe('20260001');
		expect(formatNumber(DEFAULT_TEMPLATE, 2026, 137)).toBe('20260137');
		expect(formatNumber(DEFAULT_TEMPLATE, 2027, 1)).toBe('20270001');
	});

	it('umí vlastní text i šířku pořadí', () => {
		expect(formatNumber('F{RRRR}-{NNN}', 2026, 7)).toBe('F2026-007');
		expect(formatNumber('{RRRR}_{NN}', 2026, 42)).toBe('2026_42');
		expect(formatNumber('FA-{NNNNN}-{RRRR}', 2026, 3)).toBe('FA-00003-2026');
	});

	it('přetečení šířky číslo neořízne', () => {
		expect(formatNumber('{RRRR}{NN}', 2026, 100)).toBe('2026100');
		expect(formatNumber(DEFAULT_TEMPLATE, 2026, 12345)).toBe('202612345');
	});

	it('šablona bez pořadí jen doplní rok', () => {
		expect(formatNumber('{RRRR}{NX}', 2026, 7)).toBe('2026{NX}');
	});
});

describe('parseSeq', () => {
	it.each([
		['{NN}-{RRRR}', '07-2026', 7],
		['1{NN}{RRRR}9', '10720269', 7],
		['F.{RRRR}.{NN}.9', 'F.2026.07.9', 7],
		['{RRRR}-{N}', '2026-0', 0],
	])('čtení i kontrola tvaru rozumí šabloně %s', (template, number, sequence) => {
		expect(formatNumber(template, 2026, sequence)).toBe(number);
		expect(fitsTemplate(template, number)).toBe(true);
		expect(parseSeq(template, 2026, number)).toBe(sequence);
		expect(parseSeq(template, 2027, number)).toBeNull();
	});

	it('oddělovače bere doslova a pořadí tvoří jen číslice ASCII', () => {
		for (const number of ['F-2026-007', 'F.2026.0\n7', 'F.2026.００７', 'F.2026.7.5']) {
			expect(fitsTemplate('F.{RRRR}.{NNN}', number), number).toBe(false);
			expect(parseSeq('F.{RRRR}.{NNN}', 2026, number), number).toBeNull();
		}
	});

	it('vytáhne pořadí jen pro správný rok', () => {
		expect(parseSeq(DEFAULT_TEMPLATE, 2026, '20260137')).toBe(137);
		expect(parseSeq(DEFAULT_TEMPLATE, 2027, '20260137')).toBeNull();
		expect(parseSeq('F{RRRR}-{NNN}', 2026, 'F2026-007')).toBe(7);
		expect(parseSeq('F{RRRR}-{NNN}', 2026, '2026007')).toBeNull();
		expect(parseSeq(DEFAULT_TEMPLATE, 2026, '2026ABCD')).toBeNull();
		expect(parseSeq(DEFAULT_TEMPLATE, 2026, '202600011')).toBe(11);
	});

	it('odmítne číslo mimo šablonu', () => {
		expect(parseSeq('F{RRRR}-{NNN}', 2026, 'X2026-007')).toBeNull();
		expect(parseSeq('F{RRRR}-{NNN}', 2026, 'F2026-abc')).toBeNull();
		expect(parseSeq(DEFAULT_TEMPLATE, 2026, '2026-007')).toBeNull();
		expect(parseSeq(DEFAULT_TEMPLATE, 2026, '20261e2')).toBeNull();
		expect(parseSeq(DEFAULT_TEMPLATE, 2026, 'x20260007')).toBeNull();
		expect(parseSeq(DEFAULT_TEMPLATE, 2026, '20260007x')).toBeNull();
		expect(parseSeq('F{RRRR}-{NNN}', 2026, 'F2026-')).toBeNull();
		expect(parseSeq('F{RRRR}-{NNN}', 2026, 'F2026-007')).toBe(7);
	});

	it('šablona bez pořadí nemá co vytáhnout', () => {
		expect(parseSeq('{RRRR}', 2026, '2026')).toBeNull();
	});

	it('okrajové mezery kolem čísla nevadí', () => {
		expect(parseSeq(DEFAULT_TEMPLATE, 2026, '  20260137  ')).toBe(137);
	});

	it('šablona bez přípony pořadí neusekne', () => {
		expect(parseSeq('F-{NNN}{RRRR}', 2026, 'F-0072026')).toBe(7);
	});

	it('nesedící text za pořadím číslo odmítne', () => {
		expect(parseSeq('F-{NNN}{RRRR}', 2026, 'F-0072027')).toBeNull();
	});

	it('nesmyslně vysoké pořadí se neuzná', () => {
		expect(parseSeq('{RRRR}{NNNNNNNNNN}', 2026, '20264294967295')).toBe(4_294_967_295);
		expect(parseSeq('{RRRR}{NNNNNNNNNN}', 2026, '20264294967296')).toBeNull();
	});
});

describe('nextNumber', () => {
	it('pokračuje v řadě', () => {
		expect(nextNumber(['20260001', '20260005', '20250099'], 2026, DEFAULT_TEMPLATE, '')).toBe('20260006');
	});

	it('nový rok začíná od jedničky', () => {
		expect(nextNumber(['20260005'], 2027, DEFAULT_TEMPLATE, '')).toBe('20270001');
		expect(nextNumber([], 2026, DEFAULT_TEMPLATE, '')).toBe('20260001');
	});

	it('cizí názvy souborů se ignorují', () => {
		expect(nextNumber(['foo', '2026', '202600AB'], 2026, DEFAULT_TEMPLATE, '')).toBe('20260001');
	});

	it('navázání na řadu určí první číslo', () => {
		expect(nextNumber([], 2026, DEFAULT_TEMPLATE, '20260137')).toBe('20260137');
		expect(nextNumber([], 2026, 'F{RRRR}-{NNN}', 'F2026-042')).toBe('F2026-042');
	});

	it('navázání nepřepíše už vystavené', () => {
		expect(nextNumber(['20260200'], 2026, DEFAULT_TEMPLATE, '20260137')).toBe('20260201');
	});

	it('navázání neplatí pro další rok', () => {
		expect(nextNumber([], 2027, DEFAULT_TEMPLATE, '20260137')).toBe('20270001');
	});

	it('nesmyslné navázání se ignoruje', () => {
		for (const start of ['nesmysl', '', 'F2026-042']) {
			expect(nextNumber([], 2026, DEFAULT_TEMPLATE, start), start).toBe('20260001');
		}
	});

	it('navázání na jedničku řadu neposune', () => {
		expect(nextNumber([], 2026, DEFAULT_TEMPLATE, '20260001')).toBe('20260001');
	});
});

describe('continuedStart', () => {
	it('nová šablona pokračuje za posledním číslem staré', () => {
		const used = ['20260001', '20260039', '20260040'];

		expect(continuedStart(used, 2026, DEFAULT_TEMPLATE, 'F{RRRR}-{NNN}', '')).toBe('F2026-041');
	});

	it('návrat ke staré šabloně pokračuje za čísly obou tvarů', () => {
		const used = ['20260040', 'F2026-041', 'F2026-045'];

		expect(continuedStart(used, 2026, 'F{RRRR}-{NNN}', DEFAULT_TEMPLATE, 'F2026-041')).toBe('20260046');
	});

	it('navázání ve starém tvaru se převede do nového', () => {
		expect(continuedStart([], 2026, DEFAULT_TEMPLATE, 'F{RRRR}-{NNN}', '20260137')).toBe('F2026-137');
	});

	it('navázání v novém tvaru, které stojí dál, zůstane', () => {
		expect(continuedStart(['20260040'], 2026, DEFAULT_TEMPLATE, 'F{RRRR}-{NNN}', 'F2026-100')).toBeNull();
	});

	it('navázání v novém tvaru na témže čísle zůstane', () => {
		expect(continuedStart(['20260040'], 2026, DEFAULT_TEMPLATE, 'F{RRRR}-{NNN}', 'F2026-041')).toBeNull();
	});

	it('čísla z jiného roku řadu neposunou', () => {
		expect(continuedStart(['20250099'], 2026, DEFAULT_TEMPLATE, 'F{RRRR}-{NNN}', '')).toBeNull();
	});
});

describe('validateTemplate', () => {
	it('platné šablony projdou', () => {
		// `F{NNN}-{RRRR}` schválně: pořadí hned na druhém znaku, tedy případ, kdy se hledání tokenu
		// netrefí do nuly ani do konce řetězce.
		for (const t of [DEFAULT_TEMPLATE, 'F{RRRR}-{NNN}', '{RRRR}_{NN}', 'FA-{NNNNN}-{RRRR}', 'F{NNN}-{RRRR}']) {
			expect(validateTemplate(t), t).toBeNull();
		}
	});

	it('šablona bez roku se odmítne', () => {
		expect(validateTemplate('FA-{NNNN}')).toBe(
			'Šablona musí obsahovat {RRRR} (rok). Bez roku by se v lednu začalo od jedničky a čísla by se opakovala.',
		);
	});

	it('šablona bez pořadí se odmítne', () => {
		expect(validateTemplate('{RRRR}')).toContain('{NNNN}');
	});

	it('šablona nesmí dělat z čísla cestu', () => {
		for (const bad of ['{RRRR}/{NNNN}', '{RRRR}\\{NNNN}', '{RRRR}:{NNNN}', '../{RRRR}{NNNN}', '{RRRR}{NNNN}.']) {
			expect(validateTemplate(bad), bad).toContain('nepoužitelné číslo');
		}
	});

	it('šablona se dvěma pořadími se odmítne', () => {
		expect(validateTemplate('{NNN}-{RRRR}-{NNN}')).toContain('jen jednou');
	});

	it('šablona se dvěma roky se odmítne', () => {
		expect(validateTemplate('{RRRR}-{RRRR}-{NNNN}')).toContain('jen jednou');
	});

	it('příliš široké pořadí se odmítne', () => {
		expect(validateTemplate('{RRRR}{NNNNNNNNNN}')).toContain('9 míst');
	});

	it('šablona s víc než deseti číslicemi ve výsledném čísle se odmítne', () => {
		expect(validateTemplate('{RRRR}{NNNNNNNNN}')).toContain('víc než deseti číslicemi');
		expect(validateTemplate('{RRRR}{NNNNNN}')).toBeNull();
	});

	it('zkomolené pořadí neprojde', () => {
		for (const template of [
			'{RRRR}{}',
			'{RRRR}{NX}',
			// `N` až za nesmyslem uvnitř závorek: token musí být samé `N` celý, ne jen končit na `N`.
			'{RRRR}{NXN}',
			'{RRRR}{N',
			'{RRRR}{NN',
			'NNN}{RRRR}',
			'{RRRR}',
		]) {
			// Doslova, ne `toContain('{NNNN}')`: hláška o dvou pořadích ten kus textu obsahuje taky, takže
			// by zkomolený token prošel jako „dvě pořadí".
			expect(validateTemplate(template), template).toBe('Šablona musí obsahovat {NNNN} (pořadí v roce).');
		}
	});

	it('okrajová mezera v šabloně se odmítne', () => {
		for (const bad of ['{RRRR}{NNNN} ', ' {RRRR}{NNNN}', '{RRRR}{NNNN}\t']) {
			expect(validateTemplate(bad), bad).toContain('nepoužitelné číslo');
		}
	});

	it('každé vygenerované číslo je použitelné jako název souboru', () => {
		for (const t of [DEFAULT_TEMPLATE, 'F{RRRR}-{NNN}', '{RRRR}_{NN}', 'FA-{NNNNN}-{RRRR}']) {
			for (const seq of [1, 42, 99999, 999_999_999]) {
				expect(validateNumber(formatNumber(t, 2026, seq)), `${t}/${seq}`).toBeNull();
			}
		}
	});
});

describe('validateNumber', () => {
	it('sedí se sdílenou tabulkou', () => {
		expect(parity.cases).toHaveLength(32);
		for (const [number, expected] of parity.cases) {
			expect(validateNumber(number!), JSON.stringify(number)).toBe(expected ?? null);
		}
	});
});

// Šablona z dílů, které `NUMBER_SHAPE` pustí: písmena na krajích, mezi rokem a pořadím oddělovač.
const lettersOf = (letters: string[], maxLength: number) =>
	string({
		unit: constantFrom(...letters),
		maxLength,
	});
const template = tuple(
	lettersOf(['F', 'V', 'Z', 'a', 'b'], 3),
	constantFrom('', '-', '.', '_', ' '),
	integer({
		min: 1,
		max: 6,
	}),
	lettersOf(['X', 'y', 'z'], 2),
	boolean(),
).map(([prefix, separator, width, suffix, yearFirst]) => {
	const sequence = `{${'N'.repeat(width)}}`;
	if (yearFirst) return `${prefix}{RRRR}${separator}${sequence}${suffix}`;
	return `${prefix}${sequence}${separator}{RRRR}${suffix}`;
});
const year = integer({
	min: 1000,
	max: 9999,
});
const sequence = integer({
	min: 1,
	max: 999_999_999,
});
const upTo = (maxLength: number) => ({
	maxLength,
});

describe('číslování proti modelu řady', () => {
	it('vyrobené číslo projde kontrolou, sedí na šablonu a vrátí své pořadí', () => {
		assert(
			property(template, year, sequence, (t, y, s) => {
				expect(validateTemplate(t)).toBe(null);
				const number = formatNumber(t, y, s);
				expect(validateNumber(number)).toBe(null);
				expect(fitsTemplate(t, number)).toBe(true);
				expect(parseSeq(t, y, number)).toBe(s);
			}),
		);
	});

	it('další číslo je nejvyšší pořadí roku plus jedna, nejméně počáteční číslo', () => {
		assert(
			property(
				template,
				year,
				year,
				array(sequence, upTo(8)),
				array(sequence, upTo(4)),
				array(lettersOf(['a', 'b', 'c', ' ', '-'], 5), upTo(3)),
				tuple(constantFrom('empty', 'this year', 'other year'), sequence),
				(t, y, otherYear, used, usedOtherYear, junk, [startKind, startSeq]) => {
					pre(otherYear !== y);
					const existing = [
						...used.map((s) => formatNumber(t, y, s)),
						...usedOtherYear.map((s) => formatNumber(t, otherYear, s)),
						...junk,
					];
					const startNumber = {
						empty: '',
						'this year': formatNumber(t, y, startSeq),
						'other year': formatNumber(t, otherYear, startSeq),
					}[startKind];
					const floor = startKind === 'this year' ? startSeq : 1;
					const highest = used.reduce((max, s) => Math.max(max, s), 0);

					const next = nextNumber(existing, y, t, startNumber);
					expect(next).toBe(formatNumber(t, y, Math.max(highest + 1, floor)));
					expect(existing.includes(next)).toBe(false);
				},
			),
		);
	});
});
