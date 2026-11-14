import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMenuStats } from '~/composables/useMenuStats';
import { usePricelist } from '~/composables/usePricelist';
import { useVault } from '~/composables/useVault';

import { backend } from '../setup/backend';
import { date } from '../setup/dates';
import { summary } from '../setup/fixtures';
import { documentInVault, prepareVault } from '../setup/vault';

import type { Contact } from '~/schemas/customers';
import type { Expense } from '~/schemas/expenses';
import type { Payments } from '~/schemas/payments';
import type { PriceItem } from '~/schemas/pricelist';

function contact(id: string): Contact {
	return {
		id,
		name: `Odběratel ${id}`,
		ico: '27082440',
		address: {
			street: 'Dlouhá 1',
			city: 'Praha',
			zip: '11000',
		},
	};
}

// Doklady z ledna, dávno po splatnosti — panel je počítá do nezaplacených.
const OVERDUE = {
	issueDate: date('2026-01-15'),
	dueDate: date('2020-01-01'),
};

function pricelistItem(id: string): PriceItem {
	return {
		id,
		name: `Položka ${id}`,
		priceCents: 120_000,
		unit: 'hod',
	};
}

async function vaultWithContent(
	content: {
		payments?: Payments;
		expenses?: Expense[];
		contacts?: Contact[];
		pricelist?: PriceItem[];
	} = {},
): Promise<void> {
	await prepareVault({
		'nastaveni.json': {
			supplier: null,
			contacts: content.contacts ?? [],
			pricelist: content.pricelist ?? [],
		},
		'platby.json': {
			payments: content.payments ?? {},
		},
		'vydaje.json': {
			expenses: content.expenses ?? [],
		},
	});
}

beforeEach(async () => {
	vi.useFakeTimers();
	vi.setSystemTime('2026-08-31T10:00');

	await vaultWithContent();
});

describe('načtení podkladů pro panel', () => {
	it('jedním čtením načte doklady panelu i archiv ceníku', async () => {
		documentInVault(summary('20260001', OVERDUE));
		documentInVault(summary('20260002', OVERDUE));
		const m = useNuxtApp().vueApp.runWithContext(useMenuStats);

		await m.refresh();
		expect(m.items.value.map((invoice) => invoice.number)).toEqual(['20260001', '20260002']);
		expect(
			useNuxtApp()
				.vueApp.runWithContext(usePricelist)
				.archive.value.map((invoice) => invoice.number),
		).toEqual(['20260001', '20260002']);
		expect(backend.args('list_invoices')).toEqual([{ vaultPath: '/vault' }]);
	});

	it('bez datové složky je seznam prázdný', async () => {
		useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value = null;
		const m = useNuxtApp().vueApp.runWithContext(useMenuStats);

		await m.refresh();
		expect(m.items.value).toEqual([]);
		expect(backend.args('list_invoices')).toEqual([]);
	});

	it('chyba při čtení nevyhodí výjimku', async () => {
		backend.breaks('list_invoices', 'vault je nedostupný');

		await expect(useNuxtApp().vueApp.runWithContext(useMenuStats).refresh()).resolves.toBeUndefined();
	});

	it('neúspěšné čtení nezmění nezaplacené na „vše zaplaceno"', async () => {
		documentInVault(summary('20260001', OVERDUE));
		documentInVault(summary('20260002', OVERDUE));
		const m = useNuxtApp().vueApp.runWithContext(useMenuStats);
		await m.refresh();

		backend.breaks('list_invoices', 'vault je nedostupný');
		await m.refresh();

		expect(m.items.value).toHaveLength(2);
		expect(m.stats.value.unpaid).toBe('2');
		expect(m.error.value).toContain('vault je nedostupný');
	});

	it('po zotavení důvod zmizí', async () => {
		backend.breaks('list_invoices', 'vault je nedostupný');
		const m = useNuxtApp().vueApp.runWithContext(useMenuStats);
		await m.refresh();
		expect(m.error.value).not.toBe('');

		backend.repairs('list_invoices');
		documentInVault(summary('20260001', OVERDUE));
		await m.refresh();
		expect(m.error.value).toBe('');
	});

	it('převzatý seznam smaže starý důvod výpadku', async () => {
		backend.breaks('list_invoices', 'vault je nedostupný');
		const m = useNuxtApp().vueApp.runWithContext(useMenuStats);
		await m.refresh();

		m.setItems([summary('20260001', OVERDUE)]);
		expect(m.error.value).toBe('');
	});

	it('bez datové složky se důvod výpadku nedrží', async () => {
		backend.breaks('list_invoices', 'vault je nedostupný');
		const m = useNuxtApp().vueApp.runWithContext(useMenuStats);
		await m.refresh();

		useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value = null;
		await m.refresh();
		expect(m.error.value).toBe('');
		expect(m.items.value).toEqual([]);
	});

	it('převezme seznam od volajícího bez dalšího čtení', () => {
		const m = useNuxtApp().vueApp.runWithContext(useMenuStats);
		m.setItems([summary('20260001', OVERDUE), summary('20260002', OVERDUE)]);

		expect(m.items.value).toHaveLength(2);
		expect(backend.args('list_invoices')).toEqual([]);
	});

	it('seznam sdílí celá appka', async () => {
		documentInVault(summary('20260001', OVERDUE));
		await useNuxtApp().vueApp.runWithContext(useMenuStats).refresh();

		expect(useNuxtApp().vueApp.runWithContext(useMenuStats).items.value).toHaveLength(1);
	});
});

