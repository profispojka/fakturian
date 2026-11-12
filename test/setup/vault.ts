import { useVault } from '~/composables/useVault';
import { useVaultData } from '~/composables/useVaultData';

import { backend } from './backend';

import type { Invoice as WireInvoice } from '~/bindings';
import type { InvoiceSummary } from '~/schemas/invoices';

export async function prepareVault(content: Record<string, unknown> = {}, path = '/vault'): Promise<void> {
	backend.create(path);
	for (const [name, data] of Object.entries(content)) backend.writeFile(path, name, data);
	await useNuxtApp().vueApp.runWithContext(useVault).setVault(path);
	await useNuxtApp().vueApp.runWithContext(useVaultData).load();
}

export function saved(name: string, path = '/vault'): Record<string, unknown> {
	return backend.readFile(path, name);
}

export function writes(name: string): number {
	return backend.calls.filter((v) => v.command === 'write_data_file' && v.args.name === name).length;
}

export function savedField<T>(name: string, key: string, path = '/vault'): T[] {
	const value = saved(name, path)[key];
	if (!Array.isArray(value)) throw new Error(`Soubor ${name} nemá pole ${key}.`);
	return value;
}

/**
 * Skládá se ze souhrnu, protože nativní vrstva ten souhrn z dokladu zpátky dopočítá — částka i
 * odběratel proto musí sedět.
 */
function document(sh: InvoiceSummary): WireInvoice {
	return {
		number: sh.number,
		uuid: 'u1',
		documentType: sh.documentType,
		originalInvoice: sh.originalInvoice,
		originalIssueDate: '',
		originalUuid: '',
		issueDate: sh.issueDate.toString(),
		dueDate: sh.dueDate?.toString() ?? '',
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
			name: sh.customer,
			ico: '',
			dic: '',
			address: {
				street: '',
				city: '',
				zip: '',
			},
			email: 'a@b.cz',
			registration: '',
		},
		vatNote: '',
		bankAccount: '123',
		bankCode: '0800',
		iban: '',
		variableSymbol: sh.variableSymbol,
		note: '',
		lines: [
			{
				description: 'Práce',
				quantity: 1,
				unit: 'ks',
				unitPriceCents: Math.abs(sh.totalCents),
			},
		],
	};
}

export function documentInVault(sh: InvoiceSummary, path = '/vault'): void {
	backend.folder(path).invoices.set(sh.number, document(sh));
	if (sh.sentAt) backend.folder(path).sent.set(sh.number, sh.sentAt);
}
