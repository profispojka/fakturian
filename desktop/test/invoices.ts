import { DocumentKind } from '~/constants/invoice';

import type { Invoice, InvoiceParty } from '../invoice/model.ts';

export function supplier(): InvoiceParty {
	return {
		name: 'Jan Dodavatel',
		ico: '12345679',
		dic: '',
		address: {
			street: 'Dodavatelská 1',
			city: 'Praha',
			zip: '11000',
		},
		email: 'jan@example.cz',
		registration: 'Fyzická osoba zapsaná v živnostenském rejstříku, Živnostenský úřad Praha 1',
	};
}

export function customer(): InvoiceParty {
	return {
		name: 'Odběratel s.r.o.',
		ico: '87654326',
		dic: 'CZ87654326',
		address: {
			street: 'Odběratelská 2',
			city: 'Brno',
			zip: '60200',
		},
		email: 'fakturace@odberatel.cz',
		registration: '',
	};
}

// 40 h × 1 200 Kč + 2,5 h × 1 500 Kč = 51 750,00 Kč.
export function invoice(): Invoice {
	return {
		number: '20260001',
		uuid: '',
		documentType: DocumentKind.Invoice,
		originalInvoice: '',
		originalIssueDate: '',
		originalUuid: '',
		issueDate: '2026-05-29',
		dueDate: '2026-06-12',
		supplier: supplier(),
		customer: customer(),
		vatNote: '',
		bankAccount: '2000145399',
		bankCode: '0800',
		iban: 'CZ6508000000192000145399',
		variableSymbol: '20260001',
		note: 'Děkujeme za spolupráci.',
		lines: [
			{
				description: 'Programátorské práce',
				quantity: 40,
				unit: 'hod',
				unitPriceCents: 120_000,
				itemId: '',
			},
			{
				description: 'Konzultace',
				quantity: 2.5,
				unit: 'hod',
				unitPriceCents: 150_000,
				itemId: '',
			},
		],
	};
}

// −6 000,00 Kč k faktuře 20260001.
export function creditNote(): Invoice {
	return {
		...invoice(),
		number: '20260002',
		documentType: DocumentKind.CreditNote,
		originalInvoice: '20260001',
		variableSymbol: '20260002',
		note: 'Oprava chybně vyúčtovaných hodin.',
		lines: [
			{
				description: 'Programátorské práce — oprava',
				quantity: 5,
				unit: 'hod',
				unitPriceCents: -120_000,
				itemId: '',
			},
		],
	};
}

export function backup(): Invoice {
	return {
		...invoice(),
		number: '20260003',
		variableSymbol: '20260003',
		note: 'Záloha 30 % z dohodnuté ceny 100 000 Kč.',
		lines: [
			{
				description: 'Záloha na tvorbu webu',
				quantity: 1,
				unit: 'ks',
				unitPriceCents: 3_000_000,
				itemId: '',
			},
		],
	};
}

// Odběratel bez DIČ a doklad bez bankovních údajů.
export function minimal(): Invoice {
	return {
		...invoice(),
		number: '20260005',
		variableSymbol: '20260005',
		customer: {
			name: 'Petra Nováková',
			ico: '71048294',
			dic: '',
			address: {
				street: 'Horní náměstí 1',
				city: 'Olomouc',
				zip: '77900',
			},
			email: 'petra@novakova.cz',
			registration: '',
		},
		bankAccount: '',
		bankCode: '',
		iban: '',
		note: '',
	};
}

export function samples(): Invoice[] {
	return [invoice(), creditNote(), backup(), minimal()];
}

// Doklad s jediným řádkem 2 ks za danou cenu, jak ho skládají testy přehledu a kolizí.
export function numbered(number: string, customerName: string, unitPriceCents: number): Invoice {
	return {
		...invoice(),
		number,
		supplier: {
			...supplier(),
			name: 'Dodavatel',
		},
		customer: {
			...customer(),
			name: customerName,
		},
		bankAccount: '123',
		iban: '',
		variableSymbol: '',
		note: '',
		lines: [
			{
				description: 'Práce',
				quantity: 2,
				unit: 'ks',
				unitPriceCents,
				itemId: '',
			},
		],
	};
}

function party(name: string, ico: string): InvoiceParty {
	return {
		name,
		ico,
		dic: `CZ${ico}`,
		address: {
			street: 'Ulice 1',
			city: 'Praha',
			zip: '11000',
		},
		email: 'test@example.cz',
		registration: `Zapsáno v evidenci pod IČO ${ico}`,
	};
}

// 3 h × 1 200 Kč + 3 ks × 19,99 Kč = 3 659,97 Kč, bez IBAN.
export function sampleInvoice(): Invoice {
	return {
		number: '20260007',
		uuid: '',
		documentType: DocumentKind.Invoice,
		originalInvoice: '',
		originalIssueDate: '',
		originalUuid: '',
		issueDate: '2026-05-28',
		dueDate: '2026-06-11',
		supplier: party('Jan Dodavatel', '12345679'),
		customer: party('Odběratel s.r.o.', '87654326'),
		vatNote: '',
		bankAccount: '2000145399',
		bankCode: '0800',
		iban: '',
		variableSymbol: '20260007',
		note: 'Děkuji za spolupráci.',
		lines: [
			{
				description: 'Konzultace',
				quantity: 3,
				unit: 'hod',
				unitPriceCents: 120_000,
				itemId: '',
			},
			{
				description: 'Drobnost',
				quantity: 3,
				unit: 'ks',
				unitPriceCents: 1_999,
				itemId: '',
			},
		],
	};
}

