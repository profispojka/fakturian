import { vi } from 'vitest';

import { emptySupplier } from '~/schemas/suppliers';

import { date } from './dates';
import { summary as baseSummary } from './fixtures';
import { mountPage, goto } from './mount';
import { documentInVault, prepareVault, saved } from './vault';

import type { Contact } from '~/schemas/customers';
import type { InvoiceSummary } from '~/schemas/invoices';
import type { Payments } from '~/schemas/payments';
import type { Supplier } from '~/schemas/suppliers';

// Ne z `toISOString()`: v UTC by se po místní půlnoci rozcházel s appkou a sada by po nocích padala.
export const TODAY = '2026-08-31';
export const TODAY_DATE = date(TODAY);

export const LONG_AGO = date('2020-01-01');

// Seznam faktur počítá stav k dnešku; splatnost dnes je jediná, která ještě není po splatnosti.
export function summary(number: string, over: Partial<InvoiceSummary> = {}): InvoiceSummary {
	return baseSummary(number, {
		dueDate: TODAY_DATE,
		...over,
	});
}

export function mount() {
	return mountPage('/invoice');
}

export async function vaultS(
	content: {
		invoices?: InvoiceSummary[];
		contacts?: Contact[];
		payments?: Payments;
		supplier?: Supplier | null;
	} = {},
): Promise<void> {
	await prepareVault({
		'nastaveni.json': {
			supplier:
				content.supplier === undefined
					? {
							...emptySupplier(),
							defaultDueDays: 14,
						}
					: content.supplier,
			contacts: content.contacts ?? [],
			pricelist: [],
		},
		'platby.json': {
			payments: content.payments ?? {},
		},
	});
	for (const sh of content.invoices ?? []) documentInVault(sh);
}

export function savedPayments(): Record<string, unknown> {
	const payments = saved('platby.json').payments;
	if (!payments || typeof payments !== 'object') throw new Error('platby.json nemá pole payments.');
	return { ...payments };
}

export async function openInvoiceList(): Promise<void> {
	// `shouldAdvanceTime`: Nuxt UI si zpoždění bublin a překryvů řídí časovači a ty musí běžet dál —
	// zmrazit se má jen datum.
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime('2026-08-31T10:00');

	await goto('/invoice');
	await vaultS();
}
