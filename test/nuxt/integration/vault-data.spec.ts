import { beforeEach, describe, expect, it } from 'vitest';

import { useVault } from '~/composables/useVault';
import { useVaultData } from '~/composables/useVaultData';

import { backend } from '../setup/backend';

// Nová doména se přidává do `useVaultData`, ne na tři místa, odkud se načítá — test proto vyjmenovává
// soubory, ne pořadí volání.
const FILES = ['nastaveni.json', 'platby.json', 'vydaje.json'] as const;

function fillVault(path = '/vault') {
	backend.writeFile(path, 'nastaveni.json', {
		supplier: {
			name: 'Jan Novák',
			ico: '12345679',
			address: {
				street: 'Dlouhá 1',
				city: 'Brno',
				zip: '60200',
			},
			registration: '',
			bankAccount: '',
			bankCode: '',
			defaultDueDays: 14,
			invoiceNumberFormat: '{RRRR}{NNNN}',
		},
		contacts: [
			{
				id: 'k1',
				name: 'Alfa s.r.o.',
				ico: '27082440',
				address: {
					street: 'Dlouhá 1',
					city: 'Praha',
					zip: '11000',
				},
			},
		],
		pricelist: [
			{
				id: 'p1',
				name: 'Programování',
				priceCents: 120_000,
				unit: 'hod',
			},
		],
	});
	backend.writeFile(path, 'platby.json', {
		payments: {
			'20260001': [
				{
					id: 'p1',
					date: '2026-02-01',
					amountCents: 120_000,
				},
			],
		},
	});
	backend.writeFile(path, 'vydaje.json', {
		expenses: [
			{
				id: 'v1',
				supplier: 'Grafik',
				description: 'Logo',
				amountCents: 500000,
				date: '2026-01-10',
			},
		],
	});
}

beforeEach(async () => {
	backend.create('/vault');
	await useNuxtApp().vueApp.runWithContext(useVault).setVault('/vault');
});

