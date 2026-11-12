import { describe, expect, it } from 'vitest';

import { DocumentKind } from '~/constants/invoice';
import { invoiceTotalCents } from '~/utils/invoice';

import { buildIsdoc } from '../../invoice/isdoc.ts';
import { child, parse, text, toCents } from '../../isdoc/mod.ts';
import { intoInvoice } from '../../isdoc/projection.ts';
import { MINIMAL_ISDOC, sampleInvoice } from '../invoices.ts';
import { fixture } from '../isdoc.ts';
import { thrownBy } from '../support.ts';

import type { Invoice } from '../../invoice/model.ts';

const PAYMENT_DETAILS = `      <Details>
        <PaymentDueDate>2026-06-11</PaymentDueDate>
        <ID>2000145399</ID>
        <BankCode>0800</BankCode>
        <Name>Česká spořitelna</Name>
        <IBAN>CZ6508000000192000145399</IBAN>
        <BIC></BIC>
        <VariableSymbol>20260001</VariableSymbol>
      </Details>
`;

const CUSTOMER = `  <AccountingCustomerParty>
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
`;

async function project(xml: string): Promise<Invoice> {
	const document = await parse(xml);
	return intoInvoice(document);
}

async function projectionError(xml: string): Promise<unknown> {
	const document = await parse(xml);
	return thrownBy(() => intoInvoice(document));
}

async function sample(name: string): Promise<Invoice> {
	const xml = await fixture(name);
	return project(xml);
}

function minimalWith(quantity: string, price: string, amount = '1000.00'): string {
	return MINIMAL_ISDOC.replace(
		'<InvoicedQuantity unitCode="ks">1</InvoicedQuantity>',
		`<InvoicedQuantity unitCode="ks">${quantity}</InvoicedQuantity>`,
	)
		.replace('<UnitPrice>1000.00</UnitPrice>', `<UnitPrice>${price}</UnitPrice>`)
		.replace(
			'<LineExtensionAmount>1000.00</LineExtensionAmount>',
			`<LineExtensionAmount>${amount}</LineExtensionAmount>`,
		);
}

describe('měna dokladu', () => {
	it('doklad v cizí měně odmítne a řekne v které', async () => {
		const source = await fixture('example1.isdoc');
		const xml = source.replace(
			'<LocalCurrencyCode>CZK</LocalCurrencyCode>',
			'<LocalCurrencyCode>EUR</LocalCurrencyCode>',
		);

		expect(await projectionError(xml)).toEqual(new Error('doklad je v měně EUR; appka vede jen koruny'));
	});

	it('kód bez ohledu na velikost písmen i kód z mezer čte jako koruny', async () => {
		const xml = await fixture('example1.isdoc');
		const crowns = await project(xml);

		for (const code of ['czk', '   ']) {
			const other = xml.replace(
				'<LocalCurrencyCode>CZK</LocalCurrencyCode>',
				`<LocalCurrencyCode>${code}</LocalCurrencyCode>`,
			);

			expect(await project(other)).toEqual(crowns);
		}
	});
});

// Hodnota s mezerami okolo; prvky se vzorem nebo délkou z XSD by ji neprošly a vlastní doklad
// pozná appka jen podle přesného `IssuingSystem`.
function padded(xml: string): string {
	const strict = new Set([
		'IssuingSystem',
		'UUID',
		'LocalCurrencyCode',
		'ForeignCurrencyCode',
		'IdentificationCode',
		'DocumentType',
		'IssueDate',
		'TaxPointDate',
		'PaymentDueDate',
		'RegisterDate',
		'ExpirationDate',
		'BatchOrSerialNumber',
	]);
	return xml.replace(/<(\w+)([^<>]*)>([^<>\s][^<>]*)<\//g, (whole, tag: string, attributes: string, value: string) =>
		strict.has(tag) ? whole : `<${tag}${attributes}>  ${value}  </`,
	);
}

