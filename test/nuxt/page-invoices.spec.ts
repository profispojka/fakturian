import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import InvoiceDateFilterPicker from '~/components/invoice/DateFilterPicker.vue';
import { useMenuStats } from '~/composables/useMenuStats';
import { czkFromCents } from '~/utils/money';

import { backend } from '../setup/backend';
import { date } from '../setup/dates';
import { LONG_AGO, TODAY_DATE, mount, openInvoiceList, summary, vaultS } from '../setup/invoice-list';
import { goto, currentPath, layer } from '../setup/mount';

beforeEach(async () => {
	await openInvoiceList();
});

describe('výpis faktur', () => {
	it('vypíše faktury i s částkou', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					totalCents: 1234_00,
				}),
			],
		});
		const c = await mount();

		expect(c.find('[data-testid="invoices-table"]').text()).toContain('20260001');
		expect(c.find('[data-testid="invoices-table"]').text()).toContain(czkFromCents(1234_00));
	});

	it('ukáže doklad vyžadující zásah vedle platných a otevře jeho umístění ve Finderu', async () => {
		await vaultS({ invoices: [summary('20260001')] });
		backend.returns('list_invoices', {
			items: [summary('20260001')],
			broken: [
				{
					fileName: '20260002.pdf',
					path: '/vault/faktury/20260002.pdf',
					reason: 'PDF nejde přečíst: invalid cross-reference table',
				},
			],
		});
		const c = await mount();

		expect(c.find('[data-testid="broken-invoice-row"]').text()).toContain('Doklad vyžaduje zásah');
		expect(c.find('[data-testid="broken-invoice-row"]').text()).toContain('20260002.pdf');
		expect(c.find('[data-testid="broken-invoice-row"]').text()).toContain('PDF nejde přečíst');
		expect(c.find('[data-testid="invoice-row"]').text()).toBe('20260001');
		expect(c.find('[data-testid="invoices-footer"]').text()).toContain('2 z 2 dokladů');
		await c.find('[data-testid="broken-invoice-reveal"]').trigger('click');
		await flushPromises();
		expect(backend.exposed).toEqual(['/vault/faktury/20260002.pdf']);
	});

	it('selhání Finderu se ohlásí', async () => {
		backend.returns('list_invoices', {
			items: [],
			broken: [
				{
					fileName: '20260002.pdf',
					path: '/vault/faktury/20260002.pdf',
					reason: 'PDF nejde přečíst',
				},
			],
		});
		backend.breaks('reveal_path', 'Finder neodpovídá');
		const c = await mount();

		await c.find('[data-testid="broken-invoice-reveal"]').trigger('click');
		await flushPromises();
		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Soubor se nepodařilo ukázat ve Finderu',
				description: 'Finder neodpovídá',
				color: 'error',
			}),
		);
	});

	it('dlouhý výpis nevykreslí všechny řádky naráz', async () => {
		const invoices = Array.from({ length: 120 }, (_, i) => summary(`2026${String(i + 1).padStart(4, '0')}`));
		await vaultS({ invoices });
		const c = await mount();

		expect(c.find('[data-testid="invoices-table"]').exists()).toBe(true);
		expect(c.findAll('[data-testid="invoice-row"]').length).toBeLessThan(120);
		expect(c.find('[data-testid="invoices-footer"]').text()).toContain('120 z 120 dokladů');
	});

	it('bez faktur to řekne', async () => {
		const c = await mount();
		expect(c.find('[data-testid="empty-state"]').exists()).toBe(true);
	});

	it('výchozí výpis ukáže jen letošní ročník a přizná se k tomu', async () => {
		await vaultS({
			invoices: [
				summary('20260001'),
				summary('20250007', {
					issueDate: date('2025-11-02'),
				}),
			],
		});
		const c = await mount();

		expect(c.findAll('[data-testid="invoice-row"]')).toHaveLength(1);
		expect(c.find('[data-testid="invoices-table"]').text()).toContain('20260001');
		expect(c.find('[data-testid="invoices-footer"]').text()).toContain('1 z 2 dokladů');
	});

	it('chybu při čtení ohlásí místo prázdné tabulky', async () => {
		backend.breaks('list_invoices', 'vault je nedostupný');
		const c = await mount();

		expect(c.text()).toContain('nedostupný');
	});

	it('načtený seznam předá levému panelu', async () => {
		await vaultS({ invoices: [summary('20260001')] });
		await mount();

		expect(useNuxtApp().vueApp.runWithContext(useMenuStats).items.value).toHaveLength(1);
		expect(backend.args('list_invoices')).toHaveLength(1);
	});

	it('chyba čtení levý panel nevynuluje', async () => {
		backend.breaks('list_invoices', 'vault je nedostupný');
		await mount();

		expect(useNuxtApp().vueApp.runWithContext(useMenuStats).items.value).toEqual([]);
	});

	it('hledá podle čísla i odběratele', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					customer: 'Acme',
				}),
				summary('20260002', {
					customer: 'Studio',
				}),
			],
		});
		const c = await mount();

		await c.find('[data-testid="invoice-search"]').setValue('studio');

		await vi.waitFor(() => expect(c.findAll('[data-testid="invoice-row"]')).toHaveLength(1));
	});

	it('bez shody to řekne', async () => {
		await vaultS({ invoices: [summary('20260001')] });
		const c = await mount();

		await c.find('[data-testid="invoice-search"]').setValue('nic');

		await vi.waitFor(() =>
			expect(c.find('[data-testid="empty-state-filtered"]').text()).toBe('Žádné položky nenalezeny.'),
		);
	});
});

