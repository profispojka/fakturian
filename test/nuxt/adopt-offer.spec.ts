import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import VaultAdoptOffer from '~/components/vault/AdoptOffer.vue';
import { useAdopt } from '~/composables/useAdopt';
import { emptySupplier } from '~/schemas/suppliers';

import { backend } from '../setup/backend';
import { date } from '../setup/dates';
import { mountUi } from '../setup/mount';
import { prepareVault } from '../setup/vault';

import type { AdoptScan as WireAdoptScan } from '~/bindings';
import type { AdoptScan } from '~/schemas/import';

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

const SUPPLIER_FROM_DOCUMENT = {
	name: 'Jan Novák',
	ico: '12345679',
	dic: 'CZ8501011234',
	address: {
		street: 'Krátká 2',
		city: 'Brno',
		zip: '60200',
	},
	email: 'jan@novak.cz',
	registration: 'Fyzická osoba zapsaná v živnostenském rejstříku, Živnostenský úřad Brno',
	bankAccount: '2000145399',
	bankCode: '0800',
	iban: 'CZ6508000000192000145399',
	invoiceNumberFormat: '{RRRR}{NNNN}',
	defaultDueDays: 14,
};

function scan(over: Partial<WireAdoptScan> = {}): WireAdoptScan {
	return {
		candidates: [candidate('20250001')],
		skipped: [],
		supplier: null,
		truncated: false,
		...over,
	};
}

function scanIs(v: WireAdoptScan | null): void {
	const inMemory: AdoptScan | null = v && {
		...v,
		candidates: v.candidates.map((c) => ({
			...c,
			issueDate: date(c.issueDate),
		})),
	};
	useNuxtApp().vueApp.runWithContext(useAdopt).scan.value = inMemory;
}

function adoptReturns(imported: number, over: Record<string, unknown> = {}): void {
	backend.keepsReturning('adopt_documents', {
		imported: Array.from({ length: imported }, (_, i) => ({
			number: `2025000${i + 1}`,
			customer: 'Acme',
			issueDate: '2025-05-01',
			totalCents: 121_000,
		})),
		skipped: [],
		customers: [],
		...over,
	});
}

beforeEach(async () => {
	await prepareVault({
		'nastaveni.json': {
			supplier: {
				...emptySupplier(),
				ico: '12345679',
			},
			contacts: [],
			pricelist: [],
		},
	});
	backend.keepsReturning('scan_vault', scan());
	adoptReturns(1);
	scanIs(scan());
});

describe('kdy se nabídka ukáže', () => {
	it('s nalezenými doklady vypíše, co ve složce leží', () => {
		const c = mountUi(VaultAdoptOffer);

		expect(c.find('[data-testid="adopt-offer"]').text()).toContain('mimo evidenci');
		expect(c.find('[data-testid="adopt-candidate"]').text()).toContain('20250001');
	});

	it('rovnou říká, že soubory přesune do podsložky', () => {
		const c = mountUi(VaultAdoptOffer);

		expect(c.find('[data-testid="adopt-what"]').text()).toContain('přesunou');
	});

	it('bez nálezu se nezobrazí vůbec', () => {
		scanIs(null);
		expect(mountUi(VaultAdoptOffer).find('[data-testid="adopt-offer"]').exists()).toBe(false);
	});

	it('prázdný seznam kandidátů se taky nezobrazí', () => {
		scanIs(scan({ candidates: [] }));
		expect(mountUi(VaultAdoptOffer).find('[data-testid="adopt-offer"]').exists()).toBe(false);
	});

	it('selhání skenu ukáže i s důvodem', async () => {
		backend.breaks('scan_vault', 'složku nejde přečíst');
		const c = mountUi(VaultAdoptOffer);
		await flushPromises();

		expect(c.find('[data-testid="adopt-scan-error"] [data-slot="title"]').text()).toBe(
			'Doklady mimo evidenci se nepodařilo vyhledat',
		);
		expect(c.find('[data-testid="adopt-scan-error"] [data-slot="description"]').text()).toBe(
			'složku nejde přečíst',
		);
		expect(c.find('[data-testid="adopt-offer"]').exists()).toBe(false);
	});

	it('sken se spustí hned při vykreslení', () => {
		mountUi(VaultAdoptOffer);
		expect(backend.args('scan_vault')).toEqual([
			{
				vaultPath: '/vault',
				ourIco: '12345679',
			},
		]);
	});

	it('dlouhý seznam se zkrátí a zbytek shrne počtem', () => {
		scanIs(
			scan({
				candidates: Array.from(
					{
						length: 8,
					},
					(_, i) => candidate(`2025000${i + 1}`),
				),
			}),
		);
		const c = mountUi(VaultAdoptOffer);

		expect(c.findAll('[data-testid="adopt-candidate"]')).toHaveLength(5);
		expect(c.find('[data-testid="adopt-more"]').text()).toBe('…a další 3');
	});

	it('u zkráceného skenu řekne, že to je první dávka', () => {
		scanIs(scan({ truncated: true }));
		expect(mountUi(VaultAdoptOffer).find('[data-testid="adopt-truncated"]').text()).toContain('první dávka');
	});

	it('nepřevzaté soubory vypíše i s důvodem', async () => {
		const withSkipped = scan({
			skipped: [
				{
					file: 'smlouva.pdf',
					reason: 'není faktura',
				},
			],
		});
		scanIs(withSkipped);
		backend.returns('scan_vault', withSkipped);
		const c = mountUi(VaultAdoptOffer);
		await c.find('[data-testid="adopt-skipped-toggle"]').trigger('click');
		await flushPromises();

		expect(c.find('[data-testid="adopt-skipped"]').text()).toBe('1 soubor mimo převzetí smlouva.pdf: není faktura');
	});
});