describe('načtení všech domén', () => {
	it('načte každou doménu vaultu', async () => {
		fillVault();

		await useNuxtApp().vueApp.runWithContext(useVaultData).load();

		expect(useNuxtApp().vueApp.runWithContext(useVaultData).data.value.supplier?.name).toBe('Jan Novák');
		expect(useNuxtApp().vueApp.runWithContext(usePayments).payments.value['20260001']).toEqual([
			{
				id: 'p1',
				date: '2026-02-01',
				amountCents: 120_000,
			},
		]);
		expect(useNuxtApp().vueApp.runWithContext(useExpensesFile).data.value.expenses[0]?.supplier).toBe('Grafik');
	});

	it('nový vault se načte jako prázdný, bez chyby', async () => {
		await expect(useNuxtApp().vueApp.runWithContext(useVaultData).load()).resolves.toBeUndefined();

		expect(useNuxtApp().vueApp.runWithContext(useVaultData).data.value).toEqual({
			supplier: null,
			contacts: [],
			pricelist: [],
		});
		expect(useNuxtApp().vueApp.runWithContext(useVaultData).loaded.value).toBe(true);
	});

	it('poškozená doména nezabrání načtení ostatních', async () => {
		fillVault();
		backend.writeFile('/vault', 'vydaje.json', { expenses: 'tohle není pole' });

		await expect(useNuxtApp().vueApp.runWithContext(useVaultData).load()).rejects.toThrow(
			new Error(
				'Soubor vydaje.json má poškozený obsah (expenses: Neplatný vstup: očekáváno pole, obdrženo řetězec).',
			),
		);

		expect(useNuxtApp().vueApp.runWithContext(useExpensesFile).loaded.value).toBe(false);
		expect(useNuxtApp().vueApp.runWithContext(usePayments).payments.value['20260001']).toHaveLength(1);
		expect(useNuxtApp().vueApp.runWithContext(useVaultData).data.value.supplier?.name).toBe('Jan Novák');
	});

	it('chyby z víc domén se ohlásí naráz', async () => {
		fillVault();
		backend.writeFile('/vault', 'platby.json', { payments: 'rozbito' });
		backend.writeFile('/vault', 'vydaje.json', { expenses: 'taky rozbito' });

		await expect(useNuxtApp().vueApp.runWithContext(useVaultData).load()).rejects.toThrow(
			new Error(
				'Soubor platby.json má poškozený obsah (payments: Neplatný vstup: očekáváno record, obdrženo řetězec).\nSoubor vydaje.json má poškozený obsah (expenses: Neplatný vstup: očekáváno pole, obdrženo řetězec).',
			),
		);
	});

	it('shodná hláška ze všech domén se ohlásí jednou', async () => {
		backend.breaks('read_data_file', 'Datová složka /vault neexistuje.');

		// Rovnost, ne `toThrow('…')`: ten hledá podřetězec, takže by prošel i tehdy, kdyby se tatáž věta
		// v hlášce opakovala pětkrát pod sebou.
		await expect(useNuxtApp().vueApp.runWithContext(useVaultData).load()).rejects.toThrow(
			new Error('Datová složka /vault neexistuje.'),
		);
	});

	it('dodavatel bez povinných klíčů se ohlásí jako poškozený soubor', async () => {
		backend.writeFile('/vault', 'nastaveni.json', {
			supplier: {
				name: 'Jan Novák',
			},
		});

		await expect(useNuxtApp().vueApp.runWithContext(useVaultData).load()).rejects.toThrow(
			new Error(
				'Soubor nastaveni.json má poškozený obsah (supplier.ico: Neplatný vstup: očekáváno řetězec, obdrženo undefined, supplier.address: Neplatný vstup: očekáváno object, obdrženo undefined a supplier.registration: Neplatný vstup: očekáváno řetězec, obdrženo undefined).',
			),
		);
		expect(useNuxtApp().vueApp.runWithContext(useVaultData).loaded.value).toBe(false);
	});

	it('odběratel bez id se ohlásí jako poškozený soubor', async () => {
		backend.writeFile('/vault', 'nastaveni.json', {
			supplier: null,
			contacts: [{ name: 'Bez id' }],
			pricelist: [],
		});

		await expect(useNuxtApp().vueApp.runWithContext(useVaultData).load()).rejects.toThrow(
			new Error(
				'Soubor nastaveni.json má poškozený obsah (contacts.0.ico: Neplatný vstup: očekáváno řetězec, obdrženo undefined, contacts.0.address: Neplatný vstup: očekáváno object, obdrženo undefined a contacts.0.id: Neplatný vstup: očekáváno řetězec, obdrženo undefined).',
			),
		);
		expect(useNuxtApp().vueApp.runWithContext(useVaultData).loaded.value).toBe(false);
	});
});

describe('přístup ke konfiguraci', () => {
	it('vrací data a stav konfiguračního souboru', async () => {
		fillVault();
		await useNuxtApp().vueApp.runWithContext(useVaultData).load();

		expect(useNuxtApp().vueApp.runWithContext(useVaultData).data.value.contacts[0]?.name).toBe('Alfa s.r.o.');
		expect(useNuxtApp().vueApp.runWithContext(useVaultData).loaded.value).toBe(true);
	});

	it('uložení míří do konfiguračního souboru a nikam jinam', async () => {
		fillVault();
		const v = useNuxtApp().vueApp.runWithContext(useVaultData);
		await v.load();

		const original = Object.fromEntries(FILES.map((n) => [n, backend.folder('/vault').files.get(n)]));
		v.data.value.contacts.push({
			id: 'k2',
			name: 'Beta s.r.o.',
			ico: '25596641',
			address: {
				street: 'Dlouhá 1',
				city: 'Praha',
				zip: '11000',
			},
		});
		await v.save();

		expect(backend.readFile('/vault', 'nastaveni.json').contacts).toHaveLength(2);
		for (const name of FILES.filter((n) => n !== 'nastaveni.json')) {
			expect(backend.folder('/vault').files.get(name), `doména ${name}`).toBe(original[name]);
		}
	});
});