describe('mezery kolem hodnot', () => {
	it('každou hodnotu z dokladu přečte bez mezer okolo', async () => {
		const own = sampleInvoice();
		own.lines[0]!.itemId = 'p1';
		own.vatNote = 'Osvobozeno od DPH';
		for (const xml of [buildIsdoc(own), await fixture('example1.isdoc')]) {
			const expected = await project(xml);

			expect(await project(padded(xml))).toEqual(expected);
		}
	});

	it('řádek bez roku čerpání klíč roku nemá', async () => {
		const invoice = await project(buildIsdoc(sampleInvoice()));

		expect(invoice.lines.map((line) => Object.hasOwn(line, 'usageYear'))).toEqual(invoice.lines.map(() => false));
	});
});

describe('oficiální vzorky ISDOC', () => {
	it('přečte jejich hlavičku, odkaz na původní doklad a řádky se zaokrouhlením', async () => {
		for (const name of ['example1.isdoc', 'example2.isdoc']) {
			const invoice = await sample(name);

			expect([name, invoice.number, invoice.uuid, invoice.issueDate]).toEqual([
				name,
				'FV-111999/2011',
				'7B4C5BE0-288C-11D2-8E62-004095452B84',
				'2013-02-28',
			]);
			expect([invoice.originalInvoice, invoice.originalIssueDate, invoice.originalUuid]).toEqual([
				'FV-111999/2011',
				'2013-02-28',
				'7B4C5BE0-288C-11D2-8E62-004095452B84',
			]);
			expect(invoice.lines.length).toBe(4);
			expect([invoice.lines[3]?.description, invoice.lines[3]?.unitPriceCents]).toEqual(['Zaokrouhlení', -251]);
			expect(invoice.lines.filter((line) => line.description.trim() === '')).toEqual([]);
		}
	});

	it('dodavatele vezme ze správného uzlu i se zápisem v rejstříku', async () => {
		const invoice = await sample('example1.isdoc');

		expect(invoice.supplier).toEqual({
			name: 'ABRA Software a.s.',
			ico: '25097563',
			dic: 'CZ25097563',
			address: {
				street: 'Jeremiášova 1422',
				city: 'Praha 13',
				zip: '15300',
			},
			email: 'novak@abra.eu',
			registration: 'Městského soudu v Praze, odd. B, vl. 4475',
		});
	});
});

