import { DocumentKind } from '~/constants/invoice';
import { parseIsdocDate } from '~/utils/date';
import { errorText } from '~/utils/errors';
import { invoiceTotalCents } from '~/utils/invoice';
import { validateNumber } from '~/utils/numbering';

import { child, fromCents, sentAt, text, toCents } from './isdoc/mod.ts';
import { intoInvoice } from './isdoc/projection.ts';
import { loadPdf, readIsdoc } from './pdf.ts';
import { readDocument } from './util.ts';

import type { Invoice } from './invoice/model.ts';
import type { PDFDocument } from 'pdf-lib';

const PDF_SIGNATURE = Buffer.from('%PDF');

export interface Source {
	invoice: Invoice;
	// U přijatého dokladu jsou řádky plátce DPH bez daně; k úhradě je až tahle částka.
	payableCents: number;
	// `ForeignCurrencyCode` jiný než CZK.
	foreignCurrency: string | undefined;
	// `VATApplicable` v hlavičce: doklad vystavil plátce DPH.
	vatPayer: boolean;
	sentAt: string | undefined;
}

// Údaje, které Fakturian do dokladu zapisuje sám (odeslání), se ověří už tady: vadný doklad by jinak
// prošel importem a rozbil se až v přehledu.
export async function sourceFromPdf(pdf: PDFDocument): Promise<Source> {
	const { document } = await readIsdoc(pdf);
	const invoice = intoInvoice(document);
	const root = document.documentElement;
	let payableCents: number;
	try {
		payableCents = toCents(text(child(root, 'LegalMonetaryTotal'), 'PayableAmount'));
	} catch (error) {
		throw new Error(`částka k úhradě v <PayableAmount>: ${errorText(error)}`, { cause: error });
	}
	const currency = text(root, 'ForeignCurrencyCode').trim();
	return {
		invoice,
		payableCents,
		// Stryker disable next-line Regex: ekvivalentní mutant, XSD pustí jen kód měny o třech znacích, takže kotvy nic nezmění.
		foreignCurrency: currency === '' || /^czk$/i.test(currency) ? undefined : currency,
		vatPayer: text(root, 'VATApplicable').trim() === 'true',
		sentAt: sentAt(document),
	};
}

// Doklad je PDF s vloženým ISDOC a nic jiného: holé XML by appka musela sázet sama a klient by pak měl
// jiný doklad, než jaký leží ve `faktury/`. Formát určuje parser PDF, ne přípona.
export async function readSource(path: string): Promise<Source> {
	let content: Uint8Array;
	try {
		content = await readDocument(path);
	} catch (error) {
		throw new Error(`nejde přečíst: ${errorText(error)}`, { cause: error });
	}
	let pdf: PDFDocument;
	try {
		pdf = await loadPdf(content);
	} catch (error) {
		if (PDF_SIGNATURE.equals(content.subarray(0, PDF_SIGNATURE.length))) {
			throw new Error(`PDF je poškozené: ${errorText(error)}`, { cause: error });
		}
		throw new Error('soubor není PDF s vloženým ISDOC', { cause: error });
	}
	return sourceFromPdf(pdf);
}

export function isCreditNote(source: Source): boolean {
	return source.invoice.documentType === DocumentKind.CreditNote;
}

export function alreadyThere(number: string): string {
	return `faktura ${number} už ve vaultu existuje`;
}

export function normIco(ico: string): string {
	return ico.replace(/\D/g, '').replace(/^0+/, '');
}

// Smí se doklad zařadit mezi vydané faktury? Rozhoduje se jen tady, aby přehled ukázal právě to, co by
// vzal import. `ourIco` je IČO jen z číslic bez úvodních nul; prázdné dodavatele nekontroluje.
export function checkSource(source: Source, ourIco: string): void {
	const { invoice } = source;
	const numberProblem = validateNumber(invoice.number);
	if (numberProblem) throw new Error(numberProblem);
	// Frontend čte data schématem, které neplatné datum odmítne: doklad by ležel ve `faktury/`, ale
	// přehled by ho neukázal a opakovaný import by hlásil, že už existuje.
	for (const [label, date, required] of [
		['vystavení', invoice.issueDate, true],
		['splatnosti', invoice.dueDate, false],
		['původního dokladu', invoice.originalIssueDate, false],
	] as const) {
		if ((!required && !date.trim()) || parseIsdocDate(date)) continue;
		throw new Error(`doklad má neplatné datum ${label} „${date}“ (čekám RRRR-MM-DD)`);
	}

	if (ourIco !== '' && normIco(invoice.supplier.ico) !== ourIco) {
		const who = invoice.supplier.name.trim() || 'neznámý dodavatel';
		const ico = invoice.supplier.ico.trim();
		if (ico === '') {
			throw new Error(
				`doklad neuvádí IČO dodavatele (${who}), takže nejde poznat, že je tvůj — přijaté doklady patří do Výdajů`,
			);
		}
		throw new Error(`doklad vystavil ${who} (IČO ${ico}), ne ty — přijaté doklady patří do Výdajů`);
	}

	// Doklad plátce by se při přeuložení přepsal na nulovou daň a přibyla by mu věta „Nejsem plátce DPH“.
	if (source.vatPayer) throw new Error('doklad je od plátce DPH; Fakturian umí jen neplátce');

	// Korunové částky cizoměnového dokladu jsou jen přepočet: QR v korunách i párování plateb by lhaly.
	if (source.foreignCurrency !== undefined) {
		throw new Error(`doklad je vystavený v cizí měně ${source.foreignCurrency}; Fakturian vede jen koruny`);
	}

	// Vydaná faktura bez odběratele se nedá poslat ani upomenout.
	if (!invoice.customer.name.trim()) {
		throw new Error('doklad neuvádí odběratele — anonymní doklad do vydaných faktur nepatří');
	}

	const ours = invoiceTotalCents(invoice);
	if (invoice.documentType === DocumentKind.Invoice && ours < 0) {
		throw new Error(`faktura má záporný součet ${fromCents(ours)} Kč — vratka patří na dobropis`);
	}
	if (invoice.documentType === DocumentKind.CreditNote && ours > 0) {
		throw new Error(`dobropis má kladný součet ${fromCents(ours)} Kč`);
	}
	if (invoice.documentType === DocumentKind.CreditNote && !invoice.originalInvoice.trim()) {
		throw new Error('dobropis neuvádí fakturu, kterou opravuje');
	}

	// Řádky musí dát částku k úhradě, jinak doklad veze zálohy nebo odpočty a platba se nespáruje. Až
	// poslední: u plátce DPH je rozdíl jen důsledek řádků bez daně a hláška o plátcovství řekne víc.
	if (source.payableCents !== ours) {
		throw new Error(
			`doklad hlásí k úhradě ${fromCents(source.payableCents)} Kč, ale ze řádků vychází ${fromCents(ours)} — ` +
				'nejspíš obsahuje zálohy nebo odpočty, které appka neumí',
		);
	}
}
