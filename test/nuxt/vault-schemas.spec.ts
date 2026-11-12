import { beforeEach, describe, expect, it } from 'vitest';

import { useExpensesFile } from '~/composables/useExpenses';
import { usePaymentsFile } from '~/composables/usePayments';
import { useVault } from '~/composables/useVault';
import { useVaultData } from '~/composables/useVaultData';

import { backend } from '../setup/backend';

async function vaultFiles(content: Record<string, unknown> = {}): Promise<void> {
	backend.create('/vault');
	for (const [name, data] of Object.entries(content)) backend.writeFile('/vault', name, data);
	await useNuxtApp().vueApp.runWithContext(useVault).setVault('/vault');
}

/** Kolikrát se doména zapsala — „nezapsalo se" musí být vidět na složce. */
function writes(name: string): number {
	return backend.calls.filter((v) => v.command === 'write_data_file' && v.args.name === name).length;
}

beforeEach(async () => {
	await vaultFiles();
});

const SUPPLIER = {
	name: 'Jan Novák',
	ico: '12345679',
	address: {
		street: 'Krátká 2',
		city: 'Brno',
		zip: '60200',
	},
	registration: '',
	bankAccount: '2000145399',
	bankCode: '0800',
	defaultDueDays: 14,
	invoiceNumberFormat: '{RRRR}{NNNN}',
};

const CUSTOMER = {
	id: 'k1',
	name: 'Acme s.r.o.',
	ico: '27082440',
	address: {
		street: 'Dlouhá 1',
		city: 'Praha',
		zip: '11000',
	},
};

const PRICE_ITEM = {
	id: 'p1',
	name: 'Konzultace',
	priceCents: 120_000,
	unit: 'hod',
};

