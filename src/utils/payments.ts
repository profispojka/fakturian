import { DocumentKind } from '~/constants/invoice';

import type { InvoiceSummary } from '~/schemas/invoices';
import type { Payments, ReceivedPayment } from '~/schemas/payments';
import type { DateString } from '~/utils/date';

export interface Settlement {
	paidCents: number;
	outstandingCents: number;
	overpaidCents: number;
	/** K faktuře existuje dobropis. */
	credited: boolean;
}

/** Platby a faktury s dobropisem, nad kterými se vypořádání počítá. */
export interface Ledger {
	payments: Payments;
	credited: ReadonlySet<string>;
}

export function ledgerOf(archive: readonly InvoiceSummary[], payments: Payments): Ledger {
	const credited = new Set(
		archive.filter((i) => i.documentType === DocumentKind.CreditNote).map((credit) => credit.originalInvoice),
	);
	return {
		payments,
		credited,
	};
}

function receivedCents(received: readonly ReceivedPayment[]): number {
	return received.reduce((sum, p) => sum + p.amountCents, 0);
}

export function lastPaymentOn(received: readonly ReceivedPayment[]): DateString | undefined {
	return received
		.map((p) => p.date)
		.toSorted((a, b) => a.localeCompare(b))
		.at(-1);
}

// Uhrazeno a zbývá nesou znaménko dokladu, takže u dobropisu vycházejí záporně a v součtu přes doklady
// dají tutéž částku jako obrat. Vypořádaný je doklad s nulovým zbytkem.
export function settlementOf(invoice: InvoiceSummary, ledger: Ledger): Settlement {
	const got = receivedCents(ledger.payments[invoice.number] ?? []);

	if (invoice.documentType === DocumentKind.CreditNote) {
		// Dobropis vrací celou fakturu (hlídá to formulář i import), takže vracet se má všechno,
		// co na ni odběratel zaplatil.
		const paidOnInvoice = receivedCents(ledger.payments[invoice.originalInvoice] ?? []);
		const due = Math.min(Math.abs(invoice.totalCents), paidOnInvoice);
		const refunded = Math.min(due, got);
		// `+ 0` dělá z `-0` nulu: nevrácený dobropis by jinak měl uhrazeno `0 * -1`, tedy v JS `-0`.
		return {
			paidCents: -refunded + 0,
			outstandingCents: -(due - refunded) + 0,
			overpaidCents: got - refunded,
			credited: false,
		};
	}

	const total = Math.max(0, invoice.totalCents);
	const paid = Math.min(total, got);
	const credited = ledger.credited.has(invoice.number);
	return {
		paidCents: paid,
		outstandingCents: credited ? 0 : total - paid,
		overpaidCents: got - paid,
		credited,
	};
}