describe('cizí doklad', () => {
	it('ulici složí s číslem domu', async () => {
		const invoice = await sample('foreign-document.isdoc');

		expect(invoice.supplier.address.street).toBe('Nádražní 1422');
	});

	it('přečte přesně částku, množství i jednotku', async () => {
		const invoice = await sample('foreign-document.isdoc');

		expect(invoiceTotalCents(invoice)).toBe(187_500);
		expect(invoice.lines.map(({ quantity, unit }) => [quantity, unit])).toEqual([[1.5, 'hod']]);
	});

	it('řádek bez množství je jeden kus za celou částku, ne nula', async () => {
		const invoice = await sample('bez-mnozstvi.isdoc');

		expect(invoice.lines.map(({ quantity, unit }) => [quantity, unit])).toEqual([[1, '']]);
		expect(invoiceTotalCents(invoice)).toBe(480_000);
	});

	it('množství bez jednotky nechá jednotku prázdnou', async () => {
		const invoice = await project(MINIMAL_ISDOC.replace(' unitCode="ks"', ''));

		expect(invoice.lines[0]?.unit).toBe('');
	});

	it('součet řádků sedí s částkou k úhradě', async () => {
		for (const name of [
			'foreign-document.isdoc',
			'bez-mnozstvi.isdoc',
			'zaokrouhleni.isdoc',
			'two-payments.isdoc',
		]) {
			const xml = await fixture(name);
			const document = await parse(xml);
			const payable = toCents(text(child(document.documentElement, 'LegalMonetaryTotal'), 'PayableAmount'));

			expect([name, invoiceTotalCents(intoInvoice(document))]).toEqual([name, payable]);
		}
	});

	it('zaokrouhlení ukáže jako řádek', async () => {
		const invoice = await sample('zaokrouhleni.isdoc');

		expect(invoiceTotalCents(invoice)).toBe(100_000);
		expect(invoice.lines[1]).toEqual({
			description: 'Zaokrouhlení',
			quantity: 1,
			unit: '',
			unitPriceCents: 37,
			itemId: '',
		});
	});

	it('nulové zaokrouhlení řádek nepřidá', async () => {
		const xml = MINIMAL_ISDOC.replace(
			'<PaidDepositsAmount>',
			'<PayableRoundingAmount>-0.00</PayableRoundingAmount>\n    <PaidDepositsAmount>',
		);

		const invoice = await project(xml);

		expect(invoice.lines.length).toBe(1);
	});

	it('zálohovou fakturu mezi vydané nepustí', async () => {
		const xml = await fixture('zalohova.isdoc');

		expect(await projectionError(xml)).toEqual(
			new Error(
				'doklad typu 4 (zálohová faktura (nedaňový zálohový list)) appka neumí — do vydaných faktur nepatří',
			),
		);
	});

	it('přečte jen fakturu a dobropis', async () => {
		// `xs:integer` pustí i nuly na začátku, znaménko a mezery kolem.
		const kinds = new Map([
			['1', DocumentKind.Invoice],
			['2', DocumentKind.CreditNote],
			['01', DocumentKind.Invoice],
			[' +2 ', DocumentKind.CreditNote],
		]);
		for (const [type, kind] of kinds) {
			const invoice = await project(MINIMAL_ISDOC.replace('<DocumentType>1<', `<DocumentType>${type}<`));

			expect(invoice.documentType).toBe(kind);
		}
		for (const [type, description] of [
			['3', 'vrubopis'],
			['5', 'daňový doklad při přijetí platby'],
			['6', 'opravný daňový doklad při přijetí platby'],
			['7', 'zjednodušený daňový doklad'],
		] as const) {
			const xml = MINIMAL_ISDOC.replace('<DocumentType>1<', `<DocumentType>${type}<`);

			expect(await projectionError(xml)).toEqual(
				new Error(`doklad typu ${type} (${description}) appka neumí — do vydaných faktur nepatří`),
			);
		}
	});
});

