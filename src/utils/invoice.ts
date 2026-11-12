import { DocumentKind } from '~/constants/invoice';
import { monthOf, yearOf, daysBetween, today } from '~/utils/date';
import { lineCents } from '~/utils/money';

import type { InvoiceState } from '~/constants/invoice';
import type { Contact } from '~/schemas/customers';
import type { Invoice, InvoiceLine, InvoiceParty, InvoiceSummary } from '~/schemas/invoices';
import type { Supplier } from '~/schemas/suppliers';
import type { DateString } from '~/utils/date';
import type { Settlement } from '~/utils/payments';

/** Součet potřebuje z řádku jen tohle, takže sečte i doklad ve tvaru, v jakém chodí z backendu. */
type MoneyLine = Pick<InvoiceLine, 'quantity' | 'unitPriceCents'>;

export function lineTotalCents(l: MoneyLine): number {
	return lineCents(l.quantity, l.unitPriceCents);
}

export function invoiceTotalCents(inv: { lines: MoneyLine[] }): number {
	return inv.lines.reduce((sum, line) => sum + lineTotalCents(line), 0);
}

// Adresa se vypisuje po polích: uložená je `looseObject` a `...address` by na doklad přeneslo i cizí klíče.
export function supplierToParty(s: Supplier): InvoiceParty {
	return {
		name: s.name,
		ico: s.ico,
		dic: '',
		address: {
			street: s.address.street,
			city: s.address.city,
			zip: s.address.zip,
		},
		email: s.email ?? '',
		registration: s.registration,
	};
}

export function contactToParty(c: Contact): InvoiceParty {
	return {
		name: c.name,
		ico: c.ico,
		dic: c.dic ?? '',
		address: {
			street: c.address.street,
			city: c.address.city,
			zip: c.address.zip,
		},
		email: c.email ?? '',
		registration: '',
	};
}

export function partyToContact(party: InvoiceParty): Contact {
	return {
		id: crypto.randomUUID(),
		name: party.name,
		ico: party.ico,
		...(party.dic && { dic: party.dic }),
		address: {
			...party.address,
		},
		...(party.email && { email: party.email }),
	};
}

export function variableSymbolFor(number: string): string {
	return number.replace(/\D/g, '').slice(-10);
}

// Z originálu jen to, co se fakturuje. Dodavatel a účet z něj ne: po změně v Nastavení by duplikát
// poslal platbu na zrušený účet.
export function duplicateFrom(original: Invoice, blank: Invoice): Invoice {
	return {
		...blank,
		customer: original.customer,
		note: original.note,
		lines: original.lines.map(({ usageYear: _usageYear, ...line }) => line),
	};
}

export function daysOverdue(dueDate: DateString | undefined, todayDate: DateString): number {
	if (!dueDate) return 0;
	// Splatnost v budoucnosti dá zápornou vzdálenost; „mínus tři dny po splatnosti" nic neznamená.
	return Math.max(0, daysBetween(dueDate, todayDate));
}

/** Faktura, kterou dobropis opravuje, jak ji zná archiv. */
export interface CreditTarget {
	number: string;
	totalCents: number;
	/** Dobropisy k téže faktuře, kromě posuzovaného. */
	otherCreditNotes: string[];
}

// `undefined` = nejde o dobropis, `null` = opravovaná faktura v archivu není.
export function creditTargetOf(
	credit: Pick<Invoice, 'documentType' | 'number' | 'originalInvoice'>,
	archive: readonly InvoiceSummary[],
): CreditTarget | null | undefined {
	if (credit.documentType !== DocumentKind.CreditNote) return undefined;
	const original = archive.find(
		(i) => i.documentType === DocumentKind.Invoice && i.number === credit.originalInvoice,
	);
	if (!original) return null;
	return {
		number: original.number,
		totalCents: original.totalCents,
		otherCreditNotes: creditNotesOf(original.number, archive).filter((number) => number !== credit.number),
	};
}

