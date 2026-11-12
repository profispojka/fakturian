import { beforeAll, describe, expect, it } from 'vitest';

import { DocumentKind } from '~/constants/invoice';

import { buildIsdoc, invoiceUuid, parseIsdoc } from '../../invoice/isdoc.ts';
import { child, children, parse, text } from '../../isdoc/mod.ts';
import { creditNote, invoice, MINIMAL_ISDOC, sampleInvoice, samples } from '../invoices.ts';
import { fixture, schemaReport } from '../isdoc.ts';

import type { Invoice } from '../../invoice/model.ts';

const OUR_ISSUER = '<IssuingSystem>Fakturian</IssuingSystem>';
const FOREIGN_ISSUER = '<IssuingSystem>CiziSystem</IssuingSystem>';

const SAMPLE_CUSTOMER_REGISTRATION =
	'<RegisterIdentification><Preformatted>Zapsáno v evidenci pod IČO 87654326</Preformatted></RegisterIdentification>';
const SAMPLE_FIRST_ITEM = '<Description>Konzultace</Description></Item>';

// Doklad, jak se vrátí z ISDOC: UUID se při zápisu doplní.
function afterWrite(document: Invoice): Promise<Invoice> {
	const uuid = invoiceUuid(document);
	return {
		...document,
		uuid,
	};
}

describe('UUID dokladu', () => {
	it('odvodí UUIDv5 z IČO dodavatele, druhu a čísla dokladu', () => {
		expect(invoiceUuid(invoice())).toBe('3588469d-1bc3-524a-99f2-56991fb58e01');
		expect(invoiceUuid(creditNote())).toBe('cdf7a409-7012-5eb4-84b3-3731ae599efd');
	});

	it('UUID ve tvaru ze schématu nechá, i s velkými písmeny', () => {
		for (const uuid of ['9f1b8d3e-1234-4abc-8def-0123456789ab', '7B4C5BE0-288C-11D2-8E62-004095452B84']) {
			expect(
				invoiceUuid({
					...invoice(),
					uuid,
				}),
			).toBe(uuid);
		}
	});

	it('UUID mimo tvar schématu nahradí odvozeným', () => {
		for (const uuid of [
			'{9f1b8d3e-1234-4abc-8def-0123456789ab}',
			'9f1b8d3e12344abc8def0123456789ab',
			'not-a-uuid',
			'9f1b8d3e-1234-4abc-8def-0123456789ag',
			'9f1b8d3e-1234-4abc-8def-0123456789ab-extra',
			'urn:uuid:9f1b8d3e-1234-4abc-8def-0123456789ab',
		]) {
			expect(
				invoiceUuid({
					...invoice(),
					uuid,
				}),
			).toBe('3588469d-1bc3-524a-99f2-56991fb58e01');
		}
	});

	it('jiný druh nebo číslo dokladu dá jiné UUID', () => {
		const uuids = new Set([
			invoiceUuid(sampleInvoice()),
			invoiceUuid({
				...sampleInvoice(),
				documentType: DocumentKind.CreditNote,
			}),
			invoiceUuid({
				...sampleInvoice(),
				number: '20260099',
			}),
		]);

		expect(uuids.size).toBe(3);
	});
});

