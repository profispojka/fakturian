import { vi } from 'vitest';

import { useVault } from '~/composables/useVault';
import { useVaultData } from '~/composables/useVaultData';
import { DocumentKind } from '~/constants/invoice';
import { variableSymbolFor } from '~/utils/invoice';

import { backend } from './backend';
import { completeSupplier } from './fixtures';

import { invoiceArgument } from '../../desktop/invoice/model.ts';

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
 * Skládá se ze souhrnu, protože hlavní proces ten souhrn z dokladu zpátky dopočítá — částka i
 * odběratel proto musí sedět.
 */
function document(sh: InvoiceSummary): WireInvoice {
	const { name, ico, address, registration } = completeSupplier();
	return {
		number: sh.number,
		documentType: sh.documentType,
		originalInvoice: sh.originalInvoice,
		originalIssueDate: '',
		issueDate: sh.issueDate,
		dueDate: sh.dueDate ?? '',
		supplier: {
			name,
			ico,
			address,
			email: '',
			registration,
		},
		customer: {
			name: sh.customer,
			ico: '25596641',
			address: {
				street: 'Dlouhá 1',
				city: 'Praha',
				zip: '11000',
			},
			email: 'fakturace@acme.cz',
			registration: '',
		},
		bankAccount: '2000145399',
		bankCode: '0800',
		variableSymbol: sh.variableSymbol,
		lines: [
			{
				description: 'Práce',
				quantity: 1,
				unit: 'ks',
				unitPriceCents: Math.abs(sh.totalCents),
				usageYear: null,
			},
		],
	};
}

/** Doklad ve složce `faktury/`, uložený skutečným hlavním procesem. */
export async function documentInVault(sh: InvoiceSummary, path = '/vault'): Promise<void> {
	await backend.invoice(document(sh), path);
	if (!sh.sentAt) return;
	// Čas odeslání bere hlavní proces z hodin; souhrn ho určuje, tak se hodiny na chvíli nastaví.
	const before = vi.isFakeTimers() ? vi.getMockedSystemTime() : null;
	if (!before) vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(sh.sentAt);
	await backend.markSent(sh.number, path);
	if (before) vi.setSystemTime(before);
	else vi.useRealTimers();
}

/** Dobropis na celou fakturu `original` ze složky, uložený skutečným `save_invoice`. */
export async function creditNoteInVault(
	number: string,
	original: string,
	over: Partial<WireInvoice> = {},
): Promise<void> {
	const loaded = await backend.command('load_invoice', {
		vaultPath: '/vault',
		number: original,
	});
	const invoice = invoiceArgument(loaded);
	await backend.invoice({
		...invoice,
		number,
		uuid: '',
		documentType: DocumentKind.CreditNote,
		originalInvoice: original,
		originalIssueDate: invoice.issueDate,
		originalUuid: invoice.uuid,
		dueDate: invoice.issueDate,
		variableSymbol: variableSymbolFor(number),
		note: 'Zrušená zakázka',
		lines: invoice.lines.map((line) => ({
			...line,
			unitPriceCents: -line.unitPriceCents,
		})),
		...over,
	});
}
