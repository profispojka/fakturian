import { beforeEach, describe, expect, it } from 'vitest';
import { h } from 'vue';

import { useContacts } from '~/composables/useContacts';
import { useImport } from '~/composables/useImport';
import { usePaymentsFile } from '~/composables/usePayments';
import { useVault } from '~/composables/useVault';
import { useVaultData } from '~/composables/useVaultData';
import { emptySupplier } from '~/schemas/suppliers';

import { backend } from '../setup/backend';
import { answerDialog, mountUi } from '../setup/mount';
import { saved, savedField, prepareVault, writes } from '../setup/vault';

import type { Contact } from '~/schemas/customers';
import type { ImportedCustomer } from '~/schemas/import';

function customer(over: Partial<ImportedCustomer> = {}) {
	return {
		name: 'Acme s.r.o.',
		ico: '25596641',
		dic: 'CZ25596641',
		address: {
			street: 'Dlouhá 1',
			city: 'Praha',
			zip: '11000',
		},
		email: 'fakturace@acme.cz',
		...over,
	};
}

function contact(over: Partial<Contact> = {}): Contact {
	return {
		id: 'k1',
		name: 'Acme s.r.o.',
		ico: '27082440',
		address: {
			street: 'Dlouhá 1',
			city: 'Praha',
			zip: '11000',
		},
		...over,
	};
}

function report(over: Record<string, unknown> = {}) {
	return {
		imported: [],
		skipped: [],
		customers: [],
		...over,
	};
}

function savingCustomer(): Contact[] {
	return savedField('nastaveni.json', 'contacts');
}

async function vaultWithCustomers(...customers: Contact[]): Promise<void> {
	await prepareVault({
		'nastaveni.json': {
			supplier: {
				...emptySupplier(),
				ico: '12345679',
			},
			contacts: customers,
			pricelist: [],
		},
	});
}

beforeEach(async () => {
	await vaultWithCustomers();
	backend.keepsReturning('import_documents', report());
	backend.keepsReturning('adopt_documents', report());
});

describe('výběr souborů', () => {
	it('vrátí vybrané soubory', async () => {
		backend.dialog.push(['/a.pdf', '/b.pdf']);

		expect(await useNuxtApp().vueApp.runWithContext(useImport).pickFiles()).toEqual(['/a.pdf', '/b.pdf']);
	});

	it('jediný soubor zabalí do pole', async () => {
		backend.dialog.push('/a.pdf');

		expect(await useNuxtApp().vueApp.runWithContext(useImport).pickFiles()).toEqual(['/a.pdf']);
	});

	it('zrušený dialog vrátí prázdný seznam', async () => {
		backend.dialog.push(null);

		expect(await useNuxtApp().vueApp.runWithContext(useImport).pickFiles()).toEqual([]);
	});
});

describe('import dokladů', () => {
	it('pošle backendu cesty a naše IČO', async () => {
		await useNuxtApp().vueApp.runWithContext(useImport).importFiles(['/a.pdf']);

		expect(backend.args('import_documents')).toEqual([
			{
				vaultPath: '/vault',
				paths: ['/a.pdf'],
				ourIco: '12345679',
			},
		]);
	});

	it('prázdný seznam se backendu vůbec neposílá', async () => {
		const v = await useNuxtApp().vueApp.runWithContext(useImport).importFiles([]);

		expect(backend.args('import_documents')).toEqual([]);
		expect(v.addedContacts).toBe(0);
		expect(v.report.imported).toEqual([]);
	});

	it('bez datové složky import selže', async () => {
		useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value = null;

		await expect(useNuxtApp().vueApp.runWithContext(useImport).importFiles(['/a.pdf'])).rejects.toThrow(
			new Error('Není zvolena datová složka'),
		);
	});

	it('bez vyplněného dodavatele pošle IČO jako prázdné', async () => {
		useNuxtApp().vueApp.runWithContext(useVaultData).data.value.supplier = null;

		await useNuxtApp().vueApp.runWithContext(useImport).importFiles(['/a.pdf']);
		expect(backend.args('import_documents')).toEqual([
			{
				vaultPath: '/vault',
				paths: ['/a.pdf'],
				ourIco: null,
			},
		]);
	});

	it('vrátí report tak, jak přišel z backendu', async () => {
		backend.keepsReturning(
			'import_documents',
			report({
				imported: [
					{
						number: '20250001',
						customer: 'Acme',
						issueDate: '2025-01-01',
						totalCents: 1000,
					},
				],
				skipped: [
					{
						file: 'x.pdf',
						reason: 'není faktura',
					},
				],
			}),
		);

		const v = await useNuxtApp().vueApp.runWithContext(useImport).importFiles(['/a.pdf']);
		expect(v.report.imported).toHaveLength(1);
		expect(v.report.skipped[0]!.reason).toBe('není faktura');
	});

	it('rozbitý report se odmítne', async () => {
		backend.keepsReturning('import_documents', { imported: 'nesmysl' });

		await expect(useNuxtApp().vueApp.runWithContext(useImport).importFiles(['/a.pdf'])).rejects.toThrow(
			new Error(
				'Zpráva o importu má poškozený obsah (imported: Neplatný vstup: očekáváno pole, obdrženo řetězec, skipped: Neplatný vstup: očekáváno pole, obdrženo undefined a customers: Neplatný vstup: očekáváno pole, obdrženo undefined).',
			),
		);
	});
});