describe('zápis vlastního ISDOC', () => {
	let sample = '';

	beforeAll(async () => {
		sample = await fixture('sample-invoice.isdoc');
	});

	it('vzorová faktura dá přesně očekávaný ISDOC', () => {
		expect(buildIsdoc(sampleInvoice())).toBe(sample);
	});

	it('doklad se podepíše jako vystavený Fakturianem', async () => {
		const xml = buildIsdoc(invoice());
		const document = await parse(xml);

		expect(text(document.documentElement, 'IssuingSystem')).toBe('Fakturian');
	});

	it('cesta tam a zpět doklad nezmění', async () => {
		for (const document of [...samples(), sampleInvoice()]) {
			const xml = buildIsdoc(document);
			const expected = await afterWrite(document);

			expect(await parseIsdoc(xml)).toEqual(expected);
		}
	});

	it('dobropis s odkazem na původní doklad přežije cestu tam a zpět', async () => {
		const note: Invoice = {
			...sampleInvoice(),
			documentType: DocumentKind.CreditNote,
			number: '20260008',
			variableSymbol: '20260008',
			originalInvoice: '20260003',
			originalIssueDate: '2026-05-02',
			originalUuid: '9f1b8d3e-1234-4abc-8def-0123456789ab',
			lines: sampleInvoice().lines.map((line) => ({
				...line,
				unitPriceCents: -line.unitPriceCents,
			})),
		};

		const parsed = await parseIsdoc(buildIsdoc(note));

		expect(parsed).toEqual(await afterWrite(note));
	});

	it('z odkazu na původní doklad vynechá, co by schéma odmítlo', async () => {
		const xml = buildIsdoc({
			...sampleInvoice(),
			documentType: DocumentKind.CreditNote,
			originalInvoice: '20260003',
			originalIssueDate: '  ',
			originalUuid: '{9f1b8d3e-1234-4abc-8def-0123456789ab}',
		});
		const parsed = await parseIsdoc(xml);

		expect(xml.split('<OriginalDocumentReference>')[1]?.split('</OriginalDocumentReference>')[0]).toBe(
			'<ID>20260003</ID>',
		);
		expect([parsed.originalIssueDate, parsed.originalUuid]).toEqual(['', '']);
	});

	it('editace UUID nezmění', async () => {
		const loaded = await parseIsdoc(buildIsdoc(sampleInvoice()));
		const edited: Invoice = {
			...loaded,
			note: 'Upravená poznámka.',
			lines: loaded.lines.map((line, i) => ({
				...line,
				quantity: i === 0 ? 8 : line.quantity,
			})),
		};

		const again = await parseIsdoc(buildIsdoc(edited));

		expect(again.uuid).toBe(loaded.uuid);
	});

	it('řádky čísluje od jedné v pořadí', async () => {
		const document = await parse(buildIsdoc(sampleInvoice()));
		const lines = children(child(document.documentElement, 'InvoiceLines'), 'InvoiceLine');

		expect(lines.map((line) => text(line, 'ID'))).toEqual(['1', '2']);
	});

	it('vazba na položku ceníku jde do SellersItemIdentification a vrátí se jen na svůj řádek', async () => {
		const document = sampleInvoice();
		document.lines[0]!.itemId = ' p-dov ';

		const xml = buildIsdoc(document);
		const parsed = await parseIsdoc(xml);

		expect(xml).toBe(
			sample.replace(
				SAMPLE_FIRST_ITEM,
				'<Description>Konzultace</Description><SellersItemIdentification><ID>p-dov</ID></SellersItemIdentification></Item>',
			),
		);
		expect(parsed.lines.map((line) => line.itemId)).toEqual(['p-dov', '']);
	});

	it('cizí doklad vazbu na náš ceník ani rok čerpání nemá', async () => {
		const document = sampleInvoice();
		document.lines[0]!.itemId = 'p-dov';
		document.lines[0]!.usageYear = 2025;
		const source = buildIsdoc(document);
		const xml = source.replace(OUR_ISSUER, FOREIGN_ISSUER);

		const parsed = await parseIsdoc(xml);

		expect(parsed.lines[0]).toEqual({
			description: 'Konzultace',
			quantity: 3,
			unit: 'hod',
			unitPriceCents: 120_000,
			itemId: '',
		});
	});

	it('rok čerpání jde do řádkových Extensions a vrátí se jen na svůj řádek', async () => {
		const document = sampleInvoice();
		document.lines[0]!.usageYear = 2025;

		const xml = buildIsdoc(document);
		const parsed = await parseIsdoc(xml);

		expect(xml).toBe(
			sample.replace(
				SAMPLE_FIRST_ITEM,
				`${SAMPLE_FIRST_ITEM}<Extensions><fakturian:UsageYear xmlns:fakturian="https://fakturian.app/isdoc/extensions/1">2025</fakturian:UsageYear></Extensions>`,
			),
		);
		expect(parsed.lines.map((line) => line.usageYear)).toEqual([2025, undefined]);
	});

	it('vadný rok čerpání ohlásí, ne zahodí', async () => {
		const document = sampleInvoice();
		document.lines[0]!.usageYear = 2025;
		const xml = buildIsdoc(document);
		const second =
			'<fakturian:UsageYear xmlns:fakturian="https://fakturian.app/isdoc/extensions/1">2024</fakturian:UsageYear>';

		await expect(
			parseIsdoc(xml.replace('>2025</fakturian:UsageYear>', '>25</fakturian:UsageYear>')),
		).rejects.toEqual(new Error('řádek 1: neplatný rok čerpání limitu „25“.'));
		await expect(
			parseIsdoc(xml.replace('</fakturian:UsageYear>', `</fakturian:UsageYear>${second}`)),
		).rejects.toEqual(new Error('řádek 1: ISDOC obsahuje více roků čerpání limitu.'));
	});

	it('zápis v rejstříku zapíše a prázdný vynechá', () => {
		const document = sampleInvoice();
		document.customer.registration = '  ';

		const xml = buildIsdoc(document);

		expect(xml).toBe(sample.replace(SAMPLE_CUSTOMER_REGISTRATION, ''));
	});

	it('prázdné DIČ, e-mail ani poznámku nevypíše', () => {
		const document = sampleInvoice();
		for (const party of [document.supplier, document.customer]) {
			party.dic = '';
			party.email = '';
		}
		document.note = '';

		const xml = buildIsdoc(document);

		expect(['<PartyTaxScheme>', '<Contact>', '<Note>'].map((tag) => xml.includes(tag))).toEqual([
			false,
			false,
			false,
		]);
		expect(['<PartyTaxScheme>', '<Contact>', '<Note>'].map((tag) => sample.includes(tag))).toEqual([
			true,
			true,
			true,
		]);
	});

	it('řídicí znaky do ISDOC neprojdou a text kolem nich zůstane', async () => {
		const document = sampleInvoice();
		document.note = 'před\u000Bza';
		document.lines[0]!.description = 'popis\u0000položky';

		const parsed = await parseIsdoc(buildIsdoc(document));

		expect([parsed.note, parsed.lines[0]?.description]).toEqual(['předza', 'popispoložky']);
	});

	it('text s koncem CDATA zapíše escapovaný a přečte zpátky', async () => {
		const document = sampleInvoice();
		document.note = 'Pozn ]]> za spolupráci.';

		const xml = buildIsdoc(document);
		const parsed = await parseIsdoc(xml);

		expect(xml).toBe(
			sample.replace('<Note>Děkuji za spolupráci.</Note>', '<Note>Pozn ]]&gt; za spolupráci.</Note>'),
		);
		expect(parsed.note).toBe(document.note);
	});

	it('bez vlastního variabilního symbolu vezme číslice čísla dokladu', async () => {
		const document: Invoice = {
			...sampleInvoice(),
			number: 'F2026-041',
			variableSymbol: '',
		};

		const xml = buildIsdoc(document);
		const parsed = await parseIsdoc(xml);

		expect(xml).toBe(
			sample
				.replace('<ID>20260007</ID>', '<ID>F2026-041</ID>')
				.replace(invoiceUuid(sampleInvoice()), invoiceUuid(document))
				.replace('<VariableSymbol>20260007</VariableSymbol>', '<VariableSymbol>2026041</VariableSymbol>'),
		);
		expect(parsed.variableSymbol).toBe('2026041');
	});

	it('větu o DPH napíše na každý řádek a přečte zpátky', async () => {
		const document: Invoice = {
			...sampleInvoice(),
			vatNote: ' Osvobozeno podle § 6 odst. 1 zákona o DPH. ',
		};

		const xml = buildIsdoc(document);
		const parsed = await parseIsdoc(xml);

		expect(xml).toBe(
			sample.replaceAll(
				'</ClassifiedTaxCategory>',
				'</ClassifiedTaxCategory><VATNote>Osvobozeno podle § 6 odst. 1 zákona o DPH.</VATNote>',
			),
		);
		expect(parsed.vatNote).toBe('Osvobozeno podle § 6 odst. 1 zákona o DPH.');
	});

	it('prázdnou větu o DPH neposílá', async () => {
		const parsed = await parseIsdoc(sample);

		expect(parsed.vatNote).toBe('');
	});
});