describe('konfigurace vaultu (nastaveni.json)', () => {
	it('načte dodavatele, odběratele i ceník', async () => {
		await vaultFiles({
			'nastaveni.json': {
				supplier: SUPPLIER,
				contacts: [CUSTOMER],
				pricelist: [PRICE_ITEM],
			},
		});
		const v = useNuxtApp().vueApp.runWithContext(useVaultData);

		await v.load();
		expect(v.loaded.value).toBe(true);
		expect(v.data.value.supplier?.name).toBe('Jan Novák');
		expect(v.data.value.contacts.map((c) => c.name)).toEqual(['Acme s.r.o.']);
		expect(v.data.value.pricelist[0]?.priceCents).toBe(120_000);
	});

	it('supplier: null projde', async () => {
		await vaultFiles({
			'nastaveni.json': {
				supplier: null,
			},
		});
		const v = useNuxtApp().vueApp.runWithContext(useVaultData);

		await v.load();
		expect(v.data.value.supplier).toBeNull();
		expect(v.loaded.value).toBe(true);
	});

	it('odběratelé, kteří nejsou pole, shodí načtení a soubor zůstane nezapsatelný', async () => {
		await vaultFiles({
			'nastaveni.json': {
				contacts: 'ahoj',
			},
		});
		const v = useNuxtApp().vueApp.runWithContext(useVaultData);

		await expect(v.load()).rejects.toThrow(
			new Error(
				'Soubor nastaveni.json má poškozený obsah (contacts: Neplatný vstup: očekáváno pole, obdrženo řetězec).',
			),
		);
		expect(v.loaded.value).toBe(false);
		await expect(v.save()).rejects.toThrow(
			new Error(
				'Data (nastaveni.json) se nepodařilo načíst, takže se neukládají. Zkontroluj datovou složku a zkus to znovu.',
			),
		);
		expect(writes('nastaveni.json')).toBe(0);
	});

	it('odběratel bez id nebo bez jména se odmítne', async () => {
		await vaultFiles({
			'nastaveni.json': {
				contacts: [
					{
						name: 'Acme',
					},
				],
			},
		});
		await expect(useNuxtApp().vueApp.runWithContext(useVaultData).load()).rejects.toThrow(
			new Error(
				'Soubor nastaveni.json má poškozený obsah (contacts.0.ico: Neplatný vstup: očekáváno řetězec, obdrženo undefined, contacts.0.address: Neplatný vstup: očekáváno object, obdrženo undefined a contacts.0.id: Neplatný vstup: očekáváno řetězec, obdrženo undefined).',
			),
		);

		await vaultFiles({
			'nastaveni.json': {
				contacts: [
					{
						id: 'k1',
					},
				],
			},
		});
		await expect(useNuxtApp().vueApp.runWithContext(useVaultData).load()).rejects.toThrow(
			new Error(
				'Soubor nastaveni.json má poškozený obsah (contacts.0.name: Neplatný vstup: očekáváno řetězec, obdrženo undefined, contacts.0.ico: Neplatný vstup: očekáváno řetězec, obdrženo undefined a contacts.0.address: Neplatný vstup: očekáváno object, obdrženo undefined).',
			),
		);
	});

	it('odběratel bez adresy se odmítne', async () => {
		const { address: _address, ...withoutAddress } = CUSTOMER;
		await vaultFiles({
			'nastaveni.json': {
				contacts: [withoutAddress],
			},
		});

		await expect(useNuxtApp().vueApp.runWithContext(useVaultData).load()).rejects.toThrow(
			new Error(
				'Soubor nastaveni.json má poškozený obsah (contacts.0.address: Neplatný vstup: očekáváno object, obdrženo undefined).',
			),
		);
	});

	it.each([
		['defaultDueDays', 'Zadej číslo.'],
		['invoiceNumberFormat', 'Neplatný vstup: očekáváno řetězec, obdrženo undefined'],
		['registration', 'Neplatný vstup: očekáváno řetězec, obdrženo undefined'],
		['address', 'Neplatný vstup: očekáváno object, obdrženo undefined'],
	])('dodavatel bez klíče %s se odmítne', async (key, message) => {
		const supplier = Object.fromEntries(Object.entries(SUPPLIER).filter(([k]) => k !== key));
		await vaultFiles({
			'nastaveni.json': {
				supplier,
			},
		});

		await expect(useNuxtApp().vueApp.runWithContext(useVaultData).load()).rejects.toThrow(
			new Error(`Soubor nastaveni.json má poškozený obsah (supplier.${key}: ${message}).`),
		);
	});

	it('rozpracovaný dodavatel s neplatným IČO se načíst dá', async () => {
		await vaultFiles({
			'nastaveni.json': {
				supplier: {
					...SUPPLIER,
					ico: '123',
				},
			},
		});
		const v = useNuxtApp().vueApp.runWithContext(useVaultData);

		await v.load();
		expect(v.data.value.supplier?.ico).toBe('123');
	});

	it.each([
		[14.5, 'Zadej celé číslo.'],
		[-1, 'Zadej číslo ≥ 0.'],
		[366, 'Zadej číslo ≤ 365.'],
	])('neplatnou splatnost %s odmítne při načtení', async (defaultDueDays, problem) => {
		await vaultFiles({
			'nastaveni.json': {
				supplier: {
					...SUPPLIER,
					defaultDueDays,
				},
			},
		});
		await expect(useNuxtApp().vueApp.runWithContext(useVaultData).load()).rejects.toThrow(
			new Error(`Soubor nastaveni.json má poškozený obsah (supplier.defaultDueDays: ${problem}).`),
		);
	});

	it('prázdný roční limit v souboru se odmítne, chybějící projde', async () => {
		await vaultFiles({
			'nastaveni.json': {
				pricelist: [
					{
						...PRICE_ITEM,
						annualLimit: '',
					},
				],
			},
		});
		await expect(useNuxtApp().vueApp.runWithContext(useVaultData).load()).rejects.toThrow(
			new Error(
				'Soubor nastaveni.json má poškozený obsah (pricelist.0.annualLimit: Neplatný vstup: očekáváno číslo, obdrženo řetězec).',
			),
		);

		await vaultFiles({
			'nastaveni.json': {
				pricelist: [PRICE_ITEM],
			},
		});
		const v = useNuxtApp().vueApp.runWithContext(useVaultData);
		await v.load();
		expect(v.data.value.pricelist[0]?.annualLimit).toBeUndefined();
	});

	it.each([
		['priceCents', 'Neplatný vstup: očekáváno číslo, obdrženo undefined'],
		['unit', 'Neplatný vstup: očekáváno řetězec, obdrženo undefined'],
	])('položka ceníku bez klíče %s se odmítne', async (key, message) => {
		const item = Object.fromEntries(Object.entries(PRICE_ITEM).filter(([k]) => k !== key));
		await vaultFiles({
			'nastaveni.json': {
				pricelist: [item],
			},
		});

		await expect(useNuxtApp().vueApp.runWithContext(useVaultData).load()).rejects.toThrow(
			new Error(`Soubor nastaveni.json má poškozený obsah (pricelist.0.${key}: ${message}).`),
		);
	});

	it('klíč dopsaný uživatelem uložení přežije i uvnitř záznamů', async () => {
		await vaultFiles({
			'nastaveni.json': {
				myNote: 'nesmazat',
				supplier: {
					...SUPPLIER,
					address: {
						...SUPPLIER.address,
						floor: '3.',
					},
					bank: 'Fio',
				},
				contacts: [
					{
						...CUSTOMER,
						crm: 42,
						address: {
							...CUSTOMER.address,
							door: 'B',
						},
					},
				],
				pricelist: [
					{
						...PRICE_ITEM,
						tag: 'vývoj',
					},
				],
			},
		});
		const v = useNuxtApp().vueApp.runWithContext(useVaultData);

		await v.load();
		await v.save();

		const saved: unknown = JSON.parse(backend.folder('/vault').files.get('nastaveni.json')!);
		expect(saved).toMatchObject({
			myNote: 'nesmazat',
			supplier: {
				address: {
					floor: '3.',
				},
				bank: 'Fio',
			},
			contacts: [
				{
					crm: 42,
					address: {
						door: 'B',
					},
				},
			],
			pricelist: [{ tag: 'vývoj' }],
		});
	});
});