describe('převzetí', () => {
	it('tlačítkem převezme nalezené doklady a ohlásí kolik', async () => {
		const c = mountUi(VaultAdoptOffer);
		await c.find('[data-testid="adopt-accept"]').trigger('click');
		await vi.waitFor(() => expect(c.find('[data-testid="adopt-message"]').exists()).toBe(true));

		expect(backend.args('adopt_documents')).toHaveLength(1);
		expect(c.find('[data-testid="adopt-message"]').text()).toBe('Byl převzat 1 doklad.');
	});

	it('dvojklik spustí převzetí jen jednou', async () => {
		const pending = backend.postpone('adopt_documents');
		const c = mountUi(VaultAdoptOffer);
		const accept = c.find('[data-testid="adopt-accept"]');

		void accept.trigger('click');
		await accept.trigger('click');
		await vi.waitFor(() => expect(backend.args('adopt_documents')).toHaveLength(1));

		pending.finish();
		await vi.waitFor(() => expect(c.find('[data-testid="adopt-message"]').exists()).toBe(true));
	});

	it('po převzetí řekne stránce, ať si načte doklady znovu', async () => {
		const c = mountUi(VaultAdoptOffer);
		await c.find('[data-testid="adopt-accept"]').trigger('click');
		await vi.waitFor(() => expect(c.emitted('adopted')).toHaveLength(1));
	});

	it('po převzetí se sken pustí znovu', async () => {
		const c = mountUi(VaultAdoptOffer);
		backend.forgetCalls();
		await c.find('[data-testid="adopt-accept"]').trigger('click');
		await vi.waitFor(() =>
			expect(backend.args('scan_vault')).toEqual([
				{
					vaultPath: '/vault',
					ourIco: '12345679',
				},
			]),
		);
	});

	it('do hlášky přidá odběratele, přeskočené i doplněné údaje', async () => {
		await prepareVault({
			'nastaveni.json': {
				supplier: null,
				contacts: [],
				pricelist: [],
			},
		});
		scanIs(scan({ supplier: SUPPLIER_FROM_DOCUMENT }));
		adoptReturns(3, {
			skipped: [
				{
					file: 'x.pdf',
					reason: 'nečitelné',
				},
			],
			customers: [
				{
					name: 'Alfa',
					ico: '25596641',
					dic: '',
					address: {
						street: 'Dlouhá 1',
						city: 'Praha',
						zip: '11000',
					},
					email: 'alfa@example.cz',
				},
				{
					name: 'Beta',
					ico: '28456785',
					dic: '',
					address: {
						street: 'Krátká 2',
						city: 'Brno',
						zip: '60200',
					},
					email: 'beta@example.cz',
				},
			],
		});
		const c = mountUi(VaultAdoptOffer);
		await c.find('[data-testid="adopt-accept"]').trigger('click');
		await vi.waitFor(() =>
			expect(c.find('[data-testid="adopt-message"]').text()).toBe(
				'Byly převzaty 3 doklady, byli přidáni 2 odběratelé a byl přeskočen 1 soubor. Fakturační údaje se doplnily z dokladů.',
			),
		);
	});

	it('mezitím zmizelý nález nic nepřesune', async () => {
		const c = mountUi(VaultAdoptOffer);
		const button = c.find('[data-testid="adopt-accept"]');
		scanIs(null);
		await button.trigger('click');
		await vi.waitFor(() => expect(c.find('[data-testid="adopt-offer"]').exists()).toBe(false));

		expect(backend.args('adopt_documents')).toEqual([]);
		expect(c.find('[data-testid="adopt-message"]').exists()).toBe(false);
	});

	it('chybu při převzetí ukáže, ne spolkne', async () => {
		backend.breaks('adopt_documents', 'složka je jen ke čtení');
		const c = mountUi(VaultAdoptOffer);
		await c.find('[data-testid="adopt-accept"]').trigger('click');
		await vi.waitFor(() => expect(c.find('[data-testid="adopt-message"]').exists()).toBe(true));

		expect(c.find('[data-testid="adopt-message"]').text()).toBe('Převzetí selhalo: složka je jen ke čtení');
		expect(c.emitted('adopted')).toBeUndefined();
	});
});
