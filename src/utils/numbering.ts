import { DEFAULT_TEMPLATE } from '~/constants/numbering';
import { zeroPadded } from '~/utils/locales';

import type { Supplier } from '~/schemas/suppliers';

const YEAR_MARK = '{RRRR}';
const SEQUENCE_MARK = /\{N+\}/;
const MAX_SEQUENCE = 4_294_967_295;

export function templateOf(supplier: Supplier | null | undefined): string {
	return supplier?.invoiceNumberFormat.trim() || DEFAULT_TEMPLATE;
}

export function validateTemplate(template: string): string | null {
	if (!template.includes(YEAR_MARK)) {
		return (
			'Šablona musí obsahovat {RRRR} (rok). Bez roku by se v lednu začalo ' +
			'od jedničky a čísla by se opakovala.'
		);
	}
	if (template.indexOf(YEAR_MARK) !== template.lastIndexOf(YEAR_MARK)) {
		return 'Šablona smí obsahovat {RRRR} jen jednou.';
	}

	const sequence = template.match(SEQUENCE_MARK);
	if (!sequence) return 'Šablona musí obsahovat {NNNN} (pořadí v roce).';
	const width = sequence[0].length - 2;
	if (width > 9) return 'Pořadí {N…} smí mít nejvýš 9 míst.';

	if (template.split(SEQUENCE_MARK).length > 2) {
		return 'Šablona smí obsahovat pořadí {NNNN} jen jednou.';
	}

	// Nastavení musí říct „tahle šablona nepůjde uložit" hned, ne až u první faktury.
	for (const seq of [1, 999_999_999]) {
		const sample = formatNumber(template, 2026, seq);
		const error = validateNumber(sample);
		if (error) return `Šablona vyrábí nepoužitelné číslo (${sample}): ${error}`;
	}

	// Banka odmítne variabilní symbol delší než deset číslic. Měří se na nejvyšším čísle, které se
	// vejde do deklarované šířky {N…}, ne na stresovém vzorku výše.
	const withinWidth = formatNumber(template, 2026, 10 ** width - 1);
	const digitCount = withinWidth.replace(/\D/g, '').length;
	if (digitCount > 10) {
		return `Šablona vyrábí číslo s víc než deseti číslicemi (${withinWidth}) — tolik jich neunese variabilní symbol.`;
	}
	return null;
}

export function formatNumber(template: string, year: number, seq: number): string {
	return template.replace(YEAR_MARK, String(year)).replace(SEQUENCE_MARK, (mark) => zeroPadded(seq, mark.length - 2));
}

export function parseSeq(template: string, year: number, number: string): number | null {
	const match = numberPattern(template, year)?.exec(number.trim());
	if (!match) return null;
	const seq = Number(match[1]);
	return seq <= MAX_SEQUENCE ? seq : null;
}

// Rok se nechává libovolný: číslo s jiným rokem letošní řadu nerozbije, `parseSeq` ho počítá do té své.
// Pořadí nad `MAX_SEQUENCE` ale `parseSeq` zahodí a řada by po něm začala od jedničky.
export function fitsTemplate(template: string, number: string): boolean {
	const seq = numberPattern(template)?.exec(number)?.[1];
	// Stryker disable next-line ConditionalExpression: ekvivalentní mutant, `Number(undefined)` je NaN a strop nesplní taky.
	return seq !== undefined && Number(seq) <= MAX_SEQUENCE;
}

function numberPattern(template: string, year?: number): RegExp | null {
	// Stryker disable next-line ConditionalExpression: ekvivalentní mutant, vzor bez skupiny pořadí dá NaN a oba volající ho odmítnou.
	if (!SEQUENCE_MARK.test(template)) return null;
	const pattern = template
		.split(/(\{RRRR\}|\{N+\})/)
		.map((part) => {
			if (part === YEAR_MARK) return year === undefined ? '\\d{4}' : String(year);
			if (SEQUENCE_MARK.test(part)) return '(\\d+)';
			return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		})
		.join('');
	return new RegExp(`^${pattern}$`);
}

// `startNumber` je podlaha řady platná jen pro rok, který obsahuje.
export function nextNumber(existing: string[], year: number, template: string, startNumber: string): string {
	return formatNumber(template, year, nextSeq(existing, year, template, startNumber));
}

function nextSeq(existing: string[], year: number, template: string, startNumber: string): number {
	const max = existing.reduce((highest, number) => {
		const sequence = parseSeq(template, year, number);
		return Math.max(highest, sequence ?? 0);
	}, 0);

	const entered = parseSeq(template, year, startNumber);
	return Math.max(max + 1, entered ?? 1);
}

// Při změně šablony se pořadí nesmí vrátit k již použitým číslům.
export function continuedStart(
	existing: string[],
	year: number,
	previousTemplate: string,
	template: string,
	startNumber: string,
): string | null {
	const previous = nextSeq(existing, year, previousTemplate, startNumber);
	if (previous <= nextSeq(existing, year, template, startNumber)) return null;
	return formatNumber(template, year, previous);
}

const NUMBER_SHAPE = /^[A-Za-z0-9]([A-Za-z0-9 ._-]{0,62}[A-Za-z0-9])?$/;

/** Stejnou funkcí kontroluje číslo i backend; případy drží `fixtures/document-number-parity.json`. */
export function validateNumber(number: string): string | null {
	if (!number.trim()) return 'Číslo dokladu je povinné.';
	if (!NUMBER_SHAPE.test(number)) {
		return 'Číslo dokladu může mít nejvýš 64 znaků: písmena bez diakritiky, číslice, mezery, tečky, pomlčky a podtržítka, a musí začínat i končit písmenem nebo číslicí.';
	}
	return null;
}
