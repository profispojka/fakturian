import { beforeEach, describe, expect, it } from 'vitest';

import { usePricelist } from '~/composables/usePricelist';
import { useVaultData } from '~/composables/useVaultData';

import { backend } from '../setup/backend';
import { savedField, prepareVault, writes } from '../setup/vault';

import type { PriceItem } from '~/schemas/pricelist';

function savedPricelist(): PriceItem[] {
	return savedField('nastaveni.json', 'pricelist');
}

beforeEach(async () => {
	await prepareVault();
});

describe('usePricelist', () => {
	it('prázdný vault vrátí prázdný ceník', () => {
		expect(useNuxtApp().vueApp.runWithContext(usePricelist).pricelist.value).toEqual([]);
	});

	it('přidá položku a uloží', async () => {
		const { pricelist, upsert } = useNuxtApp().vueApp.runWithContext(usePricelist);
		await upsert({
			id: 'p1',
			name: 'Konzultace',
			priceCents: 120_000,
			unit: 'hod',
		});

		expect(pricelist.value).toHaveLength(1);
		expect(pricelist.value[0]!.name).toBe('Konzultace');
		expect(savedPricelist()).toEqual([
			{
				id: 'p1',
				name: 'Konzultace',
				priceCents: 120_000,
				unit: 'hod',
			},
		]);
	});

	it('položku se stejným id přepíše, nezdvojí', async () => {
		const { pricelist, upsert } = useNuxtApp().vueApp.runWithContext(usePricelist);
		await upsert({
			id: 'p1',
			name: 'Konzultace',
			priceCents: 120_000,
			unit: 'hod',
		});
		await upsert({
			id: 'p1',
			name: 'Konzultace',
			priceCents: 140_000,
			unit: 'hod',
		});

		expect(pricelist.value).toHaveLength(1);
		expect(pricelist.value[0]!.priceCents).toBe(140_000);
	});

	it('smaže položku podle id a uloží', async () => {
		const { pricelist, upsert, remove } = useNuxtApp().vueApp.runWithContext(usePricelist);
		await upsert({
			id: 'p1',
			name: 'A',
			priceCents: 100,
			unit: 'ks',
		});
		await upsert({
			id: 'p2',
			name: 'B',
			priceCents: 200,
			unit: 'ks',
		});
		const before = writes('nastaveni.json');

		await remove('p1');
		expect(pricelist.value.map((p) => p.id)).toEqual(['p2']);
		expect(savedPricelist().map((p) => p.id)).toEqual(['p2']);
		expect(writes('nastaveni.json')).toBe(before + 1);
	});

	it('smazání neznámého id ceník nezmění', async () => {
		const { pricelist, upsert, remove } = useNuxtApp().vueApp.runWithContext(usePricelist);
		await upsert({
			id: 'p1',
			name: 'A',
			priceCents: 100,
			unit: 'ks',
		});

		await remove('neexistuje');
		expect(pricelist.value).toHaveLength(1);
	});

	it('nepovedený zápis nechá ceník tak, jak leží na disku', async () => {
		const { pricelist, upsert, remove } = useNuxtApp().vueApp.runWithContext(usePricelist);
		await upsert({
			id: 'p1',
			name: 'A',
			priceCents: 100,
			unit: 'ks',
		});
		backend.breaks('write_data_file', 'Plný disk');

		await expect(
			upsert({
				id: 'p1',
				name: 'A',
				priceCents: 999,
				unit: 'ks',
			}),
		).rejects.toBe('Plný disk');
		await expect(remove('p1')).rejects.toBe('Plný disk');
		expect(pricelist.value).toEqual([
			{
				id: 'p1',
				name: 'A',
				priceCents: 100,
				unit: 'ks',
			},
		]);
		expect(savedPricelist()).toEqual([
			{
				id: 'p1',
				name: 'A',
				priceCents: 100,
				unit: 'ks',
			},
		]);
	});

	it('`pricelist` je živý pohled do vaultu, ne kopie', () => {
		const { pricelist } = useNuxtApp().vueApp.runWithContext(usePricelist);
		useNuxtApp().vueApp.runWithContext(useVaultData).data.value.pricelist = [
			{
				id: 'x',
				name: 'Zvenku',
				priceCents: 900,
				unit: 'ks',
			},
		];
		expect(pricelist.value[0]!.name).toBe('Zvenku');
	});
});
