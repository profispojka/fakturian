import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useState } from '#app';
import { useFio } from '~/composables/useFio';
import { addDays, today } from '~/utils/date';
import { czkFromCents } from '~/utils/money';

import { backend } from '../setup/backend';
import { date } from '../setup/dates';
import { LONG_AGO, TODAY, mount, openInvoiceList, savedPayments, summary, vaultS } from '../setup/invoice-list';
import { layer, enterDate } from '../setup/mount';
import { writes } from '../setup/vault';

const FIO_TOKEN = 'a'.repeat(64);

beforeEach(async () => {
	await openInvoiceList();
});

describe('platby faktury', () => {
	it('nezaplacená po splatnosti je označená', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					dueDate: LONG_AGO,
				}),
			],
		});
		const c = await mount();

		expect(c.find('[data-testid="invoice-payments-20260001"]').attributes('data-state')).toBe('overdue');
	});

	it('výpis otevřený přes půlnoc označí fakturu, která mezitím propadla', async () => {
		await vaultS({ invoices: [summary('20260001')] });
		const c = await mount();
		expect(c.find('[data-testid="invoice-payments-20260001"]').attributes('data-state')).toBe('issued');

		vi.setSystemTime('2026-09-01T00:05');
		await vi.advanceTimersByTimeAsync(60_000);
		await flushPromises();

		expect(c.find('[data-testid="invoice-payments-20260001"]').attributes('data-state')).toBe('overdue');
	});

	it('zaplacená se pozná podle stavu a nese datum poslední platby', async () => {
		await vaultS({
			invoices: [summary('20260001')],
			payments: {
				'20260001': [
					{
						id: 'p1',
						date: date('2026-08-01'),
						amountCents: 121_000,
					},
				],
			},
		});
		const c = await mount();

		const state = c.find('[data-testid="invoice-payments-20260001"]');
		expect(state.attributes('data-state')).toBe('paid');
		expect(state.attributes('title')).toBe('Platby faktury — poslední 1. 8. 2026');
		expect(c.find('[data-testid="invoice-payment-note-20260001"]').exists()).toBe(false);
	});

	it('zčásti uhrazená ukáže stav i uhrazenou část', async () => {
		await vaultS({
			invoices: [summary('20260001')],
			payments: {
				'20260001': [
					{
						id: 'p2',
						date: date('2026-08-01'),
						amountCents: 40_000,
					},
				],
			},
		});
		const c = await mount();

		const state = c.find('[data-testid="invoice-payments-20260001"]');
		expect(state.attributes('data-state')).toBe('partial');
		expect(state.text()).toBe('Zčásti uhrazeno');
		const note = c.find('[data-testid="invoice-payment-note-20260001"]');
		expect(note.text()).toContain('uhrazeno');
		expect(note.text()).toContain(czkFromCents(40_000));
		expect(note.attributes('data-overpaid')).toBeUndefined();
	});

	it('přeplatek ohlásí u částky i v platbách', async () => {
		await vaultS({
			invoices: [summary('20260001')],
			payments: {
				'20260001': [
					{
						id: 'p3',
						date: date('2026-08-01'),
						amountCents: 150_000,
					},
				],
			},
		});
		const c = await mount();

		expect(c.find('[data-testid="invoice-payments-20260001"]').attributes('data-state')).toBe('paid');
		const note = c.find('[data-testid="invoice-payment-note-20260001"]');
		expect(note.attributes('data-overpaid')).toBe('true');
		expect(note.text()).toContain(czkFromCents(29_000));

		await c.find('[data-testid="invoice-payments-20260001"]').trigger('click');
		await flushPromises();
		expect(layer().find('[data-testid="payments-overpaid"]').text()).toContain(czkFromCents(29_000));
	});

	it('klik na stav otevře platby se zbytkem k úhradě a zapsání fakturu uhradí dneškem', async () => {
		await vaultS({
			invoices: [summary('20260001')],
			payments: {
				'20260001': [
					{
						id: 'p4',
						date: date('2026-08-01'),
						amountCents: 21_000,
					},
				],
			},
		});
		const c = await mount();

		await c.find('[data-testid="invoice-payments-20260001"]').trigger('click');
		await flushPromises();
		expect(layer().find('[data-testid="payments-heading"]').text()).toBe('Platby faktury 20260001');
		expect(layer().find('[data-testid="payments-outstanding"]').text()).toContain(czkFromCents(100_000));
		expect(layer().findAll('[data-testid="payment-row"]')).toHaveLength(1);

		await layer().find('[data-testid="payment-record"]').trigger('click');
		await flushPromises();

		expect(savedPayments()['20260001']).toEqual([
			{
				id: 'p4',
				date: '2026-08-01',
				amountCents: 21_000,
			},
			{
				id: expect.any(String),
				date: TODAY,
				amountCents: 100_000,
			},
		]);
		expect(layer().find('[data-testid="payments-heading"]').exists()).toBe(false);
		expect(c.find('[data-testid="invoice-payments-20260001"]').attributes('data-state')).toBe('paid');
	});

	it('výpis otevřený přes půlnoc zapíše úhradu s novým dnem', async () => {
		await vaultS({ invoices: [summary('20260001')] });
		const c = await mount();
		vi.setSystemTime('2026-09-01T00:05');

		await c.find('[data-testid="invoice-payments-20260001"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="payment-record"]').trigger('click');
		await flushPromises();

		expect(savedPayments()['20260001']).toEqual([
			{
				id: expect.any(String),
				date: '2026-09-01',
				amountCents: 121_000,
			},
		]);
	});

	it('částečnou platbu zapíše s upravenou částkou', async () => {
		await vaultS({ invoices: [summary('20260001')] });
		const c = await mount();

		await c.find('[data-testid="invoice-payments-20260001"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="field-amountCents"]').setValue('400');
		await layer().find('[data-testid="field-amountCents"]').trigger('blur');
		await layer().find('[data-testid="payment-record"]').trigger('click');
		await flushPromises();

		expect(savedPayments()['20260001']).toEqual([
			{
				id: expect.any(String),
				date: TODAY,
				amountCents: 40_000,
			},
		]);
		expect(c.find('[data-testid="invoice-payments-20260001"]').attributes('data-state')).toBe('partial');
	});

	it('platbu zapíše se zadaným datem úhrady, ne s dneškem', async () => {
		await vaultS({ invoices: [summary('20260001')] });
		const c = await mount();

		await c.find('[data-testid="invoice-payments-20260001"]').trigger('click');
		await flushPromises();
		await enterDate(layer().find('[data-testid="field-date"]'), date('2026-08-14'));
		await layer().find('[data-testid="payment-record"]').trigger('click');
		await flushPromises();

		expect(savedPayments()['20260001']).toEqual([
			{
				id: expect.any(String),
				date: '2026-08-14',
				amountCents: 121_000,
			},
		]);
	});

	it('bez data úhrady platbu nezapíše', async () => {
		await vaultS({ invoices: [summary('20260001')] });
		const c = await mount();

		await c.find('[data-testid="invoice-payments-20260001"]').trigger('click');
		await flushPromises();
		await enterDate(layer().find('[data-testid="field-date"]'), undefined);
		await layer().find('[data-testid="payment-record"]').trigger('click');
		await flushPromises();

		expect(writes('platby.json')).toBe(0);
	});

	it('platbu s datem úhrady v budoucnu nezapíše a řekne proč', async () => {
		await vaultS({ invoices: [summary('20260001')] });
		const c = await mount();

		await c.find('[data-testid="invoice-payments-20260001"]').trigger('click');
		await flushPromises();
		await enterDate(layer().find('[data-testid="field-date"]'), addDays(today(), 1));
		await layer().find('[data-testid="payment-record"]').trigger('click');
		await flushPromises();

		expect(writes('platby.json')).toBe(0);
		expect(layer().find('[data-testid="field-date"]').attributes('aria-invalid')).toBe('true');
		expect(layer().find('[data-testid="field-amountCents"]').attributes('aria-invalid')).toBe('false');
	});

	it('nulovou částku nezapíše', async () => {
		await vaultS({ invoices: [summary('20260001')] });
		const c = await mount();

		await c.find('[data-testid="invoice-payments-20260001"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="field-amountCents"]').setValue('0');
		await layer().find('[data-testid="field-amountCents"]').trigger('blur');
		await layer().find('[data-testid="payment-record"]').trigger('click');
		await flushPromises();

		expect(writes('platby.json')).toBe(0);
		expect(layer().find('[data-testid="payments-heading"]').exists()).toBe(true);
	});

	it('smazání platby ji odebere z evidence a dialog nechá otevřený', async () => {
		await vaultS({
			invoices: [summary('20260001')],
			payments: {
				'20260001': [
					{
						id: 'p10',
						date: date('2026-08-01'),
						amountCents: 21_000,
					},
					{
						id: 'p11',
						date: date('2026-08-10'),
						amountCents: 50_000,
					},
				],
			},
		});
		const c = await mount();

		await c.find('[data-testid="invoice-payments-20260001"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="payment-remove-0"]').trigger('click');
		await flushPromises();

		expect(savedPayments()['20260001']).toEqual([
			{
				id: 'p11',
				date: '2026-08-10',
				amountCents: 50_000,
			},
		]);
		expect(layer().findAll('[data-testid="payment-row"]')).toHaveLength(1);
	});

	it('platbu z Fia označí a smazat ji nenabídne, ruční vedle ní ano', async () => {
		await vaultS({
			invoices: [summary('20260001')],
			payments: {
				'20260001': [
					{
						id: 'p13',
						date: date('2026-08-01'),
						amountCents: 21_000,
						fioId: 'm1',
					},
					{
						id: 'p14',
						date: date('2026-08-10'),
						amountCents: 50_000,
					},
				],
			},
		});
		const c = await mount();

		await c.find('[data-testid="invoice-payments-20260001"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="payment-fio"]').exists()).toBe(true);
		expect(layer().find('[data-testid="payment-remove-0"]').exists()).toBe(false);
		expect(layer().find('[data-testid="payment-remove-1"]').exists()).toBe(true);
	});

	it('nepovedený zápis platby ohlásí, stav vrátí a dialog nechá otevřený', async () => {
		await vaultS({ invoices: [summary('20260001')] });
		const c = await mount();
		backend.breaks('write_data_file', 'platby.json je zamčený');

		await c.find('[data-testid="invoice-payments-20260001"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="payment-record"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Platbu faktury 20260001 se nepodařilo uložit',
				description: 'platby.json je zamčený',
				color: 'error',
			}),
		);
		expect(layer().find('[data-testid="payments-heading"]').exists()).toBe(true);
		expect(c.find('[data-testid="invoice-payments-20260001"]').attributes('data-state')).toBe('issued');
		expect(savedPayments()['20260001']).toBeUndefined();
	});

	it('nepovedené smazání platby ohlásí a platbu nechá', async () => {
		await vaultS({
			invoices: [summary('20260001')],
			payments: {
				'20260001': [
					{
						id: 'p15',
						date: date('2026-08-01'),
						amountCents: 21_000,
					},
				],
			},
		});
		const c = await mount();
		backend.breaks('write_data_file', 'platby.json je zamčený');

		await c.find('[data-testid="invoice-payments-20260001"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="payment-remove-0"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Platbu faktury 20260001 se nepodařilo smazat',
				color: 'error',
			}),
		);
		expect(savedPayments()['20260001']).toEqual([
			{
				id: 'p15',
				date: '2026-08-01',
				amountCents: 21_000,
			},
		]);
		expect(layer().findAll('[data-testid="payment-row"]')).toHaveLength(1);
	});

	it('zavřený dialog nic nezapíše', async () => {
		await vaultS({ invoices: [summary('20260001')] });
		const c = await mount();

		await c.find('[data-testid="invoice-payments-20260001"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="payments-close"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="payments-heading"]').exists()).toBe(false);
		expect(writes('platby.json')).toBe(0);
	});
});

