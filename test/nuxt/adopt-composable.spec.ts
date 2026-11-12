import { beforeEach, describe, expect, it } from 'vitest';

import { useAdopt } from '~/composables/useAdopt';
import { useVault } from '~/composables/useVault';
import { useVaultData } from '~/composables/useVaultData';
import { emptySupplier, type Supplier } from '~/schemas/suppliers';

import { backend } from '../setup/backend';
import { prepareVault, saved } from '../setup/vault';

function supplierFromDocument(over: Record<string, unknown> = {}) {
	return {
		name: 'Jan Novák',
		ico: '12345679',
		address: {
			street: 'Krátká 2',
			city: 'Brno',
			zip: '60200',
		},
		email: 'jan@novak.cz',
		registration: 'Fyzická osoba zapsaná v živnostenském rejstříku, Živnostenský úřad Brno',
		bankAccount: '2000145399',
		bankCode: '0800',
		iban: 'CZ7908000000002000145399',
		invoiceNumberFormat: '{RRRR}{NNNN}',
		defaultDueDays: 14,
		...over,
	};
}

function candidate(number: string) {
	return {
		path: `/vault/${number}.pdf`,
		file: `${number}.pdf`,
		number,
		customer: 'Acme',
		issueDate: '2025-05-01',
		totalCents: 121_000,
	};
}

function scan(over: Record<string, unknown> = {}) {
	return {
		candidates: [],
		skipped: [],
		supplier: null,
		truncated: false,
		...over,
	};
}

function setSupplier(s: Supplier | null): void {
	useNuxtApp().vueApp.runWithContext(useVaultData).data.value.supplier = s;
}

function savedSupplier(): unknown {
	return saved('nastaveni.json').supplier ?? null;
}

beforeEach(async () => {
	await prepareVault({
		'nastaveni.json': {
			supplier: null,
			contacts: [],
			pricelist: [],
		},
	});
	backend.keepsReturning('scan_vault', scan());
	backend.keepsReturning('adopt_documents', {
		imported: [],
		skipped: [],
		customers: [],
	});
});

describe('sken složky', () => {
	it('najde doklady mimo evidenci', async () => {
		backend.keepsReturning('scan_vault', scan({ candidates: [candidate('20250001')] }));

		const v = await useNuxtApp().vueApp.runWithContext(useAdopt).refresh();
		expect(v?.candidates).toHaveLength(1);
	});

	it('bez vyplněného IČO nechá určení na skenu', async () => {
		await useNuxtApp().vueApp.runWithContext(useAdopt).refresh();

		expect(backend.args('scan_vault')).toEqual([
			{
				vaultPath: '/vault',
				ourIco: null,
			},
		]);
	});

	it('s vyplněným IČO ho pošle skenu', async () => {
		setSupplier({
			...emptySupplier(),
			ico: '12345679',
		});

		await useNuxtApp().vueApp.runWithContext(useAdopt).refresh();
		expect(backend.args('scan_vault')).toEqual([
			{
				vaultPath: '/vault',
				ourIco: '12345679',
			},
		]);
	});

	it('selhání skenu nezhasne přehled, ale nechá důvod', async () => {
		backend.breaks('scan_vault', 'složku nejde přečíst');
		const { refresh, scanError } = useNuxtApp().vueApp.runWithContext(useAdopt);

		await expect(refresh()).resolves.toBeNull();
		expect(scanError.value).toBe('složku nejde přečíst');
	});

	it('úspěšný sken starý důvod selhání smaže', async () => {
		backend.breaks('scan_vault', 'složku nejde přečíst');
		const { refresh, scanError } = useNuxtApp().vueApp.runWithContext(useAdopt);
		await refresh();

		backend.repairs('scan_vault');
		await refresh();

		expect(scanError.value).toBe('');
	});

	it('rozbitá odpověď skenu se taky spolkne', async () => {
		backend.keepsReturning('scan_vault', { candidates: 'nesmysl' });

		expect(await useNuxtApp().vueApp.runWithContext(useAdopt).refresh()).toBeNull();
	});

	it('oříznutý sken to přizná', async () => {
		backend.keepsReturning(
			'scan_vault',
			scan({
				candidates: [candidate('20250001')],
				truncated: true,
			}),
		);

		const found = await useNuxtApp().vueApp.runWithContext(useAdopt).refresh();
		expect(found?.truncated).toBe(true);
	});

	it('bez datové složky se neskenuje', async () => {
		useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value = null;

		expect(await useNuxtApp().vueApp.runWithContext(useAdopt).refresh()).toBeNull();
		expect(backend.args('scan_vault')).toEqual([]);
	});

	it('nález vidí i další volání composable', async () => {
		backend.keepsReturning('scan_vault', scan({ candidates: [candidate('20250001')] }));
		await useNuxtApp().vueApp.runWithContext(useAdopt).refresh();

		expect(useNuxtApp().vueApp.runWithContext(useAdopt).scan.value?.candidates).toHaveLength(1);
	});
});

