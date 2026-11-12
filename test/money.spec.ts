import { array, assert, bigInt, integer, maxSafeInteger, nat, oneof, property, tuple } from 'fast-check';
import { describe, expect, it } from 'vitest';

import { MAX_CENTS } from '~/bindings';
import { invoiceTotalCents } from '~/utils/invoice';
import { czkFromCents, czkWholeFromCents, lineCents, roundCents } from '~/utils/money';
import { z } from '~/utils/zod';

const NBSP = String.fromCharCode(0x00a0);

const CAP = BigInt(MAX_CENTS);

/** Přesný model v `BigInt`: množství `digits × 10^−scale`, půlka od nuly, strop `MAX_CENTS`. */
function exactCents(digits: bigint, scale: number, cents: number): number {
	const product = digits * BigInt(cents);
	const divisor = 10n ** BigInt(scale);
	const rest = product % divisor;
	let rounded = product / divisor;
	if (2n * (rest < 0n ? -rest : rest) >= divisor) rounded += product < 0n ? -1n : 1n;
	if (rounded > CAP) return MAX_CENTS;
	if (rounded < -CAP) return -MAX_CENTS;
	return Number(rounded);
}

// Do 15 platných číslic je nejkratší zápis čísla přesně `digits × 10^−scale`, takže model i `big.js`
// násobí stejné desetinné číslo.
const quantity = tuple(
	oneof(
		integer({
			min: -1_000_000,
			max: 1_000_000,
		}).map(BigInt),
		bigInt(-(10n ** 15n) + 1n, 10n ** 15n - 1n),
	),
	nat(6),
);
const unitPrice = oneof(
	integer({
		min: -2_000_000_000,
		max: 2_000_000_000,
	}),
	maxSafeInteger(),
);

describe('roundCents', () => {
	it('zaokrouhlí na celý haléř', () => {
		expect(roundCents(120_000)).toBe(120_000);
		expect(roundCents(19.99 * 100)).toBe(1_999);
		expect(roundCents(0.1 * 100)).toBe(10);
	});
	it('nula zůstane nulou, ne -0', () => {
		expect(roundCents(0)).toBe(0);
		expect(roundCents(-0)).toBe(0);
		expect(roundCents(-0.4)).toBe(0);
	});
	it('prázdné a rozepsané pole dá nulu, ne NaN', () => {
		expect(roundCents(Number.NaN)).toBe(0);
		expect(roundCents(Number.POSITIVE_INFINITY)).toBe(0);
	});
	it('přetečení ořízne na strop', () => {
		expect(roundCents(1e300)).toBe(9_000_000_000_000);
		expect(roundCents(-1e300)).toBe(-9_000_000_000_000);
	});
});

describe('lineCents', () => {
	it('zaokrouhlí částku řádku na haléře', () => {
		expect(lineCents(3, 120_000)).toBe(360_000);
		expect(lineCents(3, 1_999)).toBe(5_997);
		expect(lineCents(1.5, 800_000)).toBe(1_200_000);
	});
	it('půl haléře zaokrouhlí od nuly, ne k +∞', () => {
		expect(lineCents(1.5, 1_999)).toBe(2_999);
		// Dobropis by jinak nesl jinou částku než formulář, ze kterého vznikl.
		expect(lineCents(1.5, -3_333)).toBe(-5_000);
		expect(lineCents(0.5, -12_345)).toBe(-6_173);
	});
	it('dobropis je přesným zrcadlem faktury', () => {
		for (const [q, p] of [
			[0.5, 12_345],
			[2.5, 101],
			[0.5, 75],
			[0.5, 3_999],
		] as const) {
			expect(lineCents(q, -p)).toBe(-lineCents(q, p));
		}
	});
	it('násobí přesně, ne v plovoucí čárce', () => {
		// 1,005 je v plovoucí čárce 1,00499…, součin by haléř ztratil.
		expect(1.005 * 100).toBeLessThan(100.5);
		expect(lineCents(1.005, 100)).toBe(101);
		expect(lineCents(0.145, -100)).toBe(-15);
		expect(lineCents(1.234, 100)).toBe(123);
	});
	it('přečte i množství zapsané s exponentem', () => {
		expect(lineCents(1e-7, 5_000_000)).toBe(1);
		expect(lineCents(1e21, 1)).toBe(9_000_000_000_000);
	});
	it('nulová částka je nula, ne -0', () => {
		expect(lineCents(-2, 0)).toBe(0);
		expect(lineCents(0, -5)).toBe(0);
	});
	it('sedí s přesným desetinným modelem', () => {
		assert(
			property(quantity, unitPrice, ([digits, scale], cents) => {
				expect(lineCents(Number(`${digits}e-${scale}`), cents)).toBe(exactCents(digits, scale, cents));
			}),
		);
	});
	it('součet faktury je součet zaokrouhlených řádků', () => {
		const lines = array(tuple(quantity, unitPrice), {
			maxLength: 20,
		});
		assert(
			property(lines, (generated) => {
				const invoice = {
					lines: generated.map(([[digits, scale], unitPriceCents]) => ({
						quantity: Number(`${digits}e-${scale}`),
						unitPriceCents,
					})),
				};
				const expected = generated.reduce(
					(sum, [[digits, scale], unitPriceCents]) => sum + exactCents(digits, scale, unitPriceCents),
					0,
				);
				expect(invoiceTotalCents(invoice)).toBe(expected);
			}),
		);
	});
	it('nekonečno a NaN nedají nesmyslnou částku', () => {
		// Množství je desetinné, takže `inf` i `1e300` z cizího ISDOC přijdou tudy a částka musí zůstat
		// pod stropem.
		expect(lineCents(Number.POSITIVE_INFINITY, 100)).toBe(0);
		expect(lineCents(Number.NaN, 100)).toBe(0);
		expect(lineCents(2, Number.NaN)).toBe(0);
		expect(lineCents(1e300, 100)).toBe(9_000_000_000_000);
	});
});