describe('zakládání odběratelů z importu', () => {
	it('nové odběratele založí jedním zápisem', async () => {
		backend.keepsReturning(
			'import_documents',
			report({
				customers: [
					customer(),
					customer({
						ico: '28456785',
						name: 'Studio',
					}),
				],
			}),
		);

		const v = await useNuxtApp().vueApp.runWithContext(useImport).importFiles(['/a.pdf']);
		expect(v.addedContacts).toBe(2);
		expect(savingCustomer()).toHaveLength(2);
		// Deset samostatných zápisů by protočilo kruh snapshotů `nastaveni.json` a vytlačilo z něj
		// zálohu stavu před importem.
		expect(writes('nastaveni.json')).toBe(1);
	});

	it('odběratele se stejným IČO nezaloží podruhé', async () => {
		await vaultWithCustomers(
			contact({
				name: 'Jinak pojmenovaná',
				ico: '25596641',
			}),
		);
		backend.keepsReturning('import_documents', report({ customers: [customer()] }));

		const v = await useNuxtApp().vueApp.runWithContext(useImport).importFiles(['/a.pdf']);
		expect(v.addedContacts).toBe(0);
	});

	it('bez IČO porovná normalizovaný název', async () => {
		await vaultWithCustomers(contact({ name: '  ácme S.R.O. ' }));
		backend.keepsReturning(
			'import_documents',
			report({
				customers: [
					customer({
						ico: '',
					}),
				],
			}),
		);

		const v = await useNuxtApp().vueApp.runWithContext(useImport).importFiles(['/a.pdf']);
		expect(v.addedContacts).toBe(0);
	});

	it('nového odběratele bez IČO nezaloží a řekne to', async () => {
		await vaultWithCustomers(contact({ name: 'Někdo jiný' }));
		backend.keepsReturning(
			'import_documents',
			report({
				customers: [
					customer({
						ico: '',
					}),
					customer({
						name: 'Studio',
						ico: '28456785',
						address: {
							street: 'Dlouhá 1',
							city: 'Praha',
							zip: 'x',
						},
					}),
				],
			}),
		);

		const v = await useNuxtApp().vueApp.runWithContext(useImport).importFiles(['/a.pdf']);
		expect(v.addedContacts).toBe(0);
		expect(savingCustomer()).toEqual([contact({ name: 'Někdo jiný' })]);
		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual({
			id: expect.any(String),
			open: true,
			title: 'Některé odběratele z dokladů appka nezaložila, chybí jim údaje',
			description: 'Acme s.r.o. (ico: Povinné pole.) a Studio (address.zip: PSČ má 5 číslic.)',
			color: 'warning',
		});
	});

	it('víc než tři odmítnuté odběratele vyjmenuje jen na začátku a řekne celkový počet', async () => {
		await vaultWithCustomers(contact({ name: 'Někdo jiný' }));
		backend.keepsReturning(
			'import_documents',
			report({
				customers: ['Alfa', 'Beta', 'Gama', 'Delta'].map((name) =>
					customer({
						name,
						ico: '',
					}),
				),
			}),
		);

		await useNuxtApp().vueApp.runWithContext(useImport).importFiles(['/a.pdf']);

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual({
			id: expect.any(String),
			open: true,
			title: 'Některé odběratele z dokladů appka nezaložila, chybí jim údaje',
			description:
				'Alfa (ico: Povinné pole.), Beta (ico: Povinné pole.) a\u00A0Gama (ico: Povinné pole.) — a další, celkem 4 odběratelé.',
			color: 'warning',
		});
	});
});

describe('převzetí složky', () => {
	it('použije adopt_documents a IČO zvenčí', async () => {
		await useNuxtApp().vueApp.runWithContext(useImport).adoptFiles(['/vault/stare/a.pdf'], '87654321');

		expect(backend.args('adopt_documents')).toEqual([
			{
				vaultPath: '/vault',
				paths: ['/vault/stare/a.pdf'],
				ourIco: '87654321',
			},
		]);
	});

	it('převzetí bez známého IČO projde s prázdným', async () => {
		await useNuxtApp().vueApp.runWithContext(useImport).adoptFiles(['/vault/stare/a.pdf'], null);

		expect(backend.args('adopt_documents')).toEqual([
			{
				vaultPath: '/vault',
				paths: ['/vault/stare/a.pdf'],
				ourIco: null,
			},
		]);
	});

	it('bez datové složky převzetí selže', async () => {
		useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value = null;

		await expect(
			useNuxtApp().vueApp.runWithContext(useImport).adoptFiles(['/vault/stare/a.pdf'], null),
		).rejects.toThrow(new Error('Není zvolena datová složka'));
		expect(backend.args('adopt_documents')).toEqual([]);
	});

	it('prázdný seznam se backendu vůbec neposílá', async () => {
		const v = await useNuxtApp().vueApp.runWithContext(useImport).adoptFiles([], '87654321');

		expect(backend.args('adopt_documents')).toEqual([]);
		expect(v.report).toEqual({
			imported: [],
			skipped: [],
			customers: [],
		});
		expect(v.addedContacts).toBe(0);
	});

	it('převzetí zakládá odběratele a duplicity vynechá', async () => {
		await vaultWithCustomers(
			contact({
				name: 'Jinak pojmenovaná',
				ico: '25596641',
			}),
		);
		backend.keepsReturning(
			'adopt_documents',
			report({
				customers: [
					customer(),
					customer({
						ico: '28456785',
						name: 'Studio',
					}),
				],
			}),
		);

		const v = await useNuxtApp().vueApp.runWithContext(useImport).adoptFiles(['/vault/stare/a.pdf'], '87654321');

		expect(v.addedContacts).toBe(1);
		expect(savingCustomer()).toHaveLength(2);
		expect(savingCustomer()).toContainEqual(expect.objectContaining({ name: 'Studio' }));
	});
});