describe('platby.json', () => {
	it('načte platby podle čísla dokladu', async () => {
		await vaultFiles({
			'platby.json': {
				payments: {
					'20260001': [
						{
							id: 'p1',
							date: '2026-03-20',
							amountCents: 40_000,
							fioId: '77',
						},
					],
				},
			},
		});
		const f = useNuxtApp().vueApp.runWithContext(usePaymentsFile);

		await f.load();
		expect(f.data.value.payments['20260001']).toEqual([
			{
				id: 'p1',
				date: '2026-03-20',
				amountCents: 40_000,
				fioId: '77',
			},
		]);
	});

	it.each([
		[
			{
				date: '2026-03-20',
				amountCents: 100,
			},
			/payments\.20260001\.0\.id/,
		],
		[
			{
				id: '',
				date: '2026-03-20',
				amountCents: 100,
			},
			/payments\.20260001\.0\.id/,
		],
		[
			{
				id: 'p3',
				date: '2026-03-20',
				amountCents: 0,
			},
			/payments\.20260001\.0\.amountCents/,
		],
		[
			{
				id: 'p4',
				date: '2026-03-20',
				amountCents: 10.5,
			},
			/payments\.20260001\.0\.amountCents/,
		],
		[
			{
				id: 'p5',
				date: '2026-02-30',
				amountCents: 100,
			},
			/payments\.20260001\.0\.date/,
		],
		[
			{
				id: 'p6',
				date: '2026-03-20',
				amountCents: 100,
				fioId: '',
			},
			/payments\.20260001\.0\.fioId/,
		],
	])('neplatnou platbu %o odmítne se jménem pole', async (payment, field) => {
		await vaultFiles({
			'platby.json': {
				payments: {
					'20260001': [payment],
				},
			},
		});
		const f = useNuxtApp().vueApp.runWithContext(usePaymentsFile);

		await expect(f.load()).rejects.toThrow(field);
		expect(f.loaded.value).toBe(false);
	});

	it('chybějící mapa plateb se doplní prázdnou', async () => {
		await vaultFiles({ 'platby.json': {} });
		const f = useNuxtApp().vueApp.runWithContext(usePaymentsFile);

		await f.load();
		expect(f.data.value.payments).toEqual({});
		expect(f.loaded.value).toBe(true);
	});

	it('příznak zaplacení místo seznamu plateb se odmítne', async () => {
		await vaultFiles({
			'platby.json': {
				payments: {
					'20260001': {
						paid: true,
					},
				},
			},
		});
		const f = useNuxtApp().vueApp.runWithContext(usePaymentsFile);

		await expect(f.load()).rejects.toThrow(
			new Error(
				'Soubor platby.json má poškozený obsah (payments.20260001: Neplatný vstup: očekáváno pole, obdrženo object).',
			),
		);
		expect(f.loaded.value).toBe(false);
	});
});

const EXPENSE = {
	id: 'v1',
	supplier: 'Server s.r.o.',
	description: 'Hosting',
	amountCents: 50_000,
	date: '2026-03-01',
};

