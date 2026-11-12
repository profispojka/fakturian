import { assert, bigInt, constantFrom, integer, property, string, tuple } from 'fast-check';
import { describe, expect, it } from 'vitest';

import { compareNumbers } from '../numbering.ts';

describe('pořadí čísel dokladů', () => {
	it('běhy číslic porovná jako čísla', () => {
		expect(compareNumbers('F2026-9', 'F2026-10')).toBe(-1);
		expect(compareNumbers('2026-0009', '2026-10')).toBe(-1);
		expect(compareNumbers('20260002', '20260010')).toBe(-1);
		expect(compareNumbers('20260010', '20260002')).toBe(1);
	});

	it('ostatní běhy porovná bez ohledu na velikost písmen', () => {
		expect(compareNumbers('A-2', 'B-1')).toBe(-1);
		expect(compareNumbers('f2026-1', 'F2026-2')).toBe(-1);
		expect(compareNumbers('1-A', 'A-1')).toBe(-1);
		expect(compareNumbers('10', 'A')).toBe(-1);
	});

	it('běh bez číslic porovná celý, ne po znacích', () => {
		expect(compareNumbers('F-1', 'F1')).toBe(1);
		expect(compareNumbers('F1', 'F-1')).toBe(-1);
	});

	it('velikost písmen srovná jen u ASCII, ostatní znaky porovná podle kódu', () => {
		expect(compareNumbers('a-2', 'A-1')).toBe(1);
		expect(compareNumbers('Ř-2', 'ř-1')).toBe(-1);
		expect(compareNumbers('ř-1', 'Ř-2')).toBe(1);
	});

	it('kratší číslo se stejným začátkem jde první', () => {
		expect(compareNumbers('F2026', 'F2026-1')).toBe(-1);
		expect(compareNumbers('F2026-1', 'F2026')).toBe(1);
		expect(compareNumbers('', 'A')).toBe(-1);
		expect(compareNumbers('f2026', 'F2026-1')).toBe(-1);
	});

	it('stejná čísla jsou si rovna, nuly na začátku ale ne', () => {
		expect(compareNumbers('F2026-1', 'F2026-1')).toBe(0);
		expect(compareNumbers('', '')).toBe(0);
		expect(compareNumbers('7', '007')).toBe(1);
		expect(compareNumbers('f2026', 'F2026')).toBe(1);
	});

	it('seřadí řadu tak, jak ji čte člověk', () => {
		expect(['F2026-10', 'f2026-2', 'F2026-9', 'F2026', 'F2026-1'].toSorted(compareNumbers)).toEqual([
			'F2026',
			'F2026-1',
			'f2026-2',
			'F2026-9',
			'F2026-10',
		]);
	});

	it('pořadí je úplné uspořádání a číslice čte jako číslo', () => {
		// Malá abeceda, ať se běhy písmen i číslic často potkají a vyzkouší se i shoda.
		const number = string({
			unit: constantFrom('a', 'A', 'b', '0', '1', '9', '.', '-'),
			maxLength: 8,
		});
		assert(
			property(tuple(number, number, number), ([a, b, c]) => {
				expect(compareNumbers(a, b) + compareNumbers(b, a)).toBe(0);
				expect(compareNumbers(a, b) === 0).toBe(a === b);
				const chained = compareNumbers(a, b) <= 0 && compareNumbers(b, c) <= 0;
				expect(!chained || compareNumbers(a, c) <= 0).toBe(true);
			}),
			{
				seed: 20,
			},
		);
		const u64 = bigInt({
			min: 0n,
			max: 2n ** 64n - 1n,
		});
		assert(
			property(
				u64,
				u64,
				integer({
					min: 0,
					max: 12,
				}),
				(x, y, width) => {
					expect(
						compareNumbers(
							`F2026-${String(x).padStart(width, '0')}`,
							`F2026-${String(y).padStart(width, '0')}`,
						),
					).toBe(Number(x > y) - Number(x < y));
				},
			),
			{
				seed: 21,
			},
		);
	});
});