describe('platby k naimportovaným číslům', () => {
	const imported = {
		number: '20250001',
		customer: 'Acme',
		issueDate: '2025-01-01',
		totalCents: 1_000,
	};

	beforeEach(async () => {
		backend.writeFile('/vault', 'platby.json', {
			payments: {
				'20250001': [
					{
						id: 'pay-20250001',
						date: '2025-01-10',
						amountCents: 1_000,
					},
				],
				'20250002': [
					{
						id: 'pay-20250002',
						date: '2025-01-12',
						amountCents: 2_000,
					},
				],
			},
		});
		await useNuxtApp().vueApp.runWithContext(usePaymentsFile).load();
	});

	it('import zapomene platby, které k číslu zůstaly po zmizelém dokladu', async () => {
		backend.keepsReturning('import_documents', report({ imported: [imported] }));

		await useNuxtApp().vueApp.runWithContext(useImport).importFiles(['/a.pdf']);

		expect(saved('platby.json').payments).toEqual({
			'20250002': [
				{
					id: 'pay-20250002',
					date: '2025-01-12',
					amountCents: 2_000,
				},
			],
		});
	});

	it('převzetí složky je zapomene taky', async () => {
		backend.keepsReturning('adopt_documents', report({ imported: [imported] }));

		await useNuxtApp().vueApp.runWithContext(useImport).adoptFiles(['/vault/stare/a.pdf'], '87654321');

		expect(saved('platby.json').payments).toEqual({
			'20250002': [
				{
					id: 'pay-20250002',
					date: '2025-01-12',
					amountCents: 2_000,
				},
			],
		});
	});

	it('selhání zápisu odběratelů doklady nezahodí a archiv s platbami obnoví', async () => {
		backend.keepsReturning(
			'import_documents',
			report({
				imported: [imported],
				customers: [customer()],
			}),
		);
		useState('invoiceArchive').value = {
			vault: '/vault',
			items: [],
		};
		backend.writeFile('/vault', 'nastaveni.json', {
			supplier: {
				...emptySupplier(),
				ico: '12345679',
			},
			contacts: [
				contact({
					id: 'k9',
					name: 'Z jiného Macu',
				}),
			],
			pricelist: [],
		});
		mountUi({ render: () => h('div') });

		const importing = useNuxtApp().vueApp.runWithContext(useImport).importFiles(['/a.pdf']);
		await answerDialog(false);
		const result = await importing;

		expect(result.addedContacts).toBe(0);
		expect(result.report.imported).toEqual([imported]);
		expect(useState('invoiceArchive').value).toBeNull();
		expect(saved('platby.json').payments).toEqual({
			'20250002': [
				{
					id: 'pay-20250002',
					date: '2025-01-12',
					amountCents: 2_000,
				},
			],
		});
		expect(savingCustomer().map((c) => c.name)).toEqual(['Z jiného Macu']);
		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Doklady jsou naimportované, ale nové odběratele se nepodařilo uložit',
				description: 'Změna se neuložila: soubor nastaveni.json mezitím změnil jiný počítač nebo program.',
				color: 'warning',
			}),
		);
	});

	it('selhání úklidu plateb odběratele přesto založí', async () => {
		backend.keepsReturning(
			'import_documents',
			report({
				imported: [imported],
				customers: [customer()],
			}),
		);
		backend.fails('write_data_file', 'platby jsou zamčené');
		backend.returns('write_data_file', 'written');

		const result = await useNuxtApp().vueApp.runWithContext(useImport).importFiles(['/a.pdf']);

		expect(result.addedContacts).toBe(1);
		expect(
			useNuxtApp()
				.vueApp.runWithContext(useContacts)
				.contacts.value.map((c) => c.name),
		).toEqual(['Acme s.r.o.']);
		expect(backend.args('write_data_file').map((call) => call.name)).toEqual(['platby.json', 'nastaveni.json']);
		expect(saved('platby.json').payments).toHaveProperty('20250001');
		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Doklady jsou naimportované, ale staré platby k jejich číslům se nepodařilo smazat',
				description: 'platby jsou zamčené',
				color: 'warning',
			}),
		);
	});
});
