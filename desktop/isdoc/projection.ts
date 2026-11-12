import { DocumentKind, type DocumentType } from '~/constants/invoice';
import { errorText } from '~/utils/errors';
import { lineCents } from '~/utils/money';

import { amountCents, child, children, decimal, ISSUING_SYSTEM, lineUsageYear, text, toCents } from './mod.ts';

import type { Invoice, InvoiceLine, InvoiceParty } from '../invoice/model.ts';
import type { Document, Element } from '@xmldom/xmldom';

type LinePrice = Pick<InvoiceLine, 'description' | 'quantity' | 'unit' | 'unitPriceCents'>;

// XSD pustí jen typy 1 až 7.
const UNSUPPORTED_KINDS: Record<number, string> = {
	3: 'vrubopis',
	4: 'zálohová faktura (nedaňový zálohový list)',
	5: 'daňový doklad při přijetí platby',
	6: 'opravný daňový doklad při přijetí platby',
	7: 'zjednodušený daňový doklad',
};

// Typ je v XSD `xs:integer`, takže projde i zápis `01` nebo ` +1 `; rozhoduje hodnota.
function documentKind(type: number): DocumentType {
	if (type === DocumentKind.Invoice) return DocumentKind.Invoice;
	if (type === DocumentKind.CreditNote) return DocumentKind.CreditNote;
	throw new Error(`doklad typu ${type} (${UNSUPPORTED_KINDS[type]}) appka neumí — do vydaných faktur nepatří`);
}

function party(element: Element | undefined): InvoiceParty {
	const address = child(element, 'PostalAddress');
	const register = child(element, 'RegisterIdentification');
	const record = [text(register, 'RegisterKeptAt').trim(), text(register, 'RegisterFileRef').trim()];
	return {
		name: text(child(element, 'PartyName'), 'Name').trim(),
		ico: text(child(element, 'PartyIdentification'), 'ID').trim(),
		dic: text(child(element, 'PartyTaxScheme'), 'CompanyID').trim(),
		address: {
			street: [text(address, 'StreetName').trim(), text(address, 'BuildingNumber').trim()]
				.filter((part) => part !== '')
				.join(' '),
			city: text(address, 'CityName').trim(),
			zip: text(address, 'PostalZone').trim(),
		},
		email: text(child(element, 'Contact'), 'ElectronicMail').trim(),
		registration: child(register, 'Preformatted')
			? text(register, 'Preformatted').trim()
			: record.filter((part) => part !== '').join(', '),
	};
}

// Plateb může být víc; spojení se bere z převodu (`PaymentMeansCode` 42), jinak z první platby, která
// ho má. Opsat účet z platby kartou by znamenalo vygenerovat QR na cizí účet.
function bankDetails(root: Element | null): Element | undefined {
	const payments = children(child(root, 'PaymentMeans'), 'Payment');
	// Spojení nese jen varianta `Details` se splatností; druhá odkazuje na jiný doklad.
	const hasBank = (payment: Element) => child(child(payment, 'Details'), 'PaymentDueDate') !== undefined;
	const transfer = payments.find((payment) => Number(text(payment, 'PaymentMeansCode')) === 42 && hasBank(payment));
	return child(transfer ?? payments.find(hasBank), 'Details');
}

// Cenu za jednotku nese doklad sám a musí dávat částku řádku. Cena s přesností pod haléř (1000 ks
// za 0,21837 Kč) v celých haléřích nevyjde: řádek pak nese celou částku a zbytek zůstane v popisu.
function linePrice(line: Element, id: string, amount: number, description: string): LinePrice {
	const invoiced = child(line, 'InvoicedQuantity');
	if (!invoiced) {
		return {
			description,
			quantity: 1,
			unit: '',
			unitPriceCents: amount,
		};
	}
	const unit = invoiced.getAttribute('unitCode') ?? '';
	const quantityText = text(line, 'InvoicedQuantity').trim();
	const priceText = text(line, 'UnitPrice').trim();
	const exact = decimal(quantityText);
	const price = decimal(priceText);
	const quantity = exact.toNumber();
	if (!Number.isFinite(quantity)) throw new Error(`řádek ${id}: množství „${quantityText}“ je mimo rozsah`);
	const unitPriceCents = amountCents(price);
	if (unitPriceCents === undefined) {
		throw new Error(`řádek ${id}: jednotková cena „${priceText}“ přesahuje strop 90 miliard Kč`);
	}
	if (lineCents(quantity, unitPriceCents) === amount) {
		return {
			description,
			quantity,
			unit,
			unitPriceCents,
		};
	}
	if (amountCents(exact.times(price)) === amount) {
		return {
			description: `${description} (${quantityText} ${unit} × ${priceText.replaceAll('.', ',')} Kč)`.trim(),
			quantity: 1,
			unit: '',
			unitPriceCents: amount,
		};
	}
	throw new Error(
		`řádek ${id}: ${quantityText} × ${priceText} Kč nedává částku řádku ${text(line, 'LineExtensionAmount').trim()} Kč`,
	);
}