describe('vlastní ISDOC proti XSD', () => {
	it('pomocný minimální doklad projde', async () => {
		expect(await schemaReport(MINIMAL_ISDOC)).toBe('- validates\n');
	});

	it('každý vzorový doklad projde', async () => {
		for (const document of samples()) {
			const xml = buildIsdoc(document);

			expect([document.number, await schemaReport(xml)]).toEqual([document.number, '- validates\n']);
		}
	});

	it('escapování projde', async () => {
		const document = invoice();
		document.number = '20260006';
		document.customer.name = 'Vopičák & spol. <s.r.o.> "Ampersand"';
		document.note = 'Sleva 5 % < 10 % & doprava zdarma';
		document.lines[0]!.description = 'Práce <hodinově> & "paušál"';

		expect(await schemaReport(buildIsdoc(document))).toBe('- validates\n');
	});

	it('cena, která nedělí na celé koruny, dá částku řádku z vytištěné ceny', async () => {
		const document: Invoice = {
			...invoice(),
			number: '20260008',
			lines: [
				{
					description: 'Práce',
					quantity: 3,
					unit: 'hod',
					unitPriceCents: 33_333,
					itemId: '',
				},
			],
		};

		const xml = buildIsdoc(document);

		const parsed = await parse(xml);
		const line = child(child(parsed.documentElement, 'InvoiceLines'), 'InvoiceLine');

		expect([text(line, 'UnitPrice'), text(line, 'LineExtensionAmount')]).toEqual(['333.33', '999.99']);
		expect(await schemaReport(xml)).toBe('- validates\n');
	});

	it('rok čerpání v našem jmenném prostoru projde, v jmenném prostoru ISDOC ne', async () => {
		const document = invoice();
		document.number = '20260011';
		document.lines[0]!.usageYear = 2025;
		const xml = buildIsdoc(document);
		const inIsdoc = xml
			.replace('<fakturian:UsageYear xmlns:fakturian="https://fakturian.app/isdoc/extensions/1">', '<UsageYear>')
			.replace('</fakturian:UsageYear>', '</UsageYear>');

		expect(await schemaReport(xml)).toBe('- validates\n');
		expect(await schemaReport(inIsdoc)).toBe(
			"-:2: element UsageYear: Schemas validity error : Element '{http://isdoc.cz/namespace/2013}UsageYear': This element is not expected. Expected is ( ##other{http://isdoc.cz/namespace/2013}* ).\n- fails to validate\n",
		);
		await expect(parse(inIsdoc)).rejects.toEqual(
			new Error('ISDOC nejde přečíst: řádek 2: prvek UsageYear neodpovídá standardu ISDOC'),
		);
	});

	it('doklad bez položek XSD neprojde', async () => {
		const xml = buildIsdoc({
			...invoice(),
			number: '20260009',
			lines: [],
		});

		expect(await schemaReport(xml)).toBe(
			"-:2: element InvoiceLines: Schemas validity error : Element '{http://isdoc.cz/namespace/2013}InvoiceLines': Missing child element(s). Expected is ( {http://isdoc.cz/namespace/2013}InvoiceLine ).\n- fails to validate\n",
		);
		await expect(parse(xml)).rejects.toEqual(
			new Error('ISDOC nejde přečíst: řádek 2: prvek InvoiceLines neodpovídá standardu ISDOC'),
		);
	});

	it('doklad bez data plnění, s větou o DPH i bez adres projde', async () => {
		const withNote: Invoice = {
			...invoice(),
			vatNote: 'Osvobozeno podle § 6 odst. 1 zákona o DPH.',
		};
		const bare: Invoice = {
			...invoice(),
			supplier: {
				...invoice().supplier,
				dic: '',
				address: {
					street: '',
					city: '',
					zip: '',
				},
				email: '',
				registration: '',
			},
			customer: {
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
			},
		};

		for (const document of [invoice(), withNote, bare]) {
			const xml = buildIsdoc(document);

			const parsed = await parse(xml);

			expect([children(parsed.documentElement, 'TaxPointDate'), await schemaReport(xml)]).toEqual([
				[],
				'- validates\n',
			]);
		}
	});
});