describe('převzetí dokladů', () => {
	it('pošle cesty nalezených dokladů k přesunu', async () => {
		await useNuxtApp()
			.vueApp.runWithContext(useAdopt)
			.adopt(scan({ candidates: [candidate('20250001'), candidate('20250002')] }));

		expect(backend.args('adopt_documents')).toEqual([
			expect.objectContaining({
				paths: ['/vault/20250001.pdf', '/vault/20250002.pdf'],
				ourIco: null,
			}),
		]);
	});

	it('IČO vezme z dokladů, když ho v nastavení není', async () => {
		await useNuxtApp()
			.vueApp.runWithContext(useAdopt)
			.adopt(
				scan({
					candidates: [candidate('20250001')],
					supplier: supplierFromDocument(),
				}),
			);

		expect(backend.args('adopt_documents')).toEqual([
			expect.objectContaining({
				paths: ['/vault/20250001.pdf'],
				ourIco: '12345679',
			}),
		]);
	});

	it('vyplněné IČO z nastavení má přednost před dokladem', async () => {
		setSupplier({
			...emptySupplier(),
			ico: '87654321',
		});

		await useNuxtApp()
			.vueApp.runWithContext(useAdopt)
			.adopt(
				scan({
					candidates: [candidate('20250001')],
					supplier: supplierFromDocument(),
				}),
			);
		expect(backend.args('adopt_documents')).toEqual([
			expect.objectContaining({
				paths: ['/vault/20250001.pdf'],
				ourIco: '87654321',
			}),
		]);
	});

	it('shrne, co se převzalo a co ne', async () => {
		backend.returns('adopt_documents', {
			imported: [
				{
					number: '20250001',
					customer: 'Acme',
					issueDate: '2025-05-01',
					totalCents: 1,
				},
			],
			skipped: [
				{
					file: 'x.pdf',
					reason: 'není faktura',
				},
			],
			customers: [
				{
					name: 'Acme s.r.o.',
					ico: '25596641',
					dic: '',
					address: {
						street: 'Dlouhá 1',
						city: 'Praha',
						zip: '11000',
					},
					email: 'fakturace@acme.cz',
				},
				{
					name: 'Studio',
					ico: '28456785',
					dic: '',
					address: {
						street: 'Krátká 2',
						city: 'Brno',
						zip: '60200',
					},
					email: 'studio@example.cz',
				},
				{
					name: 'Neúplný',
					ico: '',
					dic: '',
					address: {
						street: '',
						city: '',
						zip: '',
					},
					email: '',
				},
			],
		});

		const v = await useNuxtApp()
			.vueApp.runWithContext(useAdopt)
			.adopt(scan({ candidates: [candidate('20250001')] }));
		expect(v.adopted).toBe(1);
		expect(v.skipped).toHaveLength(1);
		expect(v.addedContacts).toBe(2);
		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Některé odběratele z dokladů appka nezaložila, chybí jim údaje',
				color: 'warning',
			}),
		);
	});

	it('neúspěšné převzetí nese chybu dál a nález nezahodí', async () => {
		backend.keepsReturning('scan_vault', scan({ candidates: [candidate('20250001')] }));
		backend.breaks('adopt_documents', 'do složky faktury/ nejde zapisovat');
		const a = useNuxtApp().vueApp.runWithContext(useAdopt);
		const n = await a.refresh();

		await expect(a.adopt(n!)).rejects.toBe('do složky faktury/ nejde zapisovat');
		expect(a.scan.value).toEqual(scan({ candidates: [candidate('20250001')] }));
	});

	it('po převzetí nález zahodí', async () => {
		backend.keepsReturning('scan_vault', scan({ candidates: [candidate('20250001')] }));
		const a = useNuxtApp().vueApp.runWithContext(useAdopt);
		await a.refresh();

		await a.adopt(a.scan.value!);
		expect(a.scan.value).toBeNull();
	});
});