describe('přehled a výběr dokladů', () => {
	it('řazení přepne pořadí dokladů podle data vystavení', async () => {
		await vaultS({
			invoices: [
				summary('20260001'),
				summary('20260002', {
					issueDate: date('2026-04-01'),
				}),
			],
		});
		const c = await mount();
		expect(c.findAll('[data-testid="invoice-row"]').map((row) => row.text())).toEqual(['20260002', '20260001']);

		await c.find('[data-testid="invoice-sort"]').trigger('click');
		await vi.waitFor(() =>
			expect(c.findAll('[data-testid="invoice-row"]').map((row) => row.text())).toEqual(['20260001', '20260002']),
		);
	});

	it('klik na řádek fakturu jen vybere', async () => {
		await vaultS({ invoices: [summary('20260001'), summary('20260002')] });
		const c = await mount();
		await c.find('[data-testid="invoice-entry-20260001"]').trigger('click');
		expect(c.find('[data-testid="invoice-entry-20260001"]').attributes('data-selected')).toBe('true');
		expect(c.find('[data-testid="invoice-entry-20260002"]').attributes('data-selected')).toBeUndefined();
		await flushPromises();
		expect(currentPath()).toBe('/invoice');
	});

	it('dvojklik na řádek fakturu otevře, jednoduchý klik ji jen vybere', async () => {
		await vaultS({ invoices: [summary('20260001'), summary('20260002')] });
		const c = await mount();
		await c.find('[data-testid="invoice-entry-20260001"]').trigger('click', { detail: 1 });
		await flushPromises();
		expect(currentPath()).toBe('/invoice');

		await c.find('[data-testid="invoice-entry-20260001"]').trigger('click', { detail: 2 });
		await vi.waitFor(() => expect(currentPath()).toBe('/invoice/20260001'));
	});

	it('hledání přepne výběr na viditelný doklad', async () => {
		await vaultS({ invoices: [summary('20260001'), summary('20260002')] });
		const c = await mount();
		await c.find('[data-testid="invoice-entry-20260002"]').trigger('click');
		await c.find('[data-testid="invoice-search"]').setValue('20260001');
		await vi.waitFor(() =>
			expect(c.find('[data-testid="invoice-entry-20260001"]').attributes('data-selected')).toBe('true'),
		);
		expect(c.find('[data-testid="invoice-entry-20260002"]').exists()).toBe(false);

		await c.find('[data-testid="invoice-actions-20260001"]').trigger('click');
		await vi.waitFor(() =>
			expect(layer().find('[data-testid="invoice-action-download-20260001"]').exists()).toBe(true),
		);
		expect(layer().find('[data-testid="invoice-action-download-20260002"]').exists()).toBe(false);
	});
});

