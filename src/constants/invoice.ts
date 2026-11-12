import { DOCUMENT_TYPE_CREDIT_NOTE, DOCUMENT_TYPE_INVOICE } from '~/bindings';

export { NON_VAT_PAYER_NOTE } from '~/bindings';

// Druh dokladu z číselníku ISDOC; jiné číslo backend nepřečte.
export const DocumentKind = {
	Invoice: DOCUMENT_TYPE_INVOICE,
	CreditNote: DOCUMENT_TYPE_CREDIT_NOTE,
} as const;

export type DocumentType = (typeof DocumentKind)[keyof typeof DocumentKind];

// Splatnost nového dodavatele a faktury bez dodavatele.
export const DEFAULT_DUE_DAYS = 14;

export const STATE_LABELS = {
	paid: 'Zaplaceno',
	partial: 'Zčásti uhrazeno',
	overdue: 'Po splatnosti',
	issued: 'Vystaveno',
	credited: 'Dobropisováno',
	refund: 'K vrácení',
	refunding: 'Zčásti vráceno',
	refunded: 'Vráceno',
	settled: 'Vypořádáno',
} as const;

export type InvoiceState = keyof typeof STATE_LABELS;
