import { DocumentKind } from '~/constants/invoice';
import { ledgerOf, settlementOf } from '~/utils/payments';

import type { FioPayment } from '~/schemas/fio';
import type { InvoiceSummary } from '~/schemas/invoices';
import type { Payments, ReceivedPayment } from '~/schemas/payments';

export interface PaymentMatch {
	number: string;
	payment: ReceivedPayment;
}

export interface MatchResult {
	matched: PaymentMatch[];
	unmatched: FioPayment[];
}

// Synchronizace stahuje pořád totéž okno výpisu, proto se známý pohyb přeskočí a pohyb bez ID z Fia
// nezapíše — příští synchronizace by ho zapsala znovu.
export function matchPayments(movements: FioPayment[], invoices: InvoiceSummary[], payments: Payments): MatchResult {
	const matched: PaymentMatch[] = [];
	const unmatched: FioPayment[] = [];
	const recorded = new Set(Object.values(payments).flatMap((list) => list.map((p) => p.fioId)));
	// Platby i s těmi, které tahle dávka právě přiřadila: uhrazenou fakturu nedoplní druhý pohyb.
	const withBatch: Payments = { ...payments };
	const ledger = ledgerOf(invoices, withBatch);

	for (const movement of movements) {
		if (recorded.has(movement.id)) continue;
		const invoice = invoiceFor(movement, invoices);
		if (!invoice || !movement.id) {
			unmatched.push(movement);
			continue;
		}
		if (settlementOf(invoice, ledger).outstandingCents === 0) {
			unmatched.push(movement);
			continue;
		}

		const payment = {
			id: crypto.randomUUID(),
			date: movement.date,
			amountCents: movement.amountCents,
			fioId: movement.id,
		};
		withBatch[invoice.number] = [...(withBatch[invoice.number] ?? []), payment];
		recorded.add(movement.id);
		matched.push({
			number: invoice.number,
			payment,
		});
	}

	return {
		matched,
		unmatched,
	};
}

// Částka rozhoduje jen mezi doklady se stejným symbolem. Dobropis se nepáruje: Fio vydává příchozí
// platby, kdežto k dobropisu peníze odcházejí.
function invoiceFor(movement: FioPayment, invoices: InvoiceSummary[]): InvoiceSummary | undefined {
	const symbol = symbolValue(movement.vs);
	if (!symbol) return undefined;
	const sameSymbol = invoices.filter(
		(i) => i.documentType !== DocumentKind.CreditNote && symbolValue(i.variableSymbol) === symbol,
	);
	if (sameSymbol.length === 1) return sameSymbol[0];
	const sameAmount = sameSymbol.filter((i) => i.totalCents === movement.amountCents);
	if (sameAmount.length === 1) return sameAmount[0];
	return undefined;
}

// Banky vedou variabilní symbol jako číslo: `00012026` z šablony řady přijde z výpisu jako `12026`.
function symbolValue(symbol: string): string {
	return symbol.trim().replace(/^0+/, '');
}