export const MINIMAL_ISDOC = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.2">
  <DocumentType>1</DocumentType>
  <ID>20260001</ID>
  <UUID>00000000-0000-0000-0000-000000000001</UUID>
  <IssueDate>2026-05-28</IssueDate>
  <VATApplicable>false</VATApplicable>
  <ElectronicPossibilityAgreementReference></ElectronicPossibilityAgreementReference>
  <LocalCurrencyCode>CZK</LocalCurrencyCode>
  <CurrRate>1</CurrRate>
  <RefCurrRate>1</RefCurrRate>
  <AccountingSupplierParty>
    <Party>
      <PartyIdentification><ID>12345679</ID></PartyIdentification>
      <PartyName><Name>Jan Dodavatel</Name></PartyName>
      <PostalAddress>
        <StreetName>Dodavatelská</StreetName>
        <BuildingNumber>1</BuildingNumber>
        <CityName>Praha</CityName>
        <PostalZone>11000</PostalZone>
        <Country><IdentificationCode>CZ</IdentificationCode><Name>Česká republika</Name></Country>
      </PostalAddress>
      <Contact><ElectronicMail>jan@example.cz</ElectronicMail></Contact>
    </Party>
  </AccountingSupplierParty>
  <AccountingCustomerParty>
    <Party>
      <PartyIdentification><ID>87654326</ID></PartyIdentification>
      <PartyName><Name>Odběratel s.r.o.</Name></PartyName>
      <PostalAddress>
        <StreetName>Odběratelská</StreetName>
        <BuildingNumber>2</BuildingNumber>
        <CityName>Brno</CityName>
        <PostalZone>60200</PostalZone>
        <Country><IdentificationCode>CZ</IdentificationCode><Name>Česká republika</Name></Country>
      </PostalAddress>
    </Party>
  </AccountingCustomerParty>
  <InvoiceLines>
    <InvoiceLine>
      <ID>1</ID>
      <InvoicedQuantity unitCode="ks">1</InvoicedQuantity>
      <LineExtensionAmount>1000.00</LineExtensionAmount>
      <LineExtensionAmountTaxInclusive>1000.00</LineExtensionAmountTaxInclusive>
      <LineExtensionTaxAmount>0.00</LineExtensionTaxAmount>
      <UnitPrice>1000.00</UnitPrice>
      <UnitPriceTaxInclusive>1000.00</UnitPriceTaxInclusive>
      <ClassifiedTaxCategory><Percent>0</Percent><VATCalculationMethod>0</VATCalculationMethod><VATApplicable>false</VATApplicable></ClassifiedTaxCategory>
      <Item><Description>Konzultace</Description></Item>
    </InvoiceLine>
  </InvoiceLines>
  <TaxTotal>
    <TaxSubTotal>
      <TaxableAmount>1000.00</TaxableAmount>
      <TaxAmount>0.00</TaxAmount>
      <TaxInclusiveAmount>1000.00</TaxInclusiveAmount>
      <AlreadyClaimedTaxableAmount>0.00</AlreadyClaimedTaxableAmount>
      <AlreadyClaimedTaxAmount>0.00</AlreadyClaimedTaxAmount>
      <AlreadyClaimedTaxInclusiveAmount>0.00</AlreadyClaimedTaxInclusiveAmount>
      <DifferenceTaxableAmount>1000.00</DifferenceTaxableAmount>
      <DifferenceTaxAmount>0.00</DifferenceTaxAmount>
      <DifferenceTaxInclusiveAmount>1000.00</DifferenceTaxInclusiveAmount>
      <TaxCategory><Percent>0</Percent><VATApplicable>false</VATApplicable></TaxCategory>
    </TaxSubTotal>
    <TaxAmount>0.00</TaxAmount>
  </TaxTotal>
  <LegalMonetaryTotal>
    <TaxExclusiveAmount>1000.00</TaxExclusiveAmount>
    <TaxInclusiveAmount>1000.00</TaxInclusiveAmount>
    <AlreadyClaimedTaxExclusiveAmount>0.00</AlreadyClaimedTaxExclusiveAmount>
    <AlreadyClaimedTaxInclusiveAmount>0.00</AlreadyClaimedTaxInclusiveAmount>
    <DifferenceTaxExclusiveAmount>1000.00</DifferenceTaxExclusiveAmount>
    <DifferenceTaxInclusiveAmount>1000.00</DifferenceTaxInclusiveAmount>
    <PaidDepositsAmount>0.00</PaidDepositsAmount>
    <PayableAmount>1000.00</PayableAmount>
  </LegalMonetaryTotal>
  <PaymentMeans>
    <Payment>
      <PaidAmount>1000.00</PaidAmount>
      <PaymentMeansCode>42</PaymentMeansCode>
      <Details>
        <PaymentDueDate>2026-06-11</PaymentDueDate>
        <ID>2000145399</ID>
        <BankCode>0800</BankCode>
        <Name>Česká spořitelna</Name>
        <IBAN>CZ6508000000192000145399</IBAN>
        <BIC></BIC>
        <VariableSymbol>20260001</VariableSymbol>
      </Details>
    </Payment>
  </PaymentMeans>
</Invoice>`;
