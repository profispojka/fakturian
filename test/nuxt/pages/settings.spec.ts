import { beforeEach, describe, expect, it } from 'vitest';

import { useSettings } from '~/composables/useSettings';
import { useVaultData } from '~/composables/useVaultData';
import { emptySupplier } from '~/schemas/suppliers';

import { backend } from '../setup/backend';
import { prepareVault, saved, writes } from '../setup/vault';

/** Dvojník dosazený za vault by o tom, co ve složce po uložení leží, netvrdil nic. */
beforeEach(async () => {
	await prepareVault();
});

describe('useSettings', () => {
	it('prázdný vault nemá dodavatele', () => {
		expect(useNuxtApp().vueApp.runWithContext(useSettings).supplier.value).toBeNull();
	});

	it('uloží dodavatele a zapíše do vaultu', async () => {
		const { supplier, setSupplier } = useNuxtApp().vueApp.runWithContext(useSettings);

		await setSupplier({
			...emptySupplier(),
			name: 'Jan Novák',
			ico: '12345679',
		});

		expect(supplier.value?.name).toBe('Jan Novák');
		expect(saved('nastaveni.json').supplier).toMatchObject({
			name: 'Jan Novák',
			ico: '12345679',
		});
	});

	it('změna ve vaultu se propíše i bez dalšího volání', () => {
		const { supplier } = useNuxtApp().vueApp.runWithContext(useSettings);
		useNuxtApp().vueApp.runWithContext(useVaultData).data.value.supplier = {
			...emptySupplier(),
			name: 'Zvenku',
		};

		expect(supplier.value?.name).toBe('Zvenku');
	});

	it('uložení dodavatele zachová odběratele i ceník', async () => {
		const pricelist = [
			{
				id: 'p1',
				name: 'Práce',
				priceCents: 50_000,
				unit: 'hod',
			},
		];
		const contacts = [
			{
				id: 'k1',
				name: 'Acme',
				ico: '27082440',
				address: {
					street: 'Dlouhá 1',
					city: 'Praha',
					zip: '11000',
				},
			},
		];
		useNuxtApp().vueApp.runWithContext(useVaultData).data.value = {
			supplier: null,
			pricelist,
			contacts,
		};

		await useNuxtApp()
			.vueApp.runWithContext(useSettings)
			.setSupplier({
				...emptySupplier(),
				name: 'Jan Novák',
			});

		expect(saved('nastaveni.json')).toEqual({
			supplier: expect.objectContaining({ name: 'Jan Novák' }),
			pricelist,
			contacts,
		});
	});

	it('neuložený dodavatel nese chybu dál', async () => {
		backend.breaks('write_data_file', 'disk je plný');
		const { setSupplier } = useNuxtApp().vueApp.runWithContext(useSettings);

		await expect(
			setSupplier({
				...emptySupplier(),
				name: 'Jan Novák',
			}),
		).rejects.toBe('disk je plný');
	});

	it('přepsání dodavatele nezaloží druhého', async () => {
		const { supplier, setSupplier } = useNuxtApp().vueApp.runWithContext(useSettings);
		await setSupplier({
			...emptySupplier(),
			name: 'První',
		});
		await setSupplier({
			...emptySupplier(),
			name: 'Druhý',
		});

		expect(supplier.value?.name).toBe('Druhý');
		expect(saved('nastaveni.json').supplier).toMatchObject({ name: 'Druhý' });
		expect(writes('nastaveni.json')).toBe(2);
	});
});