describe('částky řádku', () => {
	it('cenu, která dává částku řádku, vezme z dokladu', async () => {
		const invoice = await project(minimalWith('4', '250.00'));

		expect(invoice.lines[0]).toEqual({
			description: 'Konzultace',
			quantity: 4,
			unit: 'ks',
			unitPriceCents: 25_000,
			itemId: '',
		});
	});

	it('cenu pod haléř složí do popisu a částku řádku zachová', async () => {
		const invoice = await project(minimalWith('  1000  ', '  0.21837  ', '218.37'));

		expect(invoice.lines[0]).toEqual({
			description: 'Konzultace (1000 ks × 0,21837 Kč)',
			quantity: 1,
			unit: '',
			unitPriceCents: 21_837,
			itemId: '',
		});
		expect(invoiceTotalCents(invoice)).toBe(21_837);
	});

	it('cenu pod haléř u řádku bez popisu napíše bez mezery na začátku', async () => {
		const xml = minimalWith('1000', '0.21837', '218.37').replace(
			'<Description>Konzultace</Description>',
			'<Description></Description>',
		);

		const invoice = await project(xml);

		expect(invoice.lines[0]?.description).toBe('(1000 ks × 0,21837 Kč)');
	});

	it('cenu, která částku řádku nedává, odmítne', async () => {
		for (const [quantity, price] of [
			['0', '1000.00'],
			['2', '1000.00'],
		] as const) {
			expect(await projectionError(minimalWith(` ${quantity} `, ` ${price} `, ' 1000.00 '))).toEqual(
				new Error(`řádek 1: ${quantity} × ${price} Kč nedává částku řádku 1000.00 Kč`),
			);
		}
	});

	it('částku řádku nad strop odmítne', async () => {
		const xml = minimalWith('1', '1000.00', '100000000000.00');

		expect(await projectionError(xml)).toEqual(
			new Error(
				'řádek 1: částka v <LineExtensionAmount>: částka „100000000000.00“ přesahuje strop 90 miliard Kč',
				{ cause: new Error('částka „100000000000.00“ přesahuje strop 90 miliard Kč') },
			),
		);
	});

	it('jednotkovou cenu nad strop odmítne', async () => {
		const xml = minimalWith('0.00000001', '100000000000.00');

		expect(await projectionError(xml)).toEqual(
			new Error('řádek 1: jednotková cena „100000000000.00“ přesahuje strop 90 miliard Kč'),
		);
	});

	it('množství, které se nevejde do čísla, odmítne', async () => {
		const huge = `1${'0'.repeat(400)}`;

		expect(await projectionError(minimalWith(huge, '1000.00'))).toEqual(
			new Error(`řádek 1: množství „${huge}“ je mimo rozsah`),
		);
	});

	it('zaokrouhlení nad strop odmítne', async () => {
		const xml = MINIMAL_ISDOC.replace(
			'<PaidDepositsAmount>',
			'<PayableRoundingAmount>100000000000</PayableRoundingAmount>\n    <PaidDepositsAmount>',
		);

		expect(await projectionError(xml)).toEqual(
			new Error('zaokrouhlení v <PayableRoundingAmount>: částka „100000000000“ přesahuje strop 90 miliard Kč', {
				cause: new Error('částka „100000000000“ přesahuje strop 90 miliard Kč'),
			}),
		);
	});

	it('nečíselnou cenu, množství ani částku nepustí už XSD', async () => {
		const cases = [
			[minimalWith('1', 'tisíc'), 'ISDOC nejde přečíst: řádek 46: prvek UnitPrice neodpovídá standardu ISDOC'],
			[
				minimalWith('moc', '1000.00'),
				'ISDOC nejde přečíst: řádek 42: prvek InvoicedQuantity neodpovídá standardu ISDOC',
			],
			[
				minimalWith('1', '1000.00', 'moc'),
				'ISDOC nejde přečíst: řádek 43: prvek LineExtensionAmount neodpovídá standardu ISDOC',
			],
			[
				MINIMAL_ISDOC.replace(
					'<PaidDepositsAmount>',
					'<PayableRoundingAmount>0,4</PayableRoundingAmount>\n    <PaidDepositsAmount>',
				),
				'ISDOC nejde přečíst: řádek 74: prvek PayableRoundingAmount neodpovídá standardu ISDOC',
			],
		] as const;
		for (const [xml, message] of cases) {
			await expect(parse(xml)).rejects.toEqual(new Error(message));
		}
	});

	it('desetinnou čárku a oddělovač tisíců v řádku nepustí XSD', async () => {
		const xml = await fixture('foreign-document.isdoc');

		await expect(parse(xml.replace('>1.5</InvoicedQuantity>', '>1,5</InvoicedQuantity>'))).rejects.toEqual(
			new Error('ISDOC nejde přečíst: řádek 42: prvek InvoicedQuantity neodpovídá standardu ISDOC'),
		);
		await expect(parse(xml.replace('<UnitPrice>1250.00', '<UnitPrice>1250,00'))).rejects.toEqual(
			new Error('ISDOC nejde přečíst: řádek 46: prvek UnitPrice neodpovídá standardu ISDOC'),
		);
	});
});

