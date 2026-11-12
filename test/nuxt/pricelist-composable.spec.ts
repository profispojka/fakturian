import { beforeEach, describe, expect, it } from 'vitest';

import { useInvoices } from '~/composables/useInvoices';
import { usePricelist } from '~/composables/usePricelist';
import { useVaultData } from '~/composables/useVaultData';
import { newInvoice } from '~/schemas/invoices';

import { backend, wireInvoice } from '../setup/backend';
import { date } from '../setup/dates';
import { summary } from '../setup/fixtures';
import { savedField, prepareVault } from '../setup/vault';

import type { DocumentType } from '~/constants/invoice';
import type { Invoice } from '~/schemas/invoices';
import type { PriceItem } from '~/schemas/pricelist';
import type { PriceUsageRecord } from '~/utils/pricelist';

const VACATION: PriceItem = {
	id: 'p-dov',
	name: 'Konzultační činnost',
	note: 'dovolená',
	priceCents: 100_000,
	unit: 'hod',
	icon: 'i-lucide-tree-palm',
	annualLimit: 160,
};
const WORK: PriceItem = {
	id: 'p-prace',
	name: 'Práce',
	priceCents: 100_000,
	unit: 'hod',
};

function record(invoiceNumber: string, quantity: number, item: PriceItem = VACATION, year = 2026): PriceUsageRecord {
	return {
		invoiceNumber,
		year,
		itemId: item.id,
		quantity,
	};
}

/** Faktura s dovolenou: vazbu na ceník nese `itemId` řádku, ne jeho název. */
function invoiceWithVacation(number: string, hours: number, documentType: DocumentType = 1) {
	const inv = newInvoice(null, number);
	inv.issueDate = date('2026-03-01');
	inv.documentType = documentType;
	inv.lines = [
		{
			id: 'r1',
			description: VACATION.name,
			quantity: hours,
			unit: 'hod',
			unitPriceCents: 100_000,
			itemId: VACATION.id,
		},
	];
	return inv;
}

function savedPricelist(): PriceItem[] {
	return savedField('nastaveni.json', 'pricelist');
}

function inVault(inv: Invoice): void {
	backend.folder('/vault').invoices.set(inv.number, wireInvoice(inv));
}

function vacationInVault(number: string, hours = 8): void {
	inVault(invoiceWithVacation(number, hours));
}

beforeEach(async () => {
	await prepareVault({
		'nastaveni.json': {
			supplier: null,
			contacts: [],
			pricelist: [VACATION, WORK],
		},
	});
});

describe('položky ceníku', () => {
	it('uloží položku do konfigurace vaultu', async () => {
		const c = useNuxtApp().vueApp.runWithContext(usePricelist);
		await c.upsert({
			...VACATION,
			annualLimit: 200,
		});

		expect(c.pricelist.value.find((p) => p.id === VACATION.id)?.annualLimit).toBe(200);
		expect(savedPricelist().find((p) => p.id === VACATION.id)?.annualLimit).toBe(200);
	});

	it('smazání položky nesmaže historii vykázání', async () => {
		vacationInVault('20260001');
		const c = useNuxtApp().vueApp.runWithContext(usePricelist);
		await c.refreshUsage();

		await c.remove(VACATION.id);
		expect(c.pricelist.value.map((p) => p.id)).toEqual([WORK.id]);
		expect(c.records.value).toEqual([record('20260001', 8)]);
	});

	it('prázdná složka ukazuje celý limit', () => {
		const u = useNuxtApp().vueApp.runWithContext(usePricelist).usage(VACATION, 2026);

		expect(u.limit).toBe(160);
		expect(u.used).toBe(0);
	});
});