describe('odznaky v panelu', () => {
	it('prázdný vault nedá žádný odznak', () => {
		expect(useNuxtApp().vueApp.runWithContext(useMenuStats).stats.value).toEqual({
			unpaid: '',
			expensesMonth: '',
		});
	});

	it('spočítá nezaplacené', () => {
		const m = useNuxtApp().vueApp.runWithContext(useMenuStats);
		m.setItems([summary('20260001', OVERDUE), summary('20260002', OVERDUE)]);
		useNuxtApp().vueApp.runWithContext(usePayments).payments.value['20260001'] = [
			{
				id: 'p1',
				date: date('2026-08-01'),
				amountCents: 121_000,
			},
		];

		expect(m.stats.value.unpaid).toBe('1');
	});

	it('odběratele ani položky ceníku nepočítá', async () => {
		await vaultWithContent({
			contacts: [contact('k1'), contact('k2')],
			pricelist: [pricelistItem('p1')],
		});

		expect(useNuxtApp().vueApp.runWithContext(useMenuStats).stats.value).toEqual({
			unpaid: '',
			expensesMonth: '',
		});
	});

	it('sečte výdaje za aktuální měsíc', async () => {
		await vaultWithContent({
			expenses: [
				{
					id: 'v1',
					supplier: 'S',
					description: '',
					amountCents: 500_00,
					date: date('2026-08-05'),
				},
				{
					id: 'v2',
					supplier: 'S',
					description: '',
					amountCents: 300_00,
					date: date('2026-07-05'),
				},
			],
		});

		const NBSP = String.fromCharCode(0x00a0);
		expect(useNuxtApp().vueApp.runWithContext(useMenuStats).stats.value.expensesMonth).toBe(`500${NBSP}Kč`);
	});

	it('po přelomu měsíce počítá výdaje nového měsíce', async () => {
		await vaultWithContent({
			expenses: [
				{
					id: 'v1',
					supplier: 'S',
					description: '',
					amountCents: 500_00,
					date: date('2026-08-05'),
				},
			],
		});
		const m = useNuxtApp().vueApp.runWithContext(useMenuStats);
		expect(m.stats.value.expensesMonth).not.toBe('');

		vi.setSystemTime('2026-09-01T00:05');
		vi.advanceTimersByTime(60_000);

		expect(m.stats.value.expensesMonth).toBe('');
	});
});
