import { newInvoice } from '~/schemas/invoices';
import { emptySupplier, type Supplier } from '~/schemas/suppliers';

import { date } from './dates';

import type { Invoice, InvoiceSummary } from '~/schemas/invoices';

export function completeSupplier(): Supplier {
	return {
		...emptySupplier(),
		name: 'Jan Novák',
		ico: '12345679',
		address: {
			street: 'Krátká 2',
			city: 'Brno',
			zip: '60200',
		},
		registration: 'Fyzická osoba zapsaná v živnostenském rejstříku, Živnostenský úřad Brno',
		bankAccount: '2000145399',
		bankCode: '0800',
	};
}

export function summary(number: string, over: Partial<InvoiceSummary> = {}): InvoiceSummary {
	return {
		number,
		customer: 'Acme',
		issueDate: date('2026-03-01'),
		dueDate: date('2026-03-15'),
		totalCents: 121_000,
		variableSymbol: number,
		documentType: 1,
		originalInvoice: '',
		sentAt: null,
		usageLines: [],
		path: `/vault/${number}.pdf`,
		...over,
	};
}

/** Doklad, který projde schématem — `save()` jiný k backendu nepustí. */
export function validInvoice(number: string): Invoice {
	const inv = newInvoice(null, number);
	inv.customer = {
		...inv.customer,
		name: 'Acme s.r.o.',
		ico: '25596641',
		address: {
			street: 'Dlouhá 1',
			city: 'Praha',
			zip: '11000',
		},
		email: 'fakturace@acme.cz',
	};
	inv.lines = [
		{
			id: 'r1',
			description: 'Práce',
			quantity: 1,
			unit: 'hod',
			unitPriceCents: 120_000,
		},
	];
	return inv;
}
