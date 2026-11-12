import { DocumentKind, NON_VAT_PAYER_NOTE, type DocumentType } from '~/constants/invoice';
import { LOCALE } from '~/constants/locales';
import { formatDate, parseDate } from '~/utils/date';
import { invoiceTotalCents, lineTotalCents } from '~/utils/invoice';

import { fmtnum, type Invoice, type InvoiceParty } from './model.ts';
import { paymentSymbol } from './payment.ts';

import { ISDOC_ATTACHMENT } from '../pdf.ts';
import TEMPLATE from '../templates/invoice.typ';

const FAKTURIAN_SITE = 'fakturian.app';

// Až za šablonou: `#set page` v šabloně by za jiným prvkem otevřel novou stránku.
const ISDOC_ATTACH = `#pdf.attach("${ISDOC_ATTACHMENT}", relationship: "source", mime-type: "text/xml", description: "ISDOC data faktury")`;

// `signDisplay: 'negative'`: `-0` by se jinak vypsalo `-0,00`.
const CZK = new Intl.NumberFormat(LOCALE, {
	// Stryker disable next-line StringLiteral: neplatný `signDisplay` hodí RangeError už při importu, takže se nespustí žádný test.
	signDisplay: 'negative',
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

export interface LineData {
	description: string;
	quantity: string;
	unit: string;
	unit_price: string;
	total: string;
}

// Data pro šablonu (`invoice.json`), všechno už naformátované: šablona nic nepočítá, takže se PDF
// nerozejde s obrazovkou. Nepovinný údaj je prázdný řetězec, ne `none` — šablona ho vynechá přes `opt()`.
export interface InvoiceData {
	title: 'Faktura' | 'Dobropis';
	number: string;
	original_invoice: string;
	issue_date: string;
	due_date: string;
	variable_symbol: string;
	bank_account: string;
	iban: string;
	currency: 'Kč';
	total: string;
	// Dobropis nic nevybírá: šablona podle toho vynechá splatnost i platební údaje.
	kind: 'invoice' | 'credit-note';
	due_label: 'K úhradě' | 'K vrácení';
	// Částka k úhradě nebo k vrácení, vždy kladná.
	due_total: string;
	note: string;
	vat_note: string;
	supplier: InvoiceParty;
	customer: InvoiceParty;
	lines: LineData[];
	has_logo: boolean;
	has_qr: boolean;
	web: string;
}

const PRINTED_KIND = {
	[DocumentKind.Invoice]: {
		title: 'Faktura',
		kind: 'invoice',
		due_label: 'K úhradě',
	},
	[DocumentKind.CreditNote]: {
		title: 'Dobropis',
		kind: 'credit-note',
		due_label: 'K vrácení',
	},
} satisfies Record<DocumentType, Pick<InvoiceData, 'title' | 'kind' | 'due_label'>>;

// Shodně s frontendovým `czkFromCents`, jen bez měny: tu šablona sází zvlášť.
export function czkCents(cents: number): string {
	return CZK.format(cents / 100);
}

// Co nejde rozebrat, projde beze změny: u cizího dokladu je původní zápis lepší než prázdno.
export function czDate(iso: string): string {
	const trimmed = iso.trim();
	const date = parseDate(trimmed);
	return date ? formatDate(date) : trimmed;
}

function bankAccountLabel(invoice: Invoice): string {
	if (!invoice.bankAccount) return '';
	if (!invoice.bankCode) return invoice.bankAccount;
	return `${invoice.bankAccount}/${invoice.bankCode}`;
}

function printedParty(party: InvoiceParty): InvoiceParty {
	return {
		...party,
		registration: party.registration.trim(),
	};
}

export function invoiceData(invoice: Invoice, hasQr: boolean, hasLogo: boolean): InvoiceData {
	const total = invoiceTotalCents(invoice);
	return {
		...PRINTED_KIND[invoice.documentType],
		number: invoice.number,
		original_invoice: invoice.originalInvoice,
		issue_date: czDate(invoice.issueDate),
		due_date: czDate(invoice.dueDate),
		variable_symbol: paymentSymbol(invoice),
		bank_account: bankAccountLabel(invoice),
		iban: invoice.iban,
		currency: 'Kč',
		total: czkCents(total),
		due_total: czkCents(Math.abs(total)),
		note: invoice.note,
		// Prázdnou větu nese doklad převzatý odjinud.
		vat_note: invoice.vatNote.trim() || NON_VAT_PAYER_NOTE,
		supplier: printedParty(invoice.supplier),
		customer: printedParty(invoice.customer),
		lines: invoice.lines.map((line) => ({
			description: line.description,
			quantity: fmtnum(line.quantity).replace('.', ','),
			unit: line.unit,
			unit_price: czkCents(line.unitPriceCents),
			total: czkCents(lineTotalCents(line)),
		})),
		has_logo: hasLogo,
		has_qr: hasQr,
		web: FAKTURIAN_SITE,
	};
}

// Zdroj dokladu čte data z `invoice.json` a vkládá `invoice.isdoc`, takže oba musí být mezi soubory
// pro typst.
export function invoiceTypst(): string {
	return `${TEMPLATE}\n${ISDOC_ATTACH}\n`;
}
