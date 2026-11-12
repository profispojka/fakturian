import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { DOMImplementation, type Element } from '@xmldom/xmldom';

import { invoiceTotalCents, lineTotalCents } from '~/utils/invoice';

import { fmtnum, type Invoice, type InvoiceLine, type InvoiceParty } from './model.ts';
import { paymentSymbol } from './payment.ts';

import {
	extensionElement,
	fromCents,
	ISDOC_NAMESPACE,
	ISSUING_SYSTEM,
	parse,
	toXml,
	USAGE_YEAR,
	XMLNS_NAMESPACE,
} from '../isdoc/mod.ts';
import { intoInvoice } from '../isdoc/projection.ts';

const IMPLEMENTATION = new DOMImplementation();

// Tvar `UUIDType` v XSD: 8-4-4-4-12, ne `{…}` ani `urn:uuid:`.
const UUID_SHAPE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

// Appka umí jen neplátce DPH: doklad tvrdí `false` v hlavičce, na řádcích i v rekapitulaci.
const VAT_APPLICABLE = 'false';

const ZERO = fromCents(0);

// Jmenný prostor URL z RFC 9562; jiný by stejnému dokladu dal jiné UUID.
const NAMESPACE_URL = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex');

// UUID verze 5. Seed se nesmí změnit: týž doklad musí dostat totéž UUID i při dalším uložení.
function derivedUuid(invoice: Invoice): string {
	const seed = `${invoice.supplier.ico}|${invoice.documentType}|${invoice.number}`;
	const hex = createHash('sha1').update(NAMESPACE_URL).update(seed).digest('hex');
	// Horní dva bity sedmnácté číslice nesou variantu RFC 4122 (`10`).
	const variant = ((Number.parseInt(hex.charAt(16), 16) % 4) + 8).toString(16);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// Stabilní UUID dokladu: kdyby se měnilo s každým přegenerováním PDF, cizí účetní software by viděl
// každou editaci jako nový doklad.
export function invoiceUuid(invoice: Invoice): string {
	if (UUID_SHAPE.test(invoice.uuid)) return invoice.uuid;
	return derivedUuid(invoice);
}

// Prvky jdou v pořadí sekvence z XSD; doklad bez položek XSD neprojde.
export function buildIsdoc(invoice: Invoice): string {
	const uuid = invoiceUuid(invoice);
	const total = fromCents(invoiceTotalCents(invoice));
	const vatNote = invoice.vatNote.trim();
	const document = IMPLEMENTATION.createDocument(ISDOC_NAMESPACE, '', null);

	// Prázdná hodnota dá `<X></X>`, ne `<X/>`.
	function add(parent: Element, name: string, value?: string): Element {
		const element = document.createElementNS(ISDOC_NAMESPACE, name);
		if (value !== undefined) {
			element.appendChild(document.createTextNode(value));
		}
		parent.appendChild(element);
		return element;
	}

	function addParty(holder: Element, party: InvoiceParty): void {
		const element = add(holder, 'Party');
		add(add(element, 'PartyIdentification'), 'ID', party.ico);
		add(add(element, 'PartyName'), 'Name', party.name);
		const address = add(element, 'PostalAddress');
		add(address, 'StreetName', party.address.street);
		add(address, 'BuildingNumber', '');
		add(address, 'CityName', party.address.city);
		add(address, 'PostalZone', party.address.zip);
		const country = add(address, 'Country');
		add(country, 'IdentificationCode', 'CZ');
		add(country, 'Name', 'Česko');
		if (party.dic) {
			const scheme = add(element, 'PartyTaxScheme');
			add(scheme, 'CompanyID', party.dic);
			add(scheme, 'TaxScheme', 'VAT');
		}
		const registration = party.registration.trim();
		if (registration) add(add(element, 'RegisterIdentification'), 'Preformatted', registration);
		if (party.email) add(add(element, 'Contact'), 'ElectronicMail', party.email);
	}

	function addLine(lines: Element, id: number, line: InvoiceLine): void {
		const element = add(lines, 'InvoiceLine');
		const amount = fromCents(lineTotalCents(line));
		const price = fromCents(line.unitPriceCents);
		add(element, 'ID', String(id));
		add(element, 'InvoicedQuantity', fmtnum(line.quantity)).setAttribute('unitCode', line.unit);
		add(element, 'LineExtensionAmount', amount);
		add(element, 'LineExtensionAmountTaxInclusive', amount);
		add(element, 'LineExtensionTaxAmount', ZERO);
		add(element, 'UnitPrice', price);
		add(element, 'UnitPriceTaxInclusive', price);
		const category = add(element, 'ClassifiedTaxCategory');
		add(category, 'Percent', '0');
		add(category, 'VATCalculationMethod', '0');
		add(category, 'VATApplicable', VAT_APPLICABLE);
		// Na každý řádek, protože osvobozený je každý.
		if (vatNote) add(element, 'VATNote', vatNote);
		const item = add(element, 'Item');
		add(item, 'Description', line.description);
		// Ručně psaný řádek prvek nedostane: prázdné `<ID/>` by tvrdilo, že položka identitu má.
		const itemId = line.itemId.trim();
		if (itemId) add(add(item, 'SellersItemIdentification'), 'ID', itemId);
		if (line.usageYear) {
			add(element, 'Extensions').appendChild(extensionElement(document, USAGE_YEAR, String(line.usageYear)));
		}
	}

	const root = document.createElementNS(ISDOC_NAMESPACE, 'Invoice');
	document.appendChild(root);
	root.setAttributeNS(XMLNS_NAMESPACE, 'xmlns', ISDOC_NAMESPACE);
	root.setAttribute('version', '6.0.2');
	add(root, 'DocumentType', String(invoice.documentType));
	add(root, 'ID', invoice.number);
	add(root, 'UUID', uuid);
	add(root, 'IssuingSystem', ISSUING_SYSTEM);
	add(root, 'IssueDate', invoice.issueDate);
	add(root, 'VATApplicable', VAT_APPLICABLE);
	add(root, 'ElectronicPossibilityAgreementReference', '');
	if (invoice.note) add(root, 'Note', invoice.note);
	add(root, 'LocalCurrencyCode', 'CZK');
	add(root, 'CurrRate', '1');
	add(root, 'RefCurrRate', '1');
	addParty(add(root, 'AccountingSupplierParty'), invoice.supplier);
	addParty(add(root, 'AccountingCustomerParty'), invoice.customer);
	if (invoice.originalInvoice) {
		const reference = add(add(root, 'OriginalDocumentReferences'), 'OriginalDocumentReference');
		add(reference, 'ID', invoice.originalInvoice);
		const issued = invoice.originalIssueDate.trim();
		if (issued) add(reference, 'IssueDate', issued);
		// Jiný tvar `UUIDType` v XSD nepustí.
		if (UUID_SHAPE.test(invoice.originalUuid)) add(reference, 'UUID', invoice.originalUuid);
	}
	const lines = add(root, 'InvoiceLines');
	for (const [i, line] of invoice.lines.entries()) addLine(lines, i + 1, line);

	const tax = add(root, 'TaxTotal');
	const subtotal = add(tax, 'TaxSubTotal');
	add(subtotal, 'TaxableAmount', total);
	add(subtotal, 'TaxAmount', ZERO);
	add(subtotal, 'TaxInclusiveAmount', total);
	add(subtotal, 'AlreadyClaimedTaxableAmount', ZERO);
	add(subtotal, 'AlreadyClaimedTaxAmount', ZERO);
	add(subtotal, 'AlreadyClaimedTaxInclusiveAmount', ZERO);
	add(subtotal, 'DifferenceTaxableAmount', total);
	add(subtotal, 'DifferenceTaxAmount', ZERO);
	add(subtotal, 'DifferenceTaxInclusiveAmount', total);
	const category = add(subtotal, 'TaxCategory');
	add(category, 'Percent', '0');
	add(category, 'VATApplicable', VAT_APPLICABLE);
	add(tax, 'TaxAmount', ZERO);

	const monetary = add(root, 'LegalMonetaryTotal');
	add(monetary, 'TaxExclusiveAmount', total);
	add(monetary, 'TaxInclusiveAmount', total);
	add(monetary, 'AlreadyClaimedTaxExclusiveAmount', ZERO);
	add(monetary, 'AlreadyClaimedTaxInclusiveAmount', ZERO);
	add(monetary, 'DifferenceTaxExclusiveAmount', total);
	add(monetary, 'DifferenceTaxInclusiveAmount', total);
	add(monetary, 'PaidDepositsAmount', ZERO);
	add(monetary, 'PayableAmount', total);

	const payment = add(add(root, 'PaymentMeans'), 'Payment');
	add(payment, 'PaidAmount', total);
	add(payment, 'PaymentMeansCode', '42');
	const details = add(payment, 'Details');
	add(details, 'PaymentDueDate', invoice.dueDate);
	add(details, 'ID', invoice.bankAccount);
	add(details, 'BankCode', invoice.bankCode);
	add(details, 'Name', '');
	add(details, 'IBAN', invoice.iban);
	add(details, 'BIC', '');
	add(details, 'VariableSymbol', paymentSymbol(invoice));
	return toXml(document);
}

export async function parseIsdoc(xml: string): Promise<Invoice> {
	const document = await parse(xml);
	return intoInvoice(document);
}