describe('filtr stavu', () => {
	it('zúží výpis na neuhrazené', async () => {
		await vaultS({
			invoices: [summary('20260001'), summary('20260002')],
			payments: {
				'20260001': [
					{
						id: 'p1',
						date: TODAY_DATE,
						amountCents: 121_000,
					},
				],
			},
		});
		const c = await mount();

		await c.find('[data-testid="invoice-state-unpaid"]').trigger('click');

		await vi.waitFor(() => expect(c.findAll('[data-testid="invoice-row"]')).toHaveLength(1));
		expect(c.find('[data-testid="invoices-table"]').text()).toContain('20260002');
	});

	it('po splatnosti zúží výpis na doklady po splatnosti', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					dueDate: LONG_AGO,
				}),
				summary('20260002'),
			],
		});
		const c = await mount();

		await c.find('[data-testid="invoice-state-overdue"]').trigger('click');

		await vi.waitFor(() => expect(c.findAll('[data-testid="invoice-row"]')).toHaveLength(1));
		expect(c.find('[data-testid="invoices-table"]').text()).toContain('20260001');
	});

	it('výběrem měsíce se výpis zúží na vybraný měsíc', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					issueDate: date('2026-03-01'),
				}),
			],
		});
		const c = await mount();
		expect(c.findAll('[data-testid="invoice-row"]')).toHaveLength(1);

		await c.find('[data-testid="date-period"]').trigger('click');
		await vi.waitFor(() => expect(layer().find('[data-testid="date-pick-month-4"]').exists()).toBe(true));
		await layer().find('[data-testid="date-pick-month-4"]').trigger('click');

		await vi.waitFor(() => expect(c.findAll('[data-testid="invoice-row"]')).toHaveLength(0));
	});

	it('období, řazení a hledání vydrží odchod do jiné sekce a návrat', async () => {
		await vaultS({
			invoices: [
				summary('20250001', {
					issueDate: date('2025-03-01'),
				}),
				summary('20250002', {
					issueDate: date('2025-03-20'),
				}),
				summary('20260001'),
			],
		});
		const c = await mount();

		await c.find('[data-testid="date-period"]').trigger('click');
		await vi.waitFor(() => expect(layer().find('[data-testid="date-year"]').exists()).toBe(true));
		await layer().find('[data-testid="date-year"]').trigger('click');
		await layer().find('[data-testid="date-show-year-2025"]').trigger('click');
		await layer().find('[data-testid="date-pick-month-3"]').trigger('click');
		await c.find('[data-testid="invoice-sort"]').trigger('click');
		await c.find('[data-testid="invoice-search"]').setValue('2025');
		await vi.waitFor(() =>
			expect(c.findAll('[data-testid="invoice-row"]').map((row) => row.text())).toEqual(['20250001', '20250002']),
		);

		await goto('/customers');
		await goto('/invoice');

		expect(c.findAll('[data-testid="invoice-row"]').map((row) => row.text())).toEqual(['20250001', '20250002']);
		expect(c.find('[data-testid="date-period"]').text()).toBe('březen 2025');
		expect(c.find('[data-testid="invoice-sort"]').text()).toBe('Nejstarší');
		expect(c.find<HTMLInputElement>('[data-testid="invoice-search"]').element.value).toBe('2025');
	});

	it('výběr období nabídne letošek a roky s doklady, příští rok ne', async () => {
		await vaultS({
			invoices: [
				summary('20250001', {
					issueDate: date('2025-03-01'),
				}),
			],
		});
		const c = await mount();

		expect(c.findComponent(InvoiceDateFilterPicker).props('years')).toEqual([2026, 2025]);
	});
});
