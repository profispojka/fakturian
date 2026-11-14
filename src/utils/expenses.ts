import type { Expense, ReceivedDocument } from '~/schemas/expenses';
import type { DateString } from '~/utils/date';

export function expenseFromReceived(doc: ReceivedDocument): Expense {
	return {
		id: crypto.randomUUID(),
		supplier: doc.supplier,
		supplierIco: doc.supplierIco || undefined,
		description: doc.description,
		amountCents: doc.amountCents,
		documentNumber: doc.number || undefined,
		documentUuid: doc.uuid || undefined,
		date: doc.date,
		documentFile: doc.file,
	};
}

// Týž doklad z jiného souboru: podle UUID z ISDOC, nebo podle dodavatele s číslem dokladu. Bajt po
// bajtu stejný soubor sem nedojde, ten odmítne už import.
export function sameReceivedDocument(expense: Expense, doc: ReceivedDocument): boolean {
	if (doc.uuid && expense.documentUuid?.toLowerCase() === doc.uuid.toLowerCase()) return true;
	if (!doc.supplierIco || !doc.number) return false;

	return expense.documentNumber === doc.number && expense.supplierIco === doc.supplierIco;
}

// Každý zapsaný výdaj jednou, v období svého data: appka nic nedopočítává, za takovým číslem by nestál
// žádný doklad.
export function expensesTotalCents(expenses: Expense[], inPeriod: (date: DateString) => boolean): number {
	return expenses.filter((e) => inPeriod(e.date)).reduce((sum, e) => sum + e.amountCents, 0);
}

// Sjednocení, ne objekt s nepovinnými poli: odmítnutí vždycky nese důvod.
export type RecipientCheck = { ok: true; warning?: string } | { ok: false; reason: string };

export function checkRecipient(ourIco: string, documentIco: string): RecipientCheck {
	if (!documentIco) {
		return {
			ok: true,
			warning: 'Doklad neuvádí IČO odběratele — ověř, že je opravdu vystavený na tebe.',
		};
	}
	if (!ourIco) {
		return {
			ok: true,
			warning: 'Nemáš vyplněné vlastní IČO, takže příjemce nejde ověřit.',
		};
	}
	if (ourIco !== documentIco) {
		return {
			ok: false,
			reason: `Doklad je vystavený na IČO ${documentIco}, ne na tvoje ${ourIco}.`,
		};
	}
	return { ok: true };
}