describe('synchronizace plateb z Fio', () => {
	it('bez tokenu se synchronizace nenabízí', async () => {
		const c = await mount();

		expect(c.find('[data-testid="action-sync-payments"]').exists()).toBe(false);
	});

	it('po prvním otevření výpisu se platby spárují samy', async () => {
		backend.fio.token = FIO_TOKEN;
		await vaultS({
			invoices: [
				summary('20260001', {
					totalCents: 121_000,
				}),
			],
		});
		backend.fio.movements = [
			{
				id: 'm1',
				amountCents: 121_000,
				vs: '20260001',
				date: '2026-07-05',
				message: '',
			},
		];
		const c = await mount();

		await vi.waitFor(() =>
			expect(savedPayments()['20260001']).toEqual([
				{
					id: expect.any(String),
					date: '2026-07-05',
					amountCents: 121_000,
					fioId: 'm1',
				},
			]),
		);
		expect(c.text()).toContain('Spárováno plateb: 1');
	});

	it('částečnou platbu z Fia zapíše a faktura zůstane zčásti uhrazená', async () => {
		backend.fio.token = FIO_TOKEN;
		await vaultS({
			invoices: [
				summary('20260001', {
					totalCents: 121_000,
				}),
			],
		});
		backend.fio.movements = [
			{
				id: 'm1',
				amountCents: 50_000,
				vs: '20260001',
				date: '2026-07-05',
				message: '',
			},
		];
		const c = await mount();

		await vi.waitFor(() =>
			expect(savedPayments()['20260001']).toEqual([
				{
					id: expect.any(String),
					date: '2026-07-05',
					amountCents: 50_000,
					fioId: 'm1',
				},
			]),
		);
		expect(c.find('[data-testid="invoice-payments-20260001"]').attributes('data-state')).toBe('partial');
	});

	it('pohyb zapsaný dřívější synchronizací znovu nezapíše ani nepočítá', async () => {
		backend.fio.token = FIO_TOKEN;
		await vaultS({
			invoices: [summary('20260001', { totalCents: 121_000 })],
			payments: {
				'20260001': [
					{
						id: 'p19',
						date: date('2026-07-05'),
						amountCents: 50_000,
						fioId: 'm1',
					},
				],
			},
		});
		backend.fio.movements = [
			{
				id: 'm1',
				amountCents: 50_000,
				vs: '20260001',
				date: '2026-07-05',
				message: '',
			},
		];

		await mount();

		await vi.waitFor(() => {
			expect(backend.notification).toEqual([
				{
					title: 'Fio synchronizace',
					body: 'Spárováno plateb: 0, nespárováno: 0.',
				},
			]);
		});
		expect(writes('platby.json')).toBe(0);
	});

	it('automatická synchronizace nepřepíše datum už uhrazené faktury', async () => {
		backend.fio.token = FIO_TOKEN;
		await vaultS({
			invoices: [summary('20260001', { totalCents: 121_000 })],
			payments: {
				'20260001': [
					{
						id: 'p20',
						date: date('2026-06-30'),
						amountCents: 121_000,
					},
				],
			},
		});
		backend.fio.movements = [
			{
				id: 'm1',
				amountCents: 121_000,
				vs: '20260001',
				date: date('2026-07-05'),
				message: '',
			},
		];

		await mount();

		await vi.waitFor(() => {
			expect(backend.notification).toEqual([
				{
					title: 'Fio synchronizace',
					body: 'Spárováno plateb: 0, nespárováno: 1.',
				},
			]);
		});
		expect(savedPayments()['20260001']).toEqual([
			{
				id: 'p20',
				date: '2026-06-30',
				amountCents: 121_000,
			},
		]);
	});

	it('výsledek pošle i do systémové notifikace', async () => {
		backend.fio.token = FIO_TOKEN;
		await mount();

		await vi.waitFor(() => {
			expect(backend.notification).toEqual([
				{
					title: 'Fio synchronizace',
					body: 'Spárováno plateb: 0, nespárováno: 0.',
				},
			]);
		});
	});

	it('selhání notifikace ohlásí toastem a výsledek nechá v liště', async () => {
		backend.fio.token = FIO_TOKEN;
		backend.breaks('notify', 'Notifikační centrum neodpovídá');
		const c = await mount();

		await vi.waitFor(() =>
			expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
				expect.objectContaining({
					title: 'Systémové oznámení se nepodařilo poslat',
					description: 'Notifikační centrum neodpovídá',
					color: 'error',
				}),
			),
		);
		expect(c.find('[data-testid="status-message"]').text()).toBe('Spárováno plateb: 0, nespárováno: 0.');
	});

	it('chybu z banky ohlásí toastem a nechá ji Integracím', async () => {
		backend.fio.token = FIO_TOKEN;
		backend.fio.unavailable = true;
		const c = await mount();
		await vi.waitFor(() =>
			expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
				expect.objectContaining({
					title: 'Fio synchronizace selhala',
					description: 'Nepodařilo se spojit s Fio (jste offline?).',
					color: 'error',
				}),
			),
		);
		expect(useFio().syncError.value).toContain('spojit s Fio');
		expect(c.find('[data-testid="invoices-footer"]').text()).not.toContain('spojit s Fio');
	});

	it('povedená synchronizace starou chybu zahodí', async () => {
		backend.fio.token = FIO_TOKEN;
		useFio().syncError.value = 'Nepodařilo se spojit s Fio';
		await mount();

		await vi.waitFor(() => expect(useFio().syncError.value).toBe(''));
		expect(backend.args('fio_fetch')).toHaveLength(1);
	});

	it('tlačítko spustí další synchronizaci i po tom prvním', async () => {
		useState<boolean>('fioAutoSynced', () => false).value = true;
		backend.fio.token = FIO_TOKEN;
		const c = await mount();

		await c.find('[data-testid="action-sync-payments"]').trigger('click');
		await flushPromises();

		expect(backend.args('fio_fetch')).toHaveLength(1);
	});

	it('dvojklik se do banky zeptá jen jednou', async () => {
		useState<boolean>('fioAutoSynced', () => false).value = true;
		backend.fio.token = FIO_TOKEN;
		backend.postpone('fio_fetch');
		const c = await mount();

		const button = c.find('[data-testid="action-sync-payments"]');
		void button.trigger('click');
		await button.trigger('click');
		await flushPromises();

		expect(backend.args('fio_fetch')).toHaveLength(1);
	});

	it('druhé otevření výpisu automatickou synchronizaci nespustí', async () => {
		useState<boolean>('fioAutoSynced', () => false).value = true;
		backend.fio.token = FIO_TOKEN;
		await mount();
		// Rozhodnutí o synchronizaci padá hned po odpovědi na dotaz po tokenu; potom už nic nečeká.
		await vi.waitFor(() => expect(backend.args('fio_has_token')).toEqual([{}]));
		await flushPromises();

		expect(backend.args('fio_fetch')).toEqual([]);
	});

	it('token se ověří hned po otevření stránky', async () => {
		await mount();
		expect(backend.args('fio_has_token')).toEqual([{}]);
	});
});