// Autoritativní je `LineExtensionAmount`: schéma ho má povinný, kdežto `InvoicedQuantity` je nepovinné,
// takže by řádek bez množství skončil jako nula.
function lineToItem(line: Element, own: boolean): InvoiceLine {
	const id = text(line, 'ID');
	let amount: number;
	try {
		amount = toCents(text(line, 'LineExtensionAmount'));
	} catch (error) {
		throw new Error(`řádek ${id}: částka v <LineExtensionAmount>: ${errorText(error)}`, { cause: error });
	}
	const item = child(line, 'Item');
	const price = linePrice(line, id, amount, text(item, 'Description').trim());
	if (!own) {
		return {
			...price,
			itemId: '',
		};
	}
	const usageYear = lineUsageYear(line);
	return {
		...price,
		itemId: text(child(item, 'SellersItemIdentification'), 'ID').trim(),
		...(usageYear !== undefined && { usageYear }),
	};
}

function roundingCents(value: string): number {
	try {
		return toCents(value);
	} catch (error) {
		throw new Error(`zaokrouhlení v <PayableRoundingAmount>: ${errorText(error)}`, { cause: error });
	}
}

// Jediné místo, kde se rozhoduje, jaké doklady appka vede: import, převzetí složky i výpis archivu čtou
// doklad přes tuhle projekci.
export function intoInvoice(document: Document): Invoice {
	const root = document.documentElement;
	// `SellersItemIdentification` a řádkové `Extensions` se čtou jen z vlastního dokladu: na cizí
	// faktuře je to číslo z katalogu někoho jiného a v našem ceníku by neznamenalo nic.
	const own = text(root, 'IssuingSystem') === ISSUING_SYSTEM;
	// Cizoměnový doklad se odmítne, ne převezme jako korunový: 1 000 EUR zapsaných jako 1 000 Kč by
	// podhodnotilo obrat, a tedy hlídání limitu plátcovství.
	const currency = text(root, 'LocalCurrencyCode').trim();
	// Stryker disable next-line Regex: ekvivalentní mutant, XSD pustí jen kód měny o třech znacích, takže kotvy nic nezmění.
	if (currency !== '' && !/^czk$/i.test(currency)) {
		throw new Error(`doklad je v měně ${currency}; appka vede jen koruny`);
	}
	const lineElements = children(child(root, 'InvoiceLines'), 'InvoiceLine');
	const lines = lineElements.map((line) => lineToItem(line, own));
	// Řádek je poctivější než skryté pole: uživatel zaokrouhlení vidí a součet položek se nerozejde
	// s částkou k úhradě.
	const totals = child(root, 'LegalMonetaryTotal');
	if (child(totals, 'PayableRoundingAmount')) {
		const rounding = roundingCents(text(totals, 'PayableRoundingAmount'));
		if (rounding !== 0) {
			lines.push({
				description: 'Zaokrouhlení',
				quantity: 1,
				unit: '',
				unitPriceCents: rounding,
				itemId: '',
			});
		}
	}
	const payment = bankDetails(root);
	const original = child(child(root, 'OriginalDocumentReferences'), 'OriginalDocumentReference');
	return {
		number: text(root, 'ID').trim(),
		uuid: text(root, 'UUID'),
		documentType: documentKind(Number(text(root, 'DocumentType'))),
		originalInvoice: text(original, 'ID').trim(),
		// Data a UUID nesou v XSD vzor, takže mezery kolem neprojdou.
		originalIssueDate: text(original, 'IssueDate'),
		originalUuid: text(original, 'UUID'),
		issueDate: text(root, 'IssueDate'),
		dueDate: text(payment, 'PaymentDueDate'),
		supplier: party(child(child(root, 'AccountingSupplierParty'), 'Party')),
		customer: party(child(child(root, 'AccountingCustomerParty'), 'Party')),
		vatNote: text(
			lineElements.find((line) => child(line, 'VATNote')),
			'VATNote',
		).trim(),
		bankAccount: text(payment, 'ID').trim(),
		bankCode: text(payment, 'BankCode').trim(),
		iban: text(payment, 'IBAN').trim(),
		variableSymbol: text(payment, 'VariableSymbol').trim(),
		note: text(root, 'Note').trim(),
		lines,
	};
}