export function creditNotesOf(invoiceNumber: string, archive: readonly InvoiceSummary[]): string[] {
	return archive
		.filter((i) => i.documentType === DocumentKind.CreditNote && i.originalInvoice === invoiceNumber)
		.map((i) => i.number);
}

export interface DeletionQuestion {
	title: string;
	message: string;
}

// Platby visí na čísle dokladu a zmizí s ním; bez zmínky by o ně uživatel přišel nevědomky.
export function deletionQuestion(
	invoice: Pick<InvoiceSummary, 'number' | 'documentType'>,
	paymentCount: number,
): DeletionQuestion {
	let kind = 'fakturu';
	if (invoice.documentType === DocumentKind.CreditNote) kind = 'dobropis';
	let message = `Opravdu chceš smazat ${kind} ${invoice.number}? PDF se přesune do Koše a číslo dokladu se uvolní.`;
	if (paymentCount > 0) message += ` Spolu s dokladem zmizí zapsané platby (${paymentCount}).`;
	return {
		title: `Smazat ${kind}?`,
		message,
	};
}

export function creditNoteFrom(original: Invoice, number: string): Invoice {
	const issue = today();
	return {
		...original,
		number,
		uuid: '',
		documentType: DocumentKind.CreditNote,
		originalInvoice: original.number,
		originalIssueDate: original.issueDate,
		originalUuid: original.uuid,
		issueDate: issue,
		dueDate: issue,
		variableSymbol: variableSymbolFor(number),
		note: '',
		lines: original.lines.map((l: InvoiceLine) => ({
			...l,
			usageYear: l.usageYear ?? yearOf(original.issueDate),
			// Otočení, ne `-Math.abs`: sleva z faktury se na dobropisu vrací kladná.
			unitPriceCents: -l.unitPriceCents,
		})),
	};
}

// Zčásti uhrazený doklad po splatnosti je po splatnosti: zbytek dluží stejně jako celou částku.
// Dobropis po splatnosti být nemůže — peníze posíláme my, ne odběratel.
export function invoiceState(
	invoice: Pick<InvoiceSummary, 'documentType' | 'dueDate'>,
	settlement: Pick<Settlement, 'outstandingCents' | 'paidCents' | 'credited'>,
	todayDate: DateString,
): InvoiceState {
	const settled = settlement.outstandingCents === 0;
	if (invoice.documentType === DocumentKind.CreditNote) {
		if (!settled) return settlement.paidCents === 0 ? 'refund' : 'refunding';
		return settlement.paidCents === 0 ? 'settled' : 'refunded';
	}
	if (settlement.credited) return 'credited';
	if (settled) return 'paid';
	if (invoice.dueDate && invoice.dueDate < todayDate) return 'overdue';
	if (settlement.paidCents !== 0) return 'partial';
	return 'issued';
}

export type InvoiceStateFilter = 'all' | 'paid' | 'unpaid' | 'overdue';

// „Uhrazené" jsou doklady, u kterých už nikdo nikomu nic nedluží.
const CLOSED_STATES: ReadonlySet<InvoiceState> = new Set(['paid', 'credited', 'refunded', 'settled']);

export function matchesStateFilter(s: InvoiceState, f: InvoiceStateFilter): boolean {
	if (f === 'all') return true;
	if (f === 'paid') return CLOSED_STATES.has(s);
	if (f === 'unpaid') return !CLOSED_STATES.has(s);
	return s === 'overdue';
}

export interface InvoiceDateFilter {
	year: number;
	month: number | 'all';
}

export function yearFilter(year: number): InvoiceDateFilter {
	return {
		year,
		month: 'all',
	};
}

export function matchesDateFilter(date: DateString, f: InvoiceDateFilter): boolean {
	if (yearOf(date) !== f.year) return false;
	return f.month === 'all' || monthOf(date) === f.month;
}