describe('vydaje.json', () => {
	it('načte výdaj bez nepovinných polí', async () => {
		await vaultFiles({
			'vydaje.json': {
				expenses: [EXPENSE],
			},
		});
		const f = useNuxtApp().vueApp.runWithContext(useExpensesFile);

		await f.load();
		expect(f.data.value.expenses).toEqual([EXPENSE]);
	});

	it.each(['supplier', 'description'])('výdaj bez klíče %s se odmítne', async (key) => {
		const expense = Object.fromEntries(Object.entries(EXPENSE).filter(([k]) => k !== key));
		await vaultFiles({
			'vydaje.json': {
				expenses: [expense],
			},
		});

		await expect(useNuxtApp().vueApp.runWithContext(useExpensesFile).load()).rejects.toThrow(
			new Error(
				`Soubor vydaje.json má poškozený obsah (expenses.0.${key}: Neplatný vstup: očekáváno řetězec, obdrženo undefined).`,
			),
		);
	});

	it('výdaj bez částky se odmítne', async () => {
		const { amountCents: _number, ...withoutAmount } = EXPENSE;
		await vaultFiles({
			'vydaje.json': {
				expenses: [withoutAmount],
			},
		});
		const f = useNuxtApp().vueApp.runWithContext(useExpensesFile);

		await expect(f.load()).rejects.toThrow(
			new Error(
				'Soubor vydaje.json má poškozený obsah (expenses.0.amountCents: Neplatný vstup: očekáváno číslo, obdrženo undefined).',
			),
		);
		expect(f.loaded.value).toBe(false);
	});

	it('částka jako text se odmítne', async () => {
		await vaultFiles({
			'vydaje.json': {
				expenses: [
					{
						...EXPENSE,
						amountCents: '100',
					},
				],
			},
		});

		await expect(useNuxtApp().vueApp.runWithContext(useExpensesFile).load()).rejects.toThrow(
			new Error(
				'Soubor vydaje.json má poškozený obsah (expenses.0.amountCents: Neplatný vstup: očekáváno číslo, obdrženo řetězec).',
			),
		);
	});

	it('částka ve zlomcích haléře se odmítne', async () => {
		await vaultFiles({
			'vydaje.json': {
				expenses: [
					{
						...EXPENSE,
						amountCents: 100.5,
					},
				],
			},
		});

		await expect(useNuxtApp().vueApp.runWithContext(useExpensesFile).load()).rejects.toThrow(
			new Error(
				'Soubor vydaje.json má poškozený obsah (expenses.0.amountCents: Neplatný vstup: očekáváno int, obdrženo číslo).',
			),
		);
	});

	it('výdaj s prázdným datem se odmítne u pole data', async () => {
		await vaultFiles({
			'vydaje.json': {
				expenses: [
					{
						...EXPENSE,
						date: '',
					},
				],
			},
		});
		const f = useNuxtApp().vueApp.runWithContext(useExpensesFile);

		await expect(f.load()).rejects.toThrow(
			new Error('Soubor vydaje.json má poškozený obsah (expenses.0.date: Datum musí být ve tvaru RRRR-MM-DD.).'),
		);
		expect(f.loaded.value).toBe(false);
	});

	it('datum, které v kalendáři není, se odmítne taky', async () => {
		await vaultFiles({
			'vydaje.json': {
				expenses: [
					{
						...EXPENSE,
						date: '2026-02-30',
					},
				],
			},
		});

		await expect(useNuxtApp().vueApp.runWithContext(useExpensesFile).load()).rejects.toThrow(
			new Error('Soubor vydaje.json má poškozený obsah (expenses.0.date: Datum musí být ve tvaru RRRR-MM-DD.).'),
		);
	});
});

describe('načtení celého vaultu', () => {
	it('rozbité výdaje nezabrání načtení konfigurace', async () => {
		await vaultFiles({
			'nastaveni.json': {
				supplier: SUPPLIER,
				contacts: [CUSTOMER],
			},
			'vydaje.json': {
				expenses: [
					{
						...EXPENSE,
						amountCents: 'nesmysl',
					},
				],
			},
		});
		const v = useNuxtApp().vueApp.runWithContext(useVaultData);

		await expect(v.load()).rejects.toThrow(
			new Error(
				'Soubor vydaje.json má poškozený obsah (expenses.0.amountCents: Neplatný vstup: očekáváno číslo, obdrženo řetězec).',
			),
		);
		expect(v.loaded.value).toBe(true);
		expect(v.data.value.contacts).toHaveLength(1);
		expect(useNuxtApp().vueApp.runWithContext(useExpensesFile).loaded.value).toBe(false);
	});

	it('chyby z víc domén se ohlásí naráz', async () => {
		await vaultFiles({
			'platby.json': {
				payments: 'nesmysl',
			},
			'vydaje.json': {
				expenses: [
					{
						...EXPENSE,
						amountCents: 'nesmysl',
					},
				],
			},
		});

		await expect(useNuxtApp().vueApp.runWithContext(useVaultData).load()).rejects.toThrow(
			new Error(
				'Soubor platby.json má poškozený obsah (payments: Neplatný vstup: očekáváno record, obdrženo řetězec).\nSoubor vydaje.json má poškozený obsah (expenses.0.amountCents: Neplatný vstup: očekáváno číslo, obdrženo řetězec).',
			),
		);
	});
});
