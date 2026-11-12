import { flushPromises } from '@vue/test-utils';
import { expect } from 'vitest';
import { computed } from 'vue';

import { useInvoices } from '~/composables/useInvoices';
import { useVault } from '~/composables/useVault';
import { useVaultData } from '~/composables/useVaultData';
import { today } from '~/utils/date';
import { variableSymbolFor } from '~/utils/invoice';
import { z, type Zod } from '~/utils/zod';

import { backend } from './backend';
import { completeSupplier } from './fixtures';
import { mountPage } from './mount';
import { prepareVault } from './vault';

import type { VueWrapper } from '@vue/test-utils';
import type { Invoice as WireInvoice } from '~/bindings';
import type { Contact } from '~/schemas/customers';
import type { PriceItem } from '~/schemas/pricelist';
import type { Supplier } from '~/schemas/suppliers';

export function contact(id: string, name = 'Acme s.r.o.'): Contact {
	return {
		id,
		name,
		ico: '27082440',
		email: 'fakturace@acme.cz',
		address: {
			street: 'Dlouhá 1',
			city: 'Praha',
			zip: '11000',
		},
	};
}

export const state = {
	get vaultPath() {
		return useNuxtApp().vueApp.runWithContext(useVault).vaultPath;
	},
	get pendingInvoice() {
		return useNuxtApp().vueApp.runWithContext(useInvoices).pendingInvoice;
	},
	get supplier() {
		const { data } = useNuxtApp().vueApp.runWithContext(useVaultData);
		return computed({
			get: () => data.value.supplier,
			set: (v: Supplier | null) => (data.value.supplier = v),
		});
	},
	get contacts() {
		const { data } = useNuxtApp().vueApp.runWithContext(useVaultData);
		return computed({
			get: () => data.value.contacts,
			set: (v: Contact[]) => (data.value.contacts = v),
		});
	},
	get pricelist() {
		const { data } = useNuxtApp().vueApp.runWithContext(useVaultData);
		return computed({
			get: () => data.value.pricelist,
			set: (v: PriceItem[]) => (data.value.pricelist = v),
		});
	},
};

export async function prepareInvoicePage(
	content: {
		pricelist?: PriceItem[];
		usage?: { invoiceNumber: string; itemId: string; quantity: number }[];
	} = {},
): Promise<void> {
	await prepareVault({
		'nastaveni.json': {
			supplier: completeSupplier(),
			contacts: [],
			pricelist: content.pricelist ?? [],
		},
	});
	// Vyčerpaný limit nese archiv, takže se zakládá dokladem — zápis do souboru by testoval fikci.
	for (const usage of content.usage ?? []) {
		invoiceInVault(usage.invoiceNumber, {
			issueDate: today(),
			lines: [
				{
					description: 'Práce',
					quantity: usage.quantity,
					unit: 'hod',
					unitPriceCents: 100_000,
					itemId: usage.itemId,
				},
			],
		});
	}
}

export function savedDocuments(): Map<string, WireInvoice> {
	return backend.folder('/vault').invoices;
}

export function savedInvoice(sequence = 0): Zod.infer<typeof invoiceFromSave> {
	const calls = backend.args('save_invoice')[sequence];
	if (!calls) throw new Error(`Uložení se nezavolalo ${sequence + 1}×.`);
	return invoiceFromSave.parse(calls.invoice);
}

export function savedAsNew(sequence = 0): boolean {
	const calls = backend.args('save_invoice')[sequence];
	if (!calls) throw new Error(`Uložení se nezavolalo ${sequence + 1}×.`);
	return z.boolean().parse(calls.isNew);
}

export function previewInvoice(): Zod.infer<typeof invoiceFromSave> {
	const calls = backend.args('preview_invoice')[0];
	if (!calls) throw new Error('Náhled se nezavolal.');
	return invoiceFromSave.parse(calls.invoice);
}

const invoiceFromSave = z.object({
	number: z.string(),
	variableSymbol: z.string(),
	issueDate: z.string(),
	dueDate: z.string(),
	note: z.string(),
	documentType: z.number(),
	originalInvoice: z.string(),
	supplier: z.record(z.string(), z.unknown()),
	customer: z.record(z.string(), z.unknown()),
	lines: z.array(z.record(z.string(), z.unknown())),
});

export function invoiceInVault(number: string, over: Partial<WireInvoice> = {}): void {
	const inv: WireInvoice = {
		number,
		uuid: 'u1',
		documentType: 1,
		originalInvoice: '',
		originalIssueDate: '',
		originalUuid: '',
		issueDate: '2026-03-01',
		dueDate: '2026-03-15',
		supplier: {
			name: 'Já',
			ico: '',
			dic: '',
			address: {
				street: '',
				city: '',
				zip: '',
			},
			email: '',
			registration: '',
		},
		customer: {
			name: 'Acme s.r.o.',
			ico: '27082440',
			dic: '',
			address: {
				street: 'Dlouhá 1',
				city: 'Praha',
				zip: '11000',
			},
			email: 'fakturace@acme.cz',
			registration: '',
		},
		vatNote: '',
		bankAccount: '123',
		bankCode: '0800',
		iban: '',
		variableSymbol: variableSymbolFor(number),
		note: '',
		lines: [
			{
				description: 'Práce',
				quantity: 1,
				unit: 'hod',
				unitPriceCents: 100_000,
			},
		],
		...over,
	};
	backend.folder('/vault').invoices.set(number, inv);
}

export function mountInvoice(number = ''): Promise<VueWrapper> {
	return mountPage(invoiceRoute(number));
}

export function invoiceRoute(number = ''): string {
	if (!number) return '/invoice/new';
	return `/invoice/${number}`;
}

export async function save(c: VueWrapper): Promise<void> {
	await c.find('[data-testid="action-save"]').trigger('click');
	await flushPromises();
	await expect
		.poll(() => c.find('[data-testid="action-save"]').attributes('aria-busy'), { message: 'Ukládání nedoběhlo.' })
		.not.toBe('true');
	await flushPromises();
}