describe('doplnění fakturačních údajů z dokladů', () => {
	it('do prázdného nastavení údaje doplní', async () => {
		const v = await useNuxtApp()
			.vueApp.runWithContext(useAdopt)
			.adopt(scan({ supplier: supplierFromDocument() }));

		expect(savedSupplier()).toEqual({
			name: 'Jan Novák',
			ico: '12345679',
			address: {
				street: 'Krátká 2',
				city: 'Brno',
				zip: '60200',
			},
			registration: 'Fyzická osoba zapsaná v živnostenském rejstříku, Živnostenský úřad Brno',
			bankAccount: '2000145399',
			bankCode: '0800',
			iban: 'CZ7908000000002000145399',
			email: 'jan@novak.cz',
			defaultDueDays: 14,
			invoiceNumberFormat: '{RRRR}{NNNN}',
		});
		expect(v.supplierFilled).toBe(true);
	});

	it('IČO ze samých mezer se bere jako nevyplněné', async () => {
		setSupplier({
			...emptySupplier(),
			ico: '   ',
		});

		const v = await useNuxtApp()
			.vueApp.runWithContext(useAdopt)
			.adopt(scan({ supplier: supplierFromDocument() }));
		expect(savedSupplier()).toMatchObject({
			ico: '12345679',
			name: 'Jan Novák',
		});
		expect(v.supplierFilled).toBe(true);
	});

	it('vyplněné nastavení nepřepisuje', async () => {
		setSupplier({
			...emptySupplier(),
			ico: '87654321',
		});

		const v = await useNuxtApp()
			.vueApp.runWithContext(useAdopt)
			.adopt(scan({ supplier: supplierFromDocument() }));
		// Údaje zůstaly ty uživatelovy, ne z převzatého dokladu.
		expect(useNuxtApp().vueApp.runWithContext(useVaultData).data.value.supplier?.ico).toBe('87654321');
		expect(v.supplierFilled).toBe(false);
	});

	it('bez dodavatele v nálezu není co doplňovat', async () => {
		const v = await useNuxtApp()
			.vueApp.runWithContext(useAdopt)
			.adopt(scan({ supplier: null }));

		expect(useNuxtApp().vueApp.runWithContext(useVaultData).data.value.supplier).toBeNull();
		expect(v.supplierFilled).toBe(false);
	});

	it('návrh bez jména i IČO se zahodí', async () => {
		await useNuxtApp()
			.vueApp.runWithContext(useAdopt)
			.adopt(
				scan({
					supplier: supplierFromDocument({
						name: '',
						ico: '',
					}),
				}),
			);

		expect(useNuxtApp().vueApp.runWithContext(useVaultData).data.value.supplier).toBeNull();
	});

	it('návrh z dokladů bez zápisu do rejstříku uloží a za hotový ho vydá', async () => {
		const v = await useNuxtApp()
			.vueApp.runWithContext(useAdopt)
			.adopt(
				scan({
					supplier: supplierFromDocument({
						registration: '',
					}),
				}),
			);

		expect(savedSupplier()).toMatchObject({
			name: 'Jan Novák',
			registration: '',
		});
		expect(v.supplierFilled).toBe(true);
	});

	it('neúplný návrh uloží, ale za hotový ho nevydává', async () => {
		const v = await useNuxtApp()
			.vueApp.runWithContext(useAdopt)
			.adopt(
				scan({
					supplier: supplierFromDocument({
						bankAccount: '',
						iban: '',
					}),
				}),
			);

		expect(savedSupplier()).toMatchObject({
			name: 'Jan Novák',
			bankAccount: '',
		});
		expect(v.supplierFilled).toBe(false);
	});
});
