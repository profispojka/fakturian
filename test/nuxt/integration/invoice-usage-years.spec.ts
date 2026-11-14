import { beforeEach, describe, expect, it } from 'vitest';

import { useInvoices } from '~/composables/useInvoices';
import { usePricelist } from '~/composables/usePricelist';
import { newInvoice } from '~/schemas/invoices';
import { creditNoteFrom, duplicateFrom } from '~/utils/invoice';

import { backend } from '../setup/backend';
import { invoiceInVault, mountInvoice, prepareInvoicePage, save, savedInvoice, state } from '../setup/invoice-page';

import type { PriceUsageRecord } from '~/utils/pricelist';

const ITEM = {
	id: 'p1',
	name: 'Práce',
	priceCents: 100_000,
	unit: 'hod',
	annualLimit: 20,
};
const LINE = {
	itemId: 'p1',
	description: 'Práce',
	quantity: 8,
	unit: 'hod',
	unitPriceCents: 100_000,
};

/** Vykázané množství není v souboru — spočítá se z archivu, tak se z něj i čte. */
async function usageFromVault(): Promise<PriceUsageRecord[]> {
	const c = useNuxtApp().vueApp.runWithContext(usePricelist);
	await c.refreshUsage();
	return c.records.value;
}

beforeEach(async () => {
	await prepareInvoicePage({ pricelist: [ITEM] });
});

