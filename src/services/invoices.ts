import { commands } from '~/bindings';
import { invoiceFromVaultSchema, invoiceListSchema, type Invoice, type InvoiceList } from '~/schemas/invoices';
import { issuesText } from '~/utils/errors';
import { z } from '~/utils/zod';

import type { Invoice as WireInvoice } from '~/bindings';

// Kopíruje se do hloubky, ať nativní vrstva dostane snímek, ne živý stav formuláře.
function toWire(invoice: Invoice): WireInvoice {
	return {
		...invoice,
		dueDate: invoice.dueDate ?? '',
		originalIssueDate: invoice.originalIssueDate ?? '',
		supplier: {
			...invoice.supplier,
		},
		customer: {
			...invoice.customer,
		},
		lines: invoice.lines.map(({ id: _id, usageYear, ...line }) => ({
			...line,
			usageYear: usageYear ?? null,
		})),
	};
}

export const invoiceServices = {
	async load(vaultPath: string, number: string) {
		const raw = await commands.loadInvoice(vaultPath, number);
		const invoice = invoiceFromVaultSchema.safeParse(raw);
		if (!invoice.success) throw new Error(`Doklad má poškozený obsah (${issuesText(invoice.error)}).`);
		return invoice.data;
	},
	save(vaultPath: string, invoice: Invoice, isNew: boolean): Promise<string> {
		return commands.saveInvoice(vaultPath, toWire(invoice), isNew);
	},
	async preview(vaultPath: string, invoice: Invoice): Promise<string[]> {
		const raw = await commands.previewInvoice(vaultPath, toWire(invoice));
		const pages = z.array(z.string()).safeParse(raw);
		if (!pages.success) throw new Error(`Náhled má poškozený obsah (${issuesText(pages.error)}).`);
		return pages.data;
	},
	async list(vaultPath: string): Promise<InvoiceList> {
		const raw = await commands.listInvoices(vaultPath);
		const list = invoiceListSchema.safeParse(raw);
		if (!list.success) throw new Error(`Seznam faktur má poškozený obsah (${issuesText(list.error)}).`);
		return list.data;
	},
	async usedNumbers(vaultPath: string): Promise<string[]> {
		const raw = await commands.listUsedNumbers(vaultPath);
		const numbers = z.array(z.string()).safeParse(raw);
		if (!numbers.success)
			throw new Error(`Seznam použitých čísel má poškozený obsah (${issuesText(numbers.error)}).`);
		return numbers.data;
	},
	async exportPdf(vaultPath: string, number: string, target: string): Promise<void> {
		await commands.exportInvoicePdf(vaultPath, number, target);
	},
	markSent(vaultPath: string, number: string): Promise<string> {
		return commands.markInvoiceSent(vaultPath, number);
	},
	async remove(vaultPath: string, number: string): Promise<void> {
		await commands.deleteInvoice(vaultPath, number);
	},
};