describe('platba a odběratel', () => {
	it('doklad bez platebních údajů má bankovní pole prázdná', async () => {
		const invoice = await project(MINIMAL_ISDOC.replace(/ {2}<PaymentMeans>[\s\S]*<\/PaymentMeans>\n/, ''));

		expect([invoice.dueDate, invoice.bankAccount, invoice.bankCode, invoice.iban, invoice.variableSymbol]).toEqual([
			'',
			'',
			'',
			'',
			'',
		]);
	});

	it('platba bez detailů bankovní spojení nemá', async () => {
		const invoice = await project(MINIMAL_ISDOC.replace(PAYMENT_DETAILS, ''));

		expect([invoice.dueDate, invoice.bankAccount, invoice.variableSymbol]).toEqual(['', '', '']);
	});

	it('platba odkazem na jiný doklad bankovní účet nemá', async () => {
		const invoice = await project(
			MINIMAL_ISDOC.replace(
				PAYMENT_DETAILS,
				`      <Details>
        <DocumentID>zaloha-2026-01</DocumentID>
        <IssueDate>2026-05-01</IssueDate>
      </Details>
`,
			),
		);

		expect([invoice.dueDate, invoice.bankAccount]).toEqual(['', '']);
	});

	it('převod odkazem na jiný doklad přeskočí a účet vezme z převodu se splatností', async () => {
		const reference = `    <Payment>
      <PaidAmount>0.00</PaidAmount>
      <PaymentMeansCode>42</PaymentMeansCode>
      <Details>
        <DocumentID>zaloha-2026-01</DocumentID>
        <IssueDate>2026-05-01</IssueDate>
      </Details>
    </Payment>
`;
		const invoice = await project(MINIMAL_ISDOC.replace('  <PaymentMeans>\n', `  <PaymentMeans>\n${reference}`));

		expect([invoice.dueDate, invoice.bankAccount]).toEqual(['2026-06-11', '2000145399']);
	});

	it('účet vezme z platby převodem, ne z první v pořadí', async () => {
		const xml = await fixture('two-payments.isdoc');
		for (const code of ['42', '042']) {
			const invoice = await project(xml.replace('<PaymentMeansCode>42<', `<PaymentMeansCode>${code}<`));

			expect([
				invoice.bankAccount,
				invoice.bankCode,
				invoice.iban,
				invoice.variableSymbol,
				invoice.dueDate,
			]).toEqual(['2000145399', '0800', 'CZ6508000000192000145399', '202600047', '2026-03-24']);
		}
	});

	it('bez převodu vezme spojení z první platby, která ho má', async () => {
		const invoice = await project(
			MINIMAL_ISDOC.replace('<PaymentMeansCode>42</PaymentMeansCode>', '<PaymentMeansCode>31</PaymentMeansCode>'),
		);

		expect([invoice.bankAccount, invoice.iban, invoice.variableSymbol]).toEqual([
			'2000145399',
			'CZ6508000000192000145399',
			'20260001',
		]);
	});

	it('anonymní odběratel má pole odběratele prázdná', async () => {
		const invoice = await project(
			MINIMAL_ISDOC.replace(
				CUSTOMER,
				`  <AnonymousCustomerParty>
    <ID>bez-udaju</ID>
    <IDScheme>internal</IDScheme>
  </AnonymousCustomerParty>
`,
			),
		);

		expect(invoice.customer).toEqual({
			name: '',
			ico: '',
			dic: '',
			address: {
				street: '',
				city: '',
				zip: '',
			},
			email: '',
			registration: '',
		});
	});

	it('značka anonymního odběratele účetního odběratele nesmaže', async () => {
		const invoice = await project(
			MINIMAL_ISDOC.replace(
				'  <AccountingCustomerParty>',
				`  <AnonymousCustomerParty>
    <ID>objednavka-42</ID>
    <IDScheme>internal</IDScheme>
  </AnonymousCustomerParty>
  <AccountingCustomerParty>`,
			),
		);

		expect([invoice.customer.name, invoice.customer.ico, invoice.customer.address.city]).toEqual([
			'Odběratel s.r.o.',
			'87654326',
			'Brno',
		]);
	});
});