describe('sdílená tabulka zaokrouhlení', () => {
	it('částky řádků sedí s tabulkou', async () => {
		const table = await import('~/utils/fixtures/money-parity.json');
		// Trojice, ne `number[][]`: bez schématu by z JSONu vylezlo pole neurčité délky a `[q, p,
		// ocekavano]` by z něj destrukturovalo `number | undefined`.
		const { cases } = z
			.object({ cases: z.array(z.tuple([z.number(), z.number(), z.number()])) })
			.parse(table.default ?? table);
		expect(cases).toHaveLength(26);
		for (const [q, p, expected] of cases) {
			expect(lineCents(q, p), `${q} × ${p}`).toBe(expected);
		}
	});

	it('částka se ve formuláři vypíše stejně jako v PDF', async () => {
		const table = await import('~/utils/fixtures/money-parity.json');
		const { formats } = z
			.object({ formats: z.array(z.tuple([z.number(), z.string()])) })
			.parse(table.default ?? table);
		expect(formats).toHaveLength(13);
		for (const [cents, text] of formats) {
			expect(czkFromCents(cents), `${cents}`).toBe(`${text}${NBSP}Kč`);
		}
	});

	it('částku ořízne na strop `MAX_CENTS`', () => {
		expect(roundCents(Number.MAX_SAFE_INTEGER)).toBe(MAX_CENTS);
		expect(roundCents(-Number.MAX_SAFE_INTEGER)).toBe(-MAX_CENTS);
		expect(lineCents(Number.MAX_SAFE_INTEGER, 100)).toBe(MAX_CENTS);
	});
});

describe('czkFromCents', () => {
	it('formátuje s nezlomitelnou mezerou, čárkou a měnou', () => {
		expect(czkFromCents(120000)).toBe(`1${NBSP}200,00${NBSP}Kč`);
		expect(czkFromCents(5997)).toBe(`59,97${NBSP}Kč`);
		expect(czkFromCents(0)).toBe(`0,00${NBSP}Kč`);
		expect(czkFromCents(100)).toBe(`1,00${NBSP}Kč`);
		expect(czkFromCents(1234567890)).toBe(`12${NBSP}345${NBSP}678,90${NBSP}Kč`);
	});
	it('záporné částky (dobropis)', () => {
		expect(czkFromCents(-100000)).toBe(`-1${NBSP}000,00${NBSP}Kč`);
	});
	it('nečíslo vypíše nulu, ne NaN', () => {
		expect(czkFromCents(Number.NaN)).toBe(`0,00${NBSP}Kč`);
		expect(czkFromCents(Number.POSITIVE_INFINITY)).toBe(`0,00${NBSP}Kč`);
	});
	it('přetečení ořízne na strop `MAX_CENTS`', () => {
		expect(czkFromCents(1e302)).toBe(`90${NBSP}000${NBSP}000${NBSP}000,00${NBSP}Kč`);
		expect(czkFromCents(-1e302)).toBe(`-90${NBSP}000${NBSP}000${NBSP}000,00${NBSP}Kč`);
	});
	it('půl haléře zaokrouhlí od nuly', () => {
		expect(czkFromCents(-0.5)).toBe(`-0,01${NBSP}Kč`);
		expect(czkFromCents(0.5)).toBe(`0,01${NBSP}Kč`);
	});
	it('zlomek haléře pod nulou vypíše nulu bez mínusu', () => {
		expect(czkFromCents(-0.4)).toBe(`0,00${NBSP}Kč`);
		expect(czkWholeFromCents(-40)).toBe(`0${NBSP}Kč`);
	});
});

describe('czkWholeFromCents', () => {
	it('zahodí haléře a zachová oddělovač tisíců', () => {
		expect(czkWholeFromCents(1_248_000)).toBe(`12${NBSP}480${NBSP}Kč`);
		expect(czkWholeFromCents(999_00)).toBe(`999${NBSP}Kč`);
		expect(czkWholeFromCents(0)).toBe(`0${NBSP}Kč`);
	});

	it('haléře zaokrouhlí na nejbližší korunu', () => {
		expect(czkWholeFromCents(1_49)).toBe(`1${NBSP}Kč`);
		expect(czkWholeFromCents(1_50)).toBe(`2${NBSP}Kč`);
	});

	it('zvládne zápornou částku (dobropis)', () => {
		expect(czkWholeFromCents(-12_345_00)).toBe(`-12${NBSP}345${NBSP}Kč`);
	});

	it('zápornou půlkorunu zaokrouhlí od nuly, stejně jako kladnou', () => {
		expect(czkWholeFromCents(-1_50)).toBe(`-2${NBSP}Kč`);
		expect(czkWholeFromCents(-1_49)).toBe(`-1${NBSP}Kč`);
	});

	it('nečíslo vypíše nulu', () => {
		expect(czkWholeFromCents(Number.NaN)).toBe(`0${NBSP}Kč`);
	});
});
