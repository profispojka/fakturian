import { flushPromises } from '@vue/test-utils';
import { vi } from 'vitest';
import { defineComponent, h } from 'vue';

import { useMcp } from '~/composables/useMcp';
import { newInvoice } from '~/schemas/invoices';
import { emptySupplier } from '~/schemas/suppliers';
import { z, type Zod } from '~/utils/zod';

import { backend, wireInvoice } from './backend';
import { date } from './dates';
import { mountUi } from './mount';
import { prepareVault } from './vault';

import type { Contact } from '~/schemas/customers';
import type { Expense } from '~/schemas/expenses';
import type { Payments } from '~/schemas/payments';
import type { PriceItem } from '~/schemas/pricelist';

export const VACATION: PriceItem = {
	id: 'p-dov',
	name: 'Konzultační činnost',
	note: 'dovolená',
	priceCents: 120_000,
	unit: 'hod',
	annualLimit: 160,
};

export function documentNumber(invoice: unknown): string {
	const number = invoice && typeof invoice === 'object' && 'number' in invoice ? invoice.number : null;
	if (typeof number !== 'string') throw new Error('save_invoice dostal doklad bez čísla.');
	return number;
}

export async function vaultWithContent(
	content: {
		contacts?: Contact[];
		expenses?: Expense[];
		payments?: Payments;
	} = {},
): Promise<void> {
	await prepareVault({
		'nastaveni.json': {
			supplier: {
				...emptySupplier(),
				name: 'Jan Novák',
				ico: '12345679',
			},
			contacts: content.contacts ?? [],
			pricelist: [VACATION],
		},
		'platby.json': {
			payments: content.payments ?? {},
		},
		'vydaje.json': {
			expenses: content.expenses ?? [],
		},
	});
}

/** Vykázané množství nese archiv, takže se čerpání zakládá dokladem ve složce. */
export function usageInVault(number: string, quantity: number): void {
	const inv = newInvoice(null, number);
	inv.issueDate = date('2026-03-01');
	inv.lines = [
		{
			id: 'r1',
			description: VACATION.name,
			quantity,
			unit: 'hod',
			unitPriceCents: 120_000,
			itemId: VACATION.id,
		},
	];
	backend.folder('/vault').invoices.set(number, wireInvoice(inv));
}

export function completeContact(id: string, name: string) {
	return {
		id,
		name,
		ico: '25596641',
		email: 'fakturace@acme.cz',
		address: {
			street: 'Dlouhá 1',
			city: 'Praha',
			zip: '11000',
		},
	};
}

/** Posluchač eventu visí na scope komponenty a potvrzovací dialog vykresluje `UApp` kolem ní. */
export const McpHost = defineComponent({
	name: 'McpHost',
	setup() {
		useMcp();
		return () => h('div');
	},
});

export async function connectAgent(): Promise<void> {
	mountUi(McpHost);
	await flushPromises();
}

const messageSchema = z.object({
	jsonrpc: z.literal('2.0'),
	id: z.union([z.number(), z.null()]).optional(),
	result: z.unknown().optional(),
	error: z
		.object({
			code: z.number(),
			message: z.string(),
		})
		.optional(),
});

const toolResultSchema = z.object({
	content: z.tuple([
		z.object({
			type: z.literal('text'),
			text: z.string(),
		}),
	]),
	isError: z.boolean().optional(),
});

/** Zprávy, které okno poslalo klientovi do spojení `session`. */
export function sentTo(session = 1): Zod.infer<typeof messageSchema>[] {
	return backend
		.args('mcp_send')
		.filter((a) => a.session === session)
		.map((a) => messageSchema.parse(JSON.parse(String(a.line))));
}

export function responsesTo(id: number, session = 1): Zod.infer<typeof messageSchema>[] {
	return sentTo(session).filter((m) => m.id === id);
}

/**
 * Počká na výsledek nástroje a vrátí ho, jak ho čte agent: JSON z textu, nebo text chyby `isError`.
 * Chyba protokolu shodí test, aby ji nešlo zaměnit za chybu nástroje.
 */
export async function replyTo(id: number, session = 1): Promise<{ result: unknown; error: string | null }> {
	const [response] = await vi.waitFor(() => {
		const found = responsesTo(id, session);
		if (found.length === 0) throw new Error(`Okno na požadavek ${id} zatím neodpovědělo.`);
		return found;
	});
	if (response?.error) throw new Error(`Okno odpovědělo chybou protokolu: ${response.error.message}`);
	const {
		content: [{ text }],
		isError,
	} = toolResultSchema.parse(response?.result);
	if (isError) {
		return {
			result: null,
			error: text,
		};
	}
	return {
		result: JSON.parse(text),
		error: null,
	};
}

/** Toasty s nadpisem `title`; jeden toast se v DOM vykresluje víckrát, proto z fronty. */
export function toasts(title: string): { description: string | undefined; color: string | undefined }[] {
	return useNuxtApp()
		.vueApp.runWithContext(useToast)
		.toasts.value.filter((t) => t.title === title)
		.map((t) => ({
			description: typeof t.description === 'string' ? t.description : undefined,
			color: t.color,
		}));
}