describe('rok čerpání u řádku faktury', () => {
	it('dva řádky téže položky se uloží do různých let a otevřou se beze změny', async () => {
		invoiceInVault('20260001', {
			lines: [
				LINE,
				{
					...LINE,
					quantity: 4,
				},
			],
		});
		const c = await mountInvoice('20260001');
		await c.find('[data-testid="item-usage-year-0"]').setValue('2025');
		await c.find('[data-testid="item-usage-year-0"]').trigger('blur');
		await c.find('[data-testid="item-usage-year-1"]').setValue('2026');
		await c.find('[data-testid="item-usage-year-1"]').trigger('blur');
		await save(c);

		// Rok jde do dokladu — jinak by ho dva řádky téže položky neunesly.
		expect(savedInvoice().lines).toEqual([
			{
				...LINE,
				usageYear: 2025,
			},
			{
				...LINE,
				quantity: 4,
				usageYear: 2026,
			},
		]);
		expect(await usageFromVault()).toEqual([
			{
				invoiceNumber: '20260001',
				itemId: 'p1',
				year: 2025,
				quantity: 8,
			},
			{
				invoiceNumber: '20260001',
				itemId: 'p1',
				year: 2026,
				quantity: 4,
			},
		]);

		const reopened = await useNuxtApp().vueApp.runWithContext(useInvoices).load('20260001');
		expect(reopened.lines.map((line) => line.usageYear)).toEqual([2025, 2026]);
	});

	it('vykázaný rok se bere z dokladu, ne z roku vystavení', async () => {
		invoiceInVault('20260001', {
			lines: [
				{
					...LINE,
					usageYear: 2024,
				},
			],
		});

		const invoice = await useNuxtApp().vueApp.runWithContext(useInvoices).load('20260001');
		expect(invoice.lines[0]?.usageYear).toBe(2024);
		expect(await usageFromVault()).toEqual([
			{
				invoiceNumber: '20260001',
				itemId: 'p1',
				year: 2024,
				quantity: 8,
			},
		]);
	});

	it('překročení kontroluje v každém roce zvlášť a změna roku dovolí uložení', async () => {
		invoiceInVault('20259001', {
			lines: [
				{
					...LINE,
					quantity: 18,
					usageYear: 2025,
				},
			],
		});
		invoiceInVault('20260001', { lines: [LINE] });
		const c = await mountInvoice('20260001');
		await c.find('[data-testid="item-usage-year-0"]').setValue('2025');
		await c.find('[data-testid="item-usage-year-0"]').trigger('blur');
		await save(c);
		expect(backend.args('save_invoice')).toEqual([]);
		expect(c.find('[data-testid="limit-watch"]').text()).toContain('za 2025 zbývá 2 hod');
		await c.find('[data-testid="item-usage-year-0"]').setValue('2026');
		await c.find('[data-testid="item-usage-year-0"]').trigger('blur');
		await save(c);
		expect(savedInvoice().number).toBe('20260001');
	});

	it('faktura vystavená po otevření stránky se do limitu při uložení započítá', async () => {
		invoiceInVault('20260001', { lines: [LINE] });
		const c = await mountInvoice('20260001');
		// Agent přes MCP vystaví fakturu, zatímco formulář stojí otevřený nad archivem bez ní.
		invoiceInVault('20260002', {
			lines: [
				{
					...LINE,
					quantity: 18,
				},
			],
		});

		await save(c);

		expect(backend.args('save_invoice')).toEqual([]);
		expect(c.find('[data-testid="limit-watch"]').text()).toContain('za 2026 zbývá 2 hod');
	});

	it('rok kratší než čtyři číslice se při opuštění pole zvedne na 1000', async () => {
		invoiceInVault('20260001', { lines: [LINE] });
		const c = await mountInvoice('20260001');
		const year = c.find<HTMLInputElement>('[data-testid="item-usage-year-0"]');
		await year.setValue('999');
		await year.trigger('blur');

		await save(c);

		expect(year.element.value).toBe('1000');
		expect(savedInvoice().lines).toEqual([
			{
				...LINE,
				usageYear: 1000,
			},
		]);
	});

	it('prázdné pole nabízí rok vystavení a smazaný rok vrátí čerpání k němu', async () => {
		invoiceInVault('20260001', {
			lines: [
				{
					...LINE,
					usageYear: 2025,
				},
			],
		});
		const c = await mountInvoice('20260001');
		const year = c.find<HTMLInputElement>('[data-testid="item-usage-year-0"]');
		await year.setValue('');
		await year.trigger('blur');

		await save(c);

		expect(year.element.placeholder).toBe('2026');
		expect(savedInvoice().lines).toEqual([
			{
				...LINE,
				usageYear: null,
			},
		]);
	});

	it('položka bez limitu nemá pole roku a čerpá z roku vystavení', async () => {
		state.pricelist.value = [
			{
				...ITEM,
				annualLimit: undefined,
			},
		];
		invoiceInVault('20260001', { lines: [LINE] });
		const c = await mountInvoice('20260001');
		expect(c.find('[data-testid="item-usage-year-0"]').exists()).toBe(false);
		await save(c);
		const usage = await usageFromVault();
		expect(usage[0]?.year).toBe(2026);
	});

	it('doklad bez roku čerpá z roku vystavení a dobropis vrátí původní čerpání', async () => {
		invoiceInVault('20260001', { lines: [LINE] });
		const invoice = await useNuxtApp().vueApp.runWithContext(useInvoices).load('20260001');
		expect(invoice.lines[0]?.usageYear).toBeUndefined();

		const credit = creditNoteFrom(invoice, '20260002');
		expect(credit.lines[0]?.usageYear).toBe(2026);
		invoiceInVault('20260002', {
			documentType: 2,
			lines: [
				{
					...LINE,
					usageYear: 2026,
				},
			],
		});

		expect(await usageFromVault()).toEqual([
			{
				invoiceNumber: '20260001',
				itemId: 'p1',
				year: 2026,
				quantity: 8,
			},
			{
				invoiceNumber: '20260002',
				itemId: 'p1',
				year: 2026,
				quantity: -8,
			},
		]);
		expect(duplicateFrom(invoice, newInvoice(null, '20260003')).lines[0]?.usageYear).toBeUndefined();
	});

	it('poškozený rok se odmítne na hranici dokladu', async () => {
		invoiceInVault('20260001', {
			lines: [
				{
					...LINE,
					usageYear: 2025.5,
				},
			],
		});

		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).load('20260001')).rejects.toThrow(
			new Error('Doklad má poškozený obsah (lines.0.usageYear: Neplatný vstup: očekáváno int, obdrženo číslo).'),
		);
	});
});