describe('vykázané množství z archivu', () => {
	it('sečte množství z dokladů ve složce', async () => {
		vacationInVault('20260001', 8);
		vacationInVault('20260002', 16);
		const c = useNuxtApp().vueApp.runWithContext(usePricelist);
		await c.refreshUsage();

		expect(c.records.value).toEqual([record('20260001', 8), record('20260002', 16)]);
		expect(c.usage(VACATION, 2026).used).toBe(24);
	});

	it('počítá i položku bez ročního limitu', async () => {
		const inv = newInvoice(null, '20260004');
		inv.issueDate = date('2026-03-01');
		inv.lines = [
			{
				id: 'r1',
				description: 'Práce',
				quantity: 5,
				unit: 'hod',
				unitPriceCents: 100_000,
				itemId: WORK.id,
			},
		];
		inVault(inv);

		const c = useNuxtApp().vueApp.runWithContext(usePricelist);
		await c.refreshUsage();
		expect(c.records.value).toEqual([record('20260004', 5, WORK)]);
	});

	it('faktura bez vazby na ceník do vykázání nemluví', async () => {
		const inv = newInvoice(null, '20260003');
		inv.issueDate = date('2026-03-01');
		inv.lines = [
			{
				id: 'r1',
				description: 'Cestovné',
				quantity: 120,
				unit: 'km',
				unitPriceCents: 800,
			},
		];
		inVault(inv);

		const c = useNuxtApp().vueApp.runWithContext(usePricelist);
		await c.refreshUsage();
		expect(c.records.value).toEqual([]);
	});

	it('řádek s vlastním ročníkem čerpá ten rok', async () => {
		const inv = invoiceWithVacation('20260001', 8);
		inv.lines[0]!.usageYear = 2025;
		inVault(inv);

		const c = useNuxtApp().vueApp.runWithContext(usePricelist);
		await c.refreshUsage();
		expect(c.records.value).toEqual([record('20260001', 8, VACATION, 2025)]);
		expect(c.usage(VACATION, 2026).used).toBe(0);
	});

	it('řádek bez ročníku čerpá rok vystavení', async () => {
		vacationInVault('20260001');
		const c = useNuxtApp().vueApp.runWithContext(usePricelist);
		await c.refreshUsage();

		expect(c.records.value).toEqual([record('20260001', 8, VACATION, 2026)]);
	});

	it('dobropis množství vrací, ne přičítá', async () => {
		vacationInVault('20260001', 16);
		inVault(invoiceWithVacation('20260002', 8, 2));
		const c = useNuxtApp().vueApp.runWithContext(usePricelist);
		await c.refreshUsage();

		expect(c.usage(VACATION, 2026).used).toBe(8);
	});

	it('doklad smazaný ze složky z limitu ubírat přestane', async () => {
		vacationInVault('20260001');
		const c = useNuxtApp().vueApp.runWithContext(usePricelist);
		await c.refreshUsage();
		expect(c.usage(VACATION, 2026).used).toBe(8);

		backend.folder('/vault').invoices.delete('20260001');
		await c.refreshUsage();
		expect(c.usage(VACATION, 2026).used).toBe(0);
	});

	it('přejmenování položky vykázání nezmění — váže se na `id`, ne na název', async () => {
		vacationInVault('20260001');
		const c = useNuxtApp().vueApp.runWithContext(usePricelist);
		await c.refreshUsage();

		useNuxtApp().vueApp.runWithContext(useVaultData).data.value.pricelist = [
			{
				...VACATION,
				name: 'Poradenství',
			},
			WORK,
		];
		expect(c.records.value).toEqual([record('20260001', 8)]);
	});
});

describe('čtení archivu', () => {
	it('bez předaného seznamu přečte faktury ze složky', async () => {
		vacationInVault('20260001');
		vacationInVault('20260005');
		const c = useNuxtApp().vueApp.runWithContext(usePricelist);

		await c.refreshUsage();
		expect(c.archive.value.map((i) => i.number)).toEqual(['20260001', '20260005']);
		expect(backend.args('list_invoices')).toEqual([{ vaultPath: '/vault' }]);
	});

	it('předaný seznam použije bez dalšího čtení složky', async () => {
		const c = useNuxtApp().vueApp.runWithContext(usePricelist);

		const usage = {
			usageLines: [
				{
					itemId: VACATION.id,
					quantity: 8,
				},
			],
		};
		await c.refreshUsage([summary('20260001', usage), summary('20260002', usage)]);
		expect(c.records.value).toEqual([record('20260001', 8), record('20260002', 8)]);
		expect(backend.args('list_invoices')).toEqual([]);
	});

	it('selhání čtení faktur nese chybu dál a seznam nechá být', async () => {
		vacationInVault('20260005');
		const c = useNuxtApp().vueApp.runWithContext(usePricelist);
		await c.refreshUsage();

		backend.breaks('list_invoices', 'vault je nedostupný');
		await expect(c.refreshUsage()).rejects.toBe('vault je nedostupný');
		expect(c.archive.value.map((i) => i.number)).toEqual(['20260005']);
	});
});

describe('roční limit', () => {
	it('faktura do limitu neblokuje', () => {
		expect(useNuxtApp().vueApp.runWithContext(usePricelist).overflows(invoiceWithVacation('20260001', 8))).toEqual(
			[],
		);
	});

	it('faktura nad roční limit blokuje a řekne, o kterou položku jde', () => {
		const p = useNuxtApp().vueApp.runWithContext(usePricelist).overflows(invoiceWithVacation('20260001', 200));

		expect(p).toHaveLength(1);
		expect(p[0]!.label).toBe('dovolená');
		expect(p[0]!.unit).toBe('hod');
	});

	it('zbývající množství nejde pod nulu', async () => {
		vacationInVault('20260009', 240);
		const c = useNuxtApp().vueApp.runWithContext(usePricelist);
		await c.refreshUsage();

		expect(c.remainingOn(invoiceWithVacation('20260001', 8), VACATION, 2026)).toBe(0);
	});

	it('vlastní množství faktury se do zbytku nepočítá', async () => {
		vacationInVault('20260001', 160);
		const c = useNuxtApp().vueApp.runWithContext(usePricelist);
		await c.refreshUsage();

		expect(c.remainingOn(invoiceWithVacation('20260001', 160), VACATION, 2026)).toBe(160);
	});

	it('smazaná faktura roční limit vrátí', async () => {
		vacationInVault('20260001', 160);
		vacationInVault('20260002', 16);
		const c = useNuxtApp().vueApp.runWithContext(usePricelist);
		await c.refreshUsage();
		expect(c.overflows(invoiceWithVacation('20260003', 8))).toHaveLength(1);

		await useNuxtApp().vueApp.runWithContext(useInvoices).remove('20260001');
		await c.refreshUsage();

		expect(c.usage(VACATION, 2026).used).toBe(16);
		expect(c.overflows(invoiceWithVacation('20260003', 8))).toEqual([]);
		expect(c.remainingOn(invoiceWithVacation('20260003', 8), VACATION, 2026)).toBe(144);
	});
});
