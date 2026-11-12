import { describe, expect, it } from 'vitest';

import { normalizeSearchText, upsertById, upsertManyById } from '~/utils/crud';

interface Item {
	id: string;
	name: string;
	city?: string;
}

describe('upsertById', () => {
	it('přidá novou položku', () => {
		const list: Item[] = [
			{
				id: '1',
				name: 'A',
			},
		];
		const out = upsertById(list, {
			id: '2',
			name: 'B',
		});
		expect(out).toHaveLength(2);
		expect(out[1]).toEqual({
			id: '2',
			name: 'B',
		});
	});

	it('nahradí existující se stejným id', () => {
		const list: Item[] = [
			{
				id: '1',
				name: 'A',
			},
			{
				id: '2',
				name: 'B',
			},
		];
		const out = upsertById(list, {
			id: '1',
			name: 'A2',
		});
		expect(out).toHaveLength(2);
		expect(out[0]).toEqual({
			id: '1',
			name: 'A2',
		});
	});

	it('nemutuje vstupní pole', () => {
		const list: Item[] = [
			{
				id: '1',
				name: 'A',
			},
		];
		upsertById(list, {
			id: '1',
			name: 'X',
		});
		expect(list[0]!.name).toBe('A');
	});
});

describe('normalizeSearchText', () => {
	it('sjednotí velikost písmen, odstraní diakritiku i okrajové mezery', () => {
		expect(normalizeSearchText('  PŘÍLIŠ ŽLUŤOUČKÝ  ')).toBe('prilis zlutoucky');
	});
});

describe('upsertManyById', () => {
	it('nahradí existující položky na místě a nové přidá v pořadí dávky', () => {
		const first = {
			id: '1',
			name: 'A',
		};
		const second = {
			id: '2',
			name: 'B',
		};
		const list = [first, second];

		const result = upsertManyById(list, [
			{
				id: '2',
				name: 'B2',
			},
			{
				id: '3',
				name: 'C',
			},
			{
				id: '4',
				name: 'D',
			},
		]);

		expect(result).toEqual([
			first,
			{
				id: '2',
				name: 'B2',
			},
			{
				id: '3',
				name: 'C',
			},
			{
				id: '4',
				name: 'D',
			},
		]);
		expect(list).toEqual([first, second]);
	});

	it('opakované id v dávce ponechá v jediné položce s poslední hodnotou', () => {
		expect(
			upsertManyById(
				[],
				[
					{
						id: '1',
						name: 'A',
					},
					{
						id: '1',
						name: 'B',
					},
				],
			),
		).toEqual([
			{
				id: '1',
				name: 'B',
			},
		]);
	});

	it('duplicitní id ve vstupu slije do jediné položky na jeho první pozici', () => {
		expect(
			upsertManyById(
				[
					{
						id: '1',
						name: 'A',
					},
					{
						id: '2',
						name: 'B',
					},
					{
						id: '1',
						name: 'C',
					},
				],
				[
					{
						id: '1',
						name: 'Nová',
					},
				],
			),
		).toEqual([
			{
				id: '1',
				name: 'Nová',
			},
			{
				id: '2',
				name: 'B',
			},
		]);
	});
});
