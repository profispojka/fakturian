import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

import {
	PDFArray,
	PDFDict,
	PDFHexString,
	PDFName,
	PDFNull,
	PDFNumber,
	PDFRawStream,
	PDFString,
	PDFRef,
	PDFDocument,
	type PDFObject,
} from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

import { creditNote, invoice, MINIMAL_ISDOC } from './invoices.ts';
import { embeddedFiles, filespec, invoicePdf, samplePdf } from './pdfs.ts';
import { invoiceFiles } from './typst.ts';

import { buildIsdoc } from '../invoice/isdoc.ts';
import { invoiceTypst } from '../invoice/template.ts';
import { text } from '../isdoc/mod.ts';
import { hasSignature, ISDOC_ATTACHMENT, loadPdf, readIsdoc, renderTypstPdf, replaceIsdoc, savePdf } from '../pdf.ts';

const ENCODER = new TextEncoder();
const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;
const INSTANT = '2026-09-30T12:34:56.789Z';
const CONTRACT = ENCODER.encode('%PDF-1.5 tohle je smlouva, ne faktura');
const MISSING = new Error('PDF neobsahuje přílohu ISDOC');
const AMBIGUOUS = new Error('PDF obsahuje více platných ISDOC příloh');

function attachment(pdf: PDFDocument, name: PDFObject, mime: string | undefined, content: Uint8Array): PDFRef {
	const dict = {
		Type: 'EmbeddedFile',
		...(mime && { Subtype: PDFName.of(mime) }),
	};
	return filespec(pdf, name, pdf.context.stream(content, dict));
}

function associatedFiles(pdf: PDFDocument, files: PDFObject): void {
	pdf.catalog.set(PDFName.of('AF'), files);
}

async function withAttachments(attachments: [string, Uint8Array][]): Promise<PDFDocument> {
	const pdf = await samplePdf();
	embeddedFiles(
		pdf,
		attachments.map(([name, content]) => [
			PDFString.of(name),
			attachment(pdf, PDFString.of(name), 'text/xml', content),
		]),
	);
	return pdf;
}

async function withAssociated(stream: (pdf: PDFDocument) => PDFRawStream): Promise<PDFDocument> {
	const pdf = await samplePdf();
	const spec = pdf.context.register(
		pdf.context.obj({
			Type: 'Filespec',
			F: PDFString.of(ISDOC_ATTACHMENT),
			EF: {
				F: pdf.context.register(stream(pdf)),
			},
		}),
	);
	associatedFiles(pdf, pdf.context.obj([spec]));
	return pdf;
}

async function reason(pdf: PDFDocument): Promise<unknown> {
	try {
		await readIsdoc(pdf);
	} catch (error) {
		return error;
	}
	return undefined;
}

async function embeddedXml(pdf: PDFDocument): Promise<string> {
	const { xml } = await readIsdoc(pdf);
	return xml;
}

function ownIsdoc(): Promise<string> {
	return buildIsdoc(invoice());
}

// Doklad tak, jak leží ve `faktury/`: vysázený a znovu uložený přes pdf-lib.
async function savedInvoice(): Promise<{ pdf: PDFDocument; raw: string }> {
	const rendered = await loadPdf(await invoicePdf(invoice()));
	const saved = await savePdf(rendered);
	const pdf = await loadPdf(saved);
	return {
		pdf,
		raw: new TextDecoder('latin1').decode(saved),
	};
}

function lookupDict(pdf: PDFDocument, holder: PDFDict, key: string): PDFDict {
	const value = pdf.context.lookup(holder.get(PDFName.of(key)));
	if (!(value instanceof PDFDict)) throw new Error(`/${key} není slovník`);
	return value;
}

function embeddedStream(pdf: PDFDocument, spec: PDFDict): PDFRawStream {
	const stream = pdf.context.lookup(lookupDict(pdf, spec, 'EF').get(PDFName.of('F')));
	if (!(stream instanceof PDFRawStream)) throw new Error('/EF /F není stream');
	return stream;
}

function nameTree(pdf: PDFDocument): { names: PDFObject[]; spec: PDFDict } {
	const tree = lookupDict(pdf, lookupDict(pdf, pdf.catalog, 'Names'), 'EmbeddedFiles');
	const names = pdf.context.lookup(tree.get(PDFName.of('Names')));
	if (!(names instanceof PDFArray)) throw new Error('/Names není pole');
	const spec = pdf.context.lookup(names.get(1));
	if (!(spec instanceof PDFDict)) throw new Error('filespec není slovník');
	return {
		names: names.asArray(),
		spec,
	};
}

function decoded(value: PDFObject | undefined): string {
	if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
	throw new Error('hodnota není řetězec');
}

describe('příloha ISDOC v dokladu vysázeném typstem', () => {
	it('jmenuje se invoice.isdoc ve stromu jmen i ve filespecu a leží pod ním ISDOC, který se čte zpátky', async () => {
		const { pdf } = await savedInvoice();
		const { names, spec } = nameTree(pdf);
		const attached = inflateSync(embeddedStream(pdf, spec).contents).toString('utf8');
		const { xml } = await readIsdoc(pdf);

		expect([
			decoded(names[0]),
			decoded(spec.get(PDFName.of('F'))),
			decoded(spec.get(PDFName.of('UF'))),
			attached,
		]).toEqual([ISDOC_ATTACHMENT, ISDOC_ATTACHMENT, ISDOC_ATTACHMENT, xml]);
	});

	it('má MIME text/xml s lomítkem escapovaným jednou', async () => {
		const { pdf, raw } = await savedInvoice();
		const stream = embeddedStream(pdf, nameTree(pdf).spec);

		expect(stream.dict.get(PDFName.of('Subtype'))).toBe(PDFName.of('text/xml'));
		// Každý zápis jména `text/xml` v souboru, i dvakrát escapovaný (`#232F`).
		expect(raw.match(/\/text[#0-9A-F]*xml/g)).toEqual(['/text#2Fxml']);
	});

	it('je zdrojem dokladu a jedinou položkou /AF v katalogu', async () => {
		const { pdf } = await savedInvoice();
		const associated = pdf.context.lookup(pdf.catalog.get(PDFName.of('AF')));

		expect(nameTree(pdf).spec.get(PDFName.of('AFRelationship'))).toBe(PDFName.of('Source'));
		expect(associated instanceof PDFArray ? associated.size() : undefined).toBe(1);
	});

	it('po uložení dál hlásí PDF/A-3a', async () => {
		const { raw } = await savedInvoice();

		expect([/<pdfaid:part>(\d)</.exec(raw)?.[1], /<pdfaid:conformance>(\w)</.exec(raw)?.[1]]).toEqual(['3', 'A']);
	});

	it('datum změny přílohy je skutečný čas sazby v UTC', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(INSTANT);
		let pdf: PDFDocument;
		try {
			pdf = await loadPdf(await invoicePdf(invoice()));
		} finally {
			vi.useRealTimers();
		}
		const params = lookupDict(pdf, embeddedStream(pdf, nameTree(pdf).spec).dict, 'Params');

		expect(decoded(params.get(PDFName.of('ModDate')))).toBe('D:20260930123456Z');
	});

	it('vlastní doklad přečte zpátky', async () => {
		const { pdf } = await savedInvoice();

		const { xml, document } = await readIsdoc(pdf);

		expect([xml, text(document.documentElement, 'ID')]).toEqual([await ownIsdoc(), '20260001']);
	});

	it('vložený ISDOC přežije zápis na disk a nové načtení', async () => {
		const dir = await mkdtemp(join(tmpdir(), `fakturian-attachment-${process.pid}-`));
		try {
			const path = join(dir, 'invoice.pdf');
			await writeFile(path, renderTypstPdf(invoiceTypst('column'), invoiceFiles(invoice())));
			const pdf = await loadPdf(await readFile(path));

			const { xml } = await readIsdoc(pdf);

			expect([pdf.getPageCount(), xml]).toEqual([1, MINIMAL_ISDOC]);
		} finally {
			await rm(dir, { recursive: true });
		}
	});

	it('uložení nepřidá proudy objektů, prázdnou stránku ani razítko pdf-lib', async () => {
		const { pdf, raw } = await savedInvoice();
		const empty = await loadPdf(await savePdf(await PDFDocument.create()));

		expect([raw.includes('/ObjStm'), pdf.getProducer(), empty.getPageCount()]).toEqual([false, undefined, 0]);
	});

	it('podpis nemá', async () => {
		const { pdf } = await savedInvoice();

		expect(hasSignature(pdf)).toBe(false);
	});
});

describe('načtení PDF', () => {
	it('soubor, který PDF není, odmítne s důvodem od pdf-lib', async () => {
		await expect(loadPdf(ENCODER.encode('tohle PDF neni'))).rejects.toEqual(
			new Error('Failed to parse PDF document (line:0 col:28 offset=14): No PDF header found'),
		);
	});

	it('PDF bez katalogu přílohy nemá', async () => {
		const pdf = await loadPdf(ENCODER.encode('%PDF-1.7\n%%EOF\n'));

		expect(await reason(pdf)).toEqual(MISSING);
	});
});

describe('hledání ISDOC přílohy', () => {
	it('PDF bez přílohy to řekne', async () => {
		expect(await reason(await samplePdf())).toEqual(MISSING);
	});

	it('najde ji pod jiným jménem, bez přípony i bez MIME, podle obsahu', async () => {
		const xml = await ownIsdoc();
		for (const [name, mime] of [
			['export_2026.isdoc', 'text/xml'],
			['data.bin', 'text/xml'],
			['priloha', undefined],
		] as const) {
			const pdf = await samplePdf();
			embeddedFiles(pdf, [[PDFString.of(name), attachment(pdf, PDFString.of(name), mime, ENCODER.encode(xml))]]);

			const found = await readIsdoc(pdf);

			expect([name, found.xml]).toEqual([name, xml]);
		}
	});

	it('najde ji i jako druhou přílohu a ve stromu s /Kids', async () => {
		const pdf = await withAttachments([
			['smlouva.pdf', CONTRACT],
			[ISDOC_ATTACHMENT, ENCODER.encode(MINIMAL_ISDOC)],
		]);
		const kids = await samplePdf();
		const nodes = [
			['priloha-a.txt', ENCODER.encode('nic')],
			[ISDOC_ATTACHMENT, ENCODER.encode(MINIMAL_ISDOC)],
		] as const;
		const refs = nodes.map(([name, content]) =>
			kids.context.register(
				kids.context.obj({
					Limits: [PDFString.of(name), PDFString.of(name)],
					Names: [PDFString.of(name), attachment(kids, PDFString.of(name), 'text/xml', content)],
				}),
			),
		);
		kids.catalog.set(
			PDFName.of('Names'),
			kids.context.obj({
				EmbeddedFiles: {
					Kids: refs,
				},
			}),
		);

		expect(await embeddedXml(pdf)).toBe(MINIMAL_ISDOC);
		expect(await embeddedXml(kids)).toBe(MINIMAL_ISDOC);
	});

	it('jméno přílohy nerozhoduje, ani prázdné nebo v UTF-16', async () => {
		const xml = await ownIsdoc();
		for (const name of [PDFString.of(''), PDFHexString.fromText(ISDOC_ATTACHMENT), PDFNull]) {
			const pdf = await samplePdf();
			associatedFiles(pdf, pdf.context.obj([attachment(pdf, name, undefined, ENCODER.encode(xml))]));

			const found = await readIsdoc(pdf);

			expect(found.xml).toBe(xml);
		}
	});

	it('přílohu uvedenou jen v /AF najde', async () => {
		const xml = await ownIsdoc();
		const pdf = await samplePdf();
		associatedFiles(
			pdf,
			pdf.context.obj([attachment(pdf, PDFString.of(ISDOC_ATTACHMENT), 'text/xml', ENCODER.encode(xml))]),
		);

		expect(await embeddedXml(pdf)).toBe(xml);
	});

	it('/AF čte jen tehdy, když strom jmen nedá žádnou přílohu', async () => {
		const pdf = await withAttachments([['smlouva.pdf', CONTRACT]]);
		associatedFiles(
			pdf,
			pdf.context.obj([
				attachment(pdf, PDFString.of(ISDOC_ATTACHMENT), 'text/xml', ENCODER.encode(MINIMAL_ISDOC)),
			]),
		);

		expect(await reason(pdf)).toEqual(MISSING);
	});

	it('dvě platné přílohy jsou nejednoznačné, i když jedna má jméno ze specifikace', async () => {
		const xml = await ownIsdoc();
		const pdf = await withAttachments([
			['objednavka.xml', ENCODER.encode(xml)],
			[ISDOC_ATTACHMENT, ENCODER.encode(xml)],
		]);
		const other = await withAttachments([
			['export_2026.isdoc', ENCODER.encode(MINIMAL_ISDOC.replace('<ID>20260001</ID>', '<ID>JINY</ID>'))],
			[ISDOC_ATTACHMENT, ENCODER.encode(MINIMAL_ISDOC)],
		]);

		expect(await reason(pdf)).toEqual(AMBIGUOUS);
		expect(await reason(other)).toEqual(AMBIGUOUS);
		await expect(replaceIsdoc(pdf, xml)).rejects.toEqual(new Error('PDF obsahuje více platných ISDOC příloh.'));
	});

	it('přílohu bez jmenného prostoru ISDOC nevezme, ani jako jedinou', async () => {
		for (const content of [
			CONTRACT,
			ENCODER.encode('<Invoice/>'),
			ENCODER.encode('<?xml version="1.0"?><Invoice><ID>1</ID></Invoice>'),
			new Uint8Array([0xff, 0xfe, 0xfd]),
		]) {
			const pdf = await withAttachments([[ISDOC_ATTACHMENT, content]]);

			expect(await reason(pdf)).toEqual(MISSING);
		}
	});

	it('přílohu, která se k ISDOC hlásí, ale neprojde, nahlásí jako vadnou i s důvodem', async () => {
		const cases = [
			[
				'%PDF-1.5\n<< /Poznamka (schema: http://isdoc.cz/namespace/2013) >>\n',
				'ISDOC nejde přečíst: řádek 1: soubor není čitelné XML',
			],
			[
				'<Objednavka xmlns="http://example.com/obj" xmlns:i="http://isdoc.cz/namespace/2013"/>',
				'ISDOC nejde přečíst: řádek 1: prvek {http://example.com/obj}Objednavka neodpovídá standardu ISDOC',
			],
			[
				'<o:Objednavka xmlns:i="http://isdoc.cz/namespace/2013" xmlns:o="http://example.com/obj"/>',
				'ISDOC nejde přečíst: řádek 1: prvek {http://example.com/obj}Objednavka neodpovídá standardu ISDOC',
			],
			[
				'<Invoice xmlns="http://isdoc.cz/namespace/2013"><ID>1</ID>',
				'ISDOC nejde přečíst: řádek 1: soubor není čitelné XML',
			],
		] as const;
		for (const [content, why] of cases) {
			const pdf = await withAttachments([['objednavka.xml', ENCODER.encode(content)]]);

			expect(await reason(pdf)).toEqual(new Error(`PDF má vadnou přílohu ISDOC — ${why}`));
		}
	});

	it('u dvou vadných příloh řekne důvod té první', async () => {
		const pdf = await withAttachments([
			['prvni.xml', ENCODER.encode('<Invoice xmlns="http://isdoc.cz/namespace/2013"/>')],
			['druha.xml', new Uint8Array([...ENCODER.encode('http://isdoc.cz/namespace/'), 0xff])],
		]);

		expect(await reason(pdf)).toEqual(
			new Error(
				'PDF má vadnou přílohu ISDOC — ISDOC nejde přečíst: řádek 1: prvek Invoice neodpovídá standardu ISDOC',
			),
		);
	});

	it('platnou přílohu vezme, i když vedle ní leží vadná', async () => {
		const pdf = await withAttachments([
			['vadna.xml', ENCODER.encode('<Invoice xmlns="http://isdoc.cz/namespace/2013"/>')],
			[ISDOC_ATTACHMENT, ENCODER.encode(MINIMAL_ISDOC)],
		]);

		expect(await embeddedXml(pdf)).toBe(MINIMAL_ISDOC);
	});

	it('ISDOC s kořenem s prefixem a za dlouhým komentářem najde', async () => {
		const prefixed = MINIMAL_ISDOC.replace(/<(\/?)([A-Z])/g, '<$1i:$2').replace('xmlns=', 'xmlns:i=');
		// Deklarace XML smí stát jen na začátku, takže za komentářem jde doklad bez ní.
		const xml = await ownIsdoc();
		const commented = `<!-- ${'x'.repeat(9 * 1024)} -->\n${xml.replace('<?xml version="1.0" encoding="UTF-8"?>\n', '')}`;
		for (const content of [prefixed, commented]) {
			const pdf = await withAttachments([['data.bin', ENCODER.encode(content)]]);

			expect(await embeddedXml(pdf)).toBe(content);
		}
	});

	it('přílohu, která není v UTF-8, a přitom se k ISDOC hlásí, nahlásí', async () => {
		const pdf = await withAttachments([
			['data.bin', new Uint8Array([...ENCODER.encode('http://isdoc.cz/namespace/2013'), 0xff])],
		]);

		expect(await reason(pdf)).toEqual(new Error('PDF má vadnou přílohu ISDOC — příloha není v kódování UTF-8'));
	});
});

describe('vadné objekty příloh', () => {
	it('špatné typy objektů v cestě k příloze přeskočí', async () => {
		const scenarios: [string, (pdf: PDFDocument) => void][] = [
			['Names není slovník', (pdf) => pdf.catalog.set(PDFName.of('Names'), PDFString.of('neni-slovnik'))],
			['Names bez EmbeddedFiles', (pdf) => pdf.catalog.set(PDFName.of('Names'), pdf.context.obj({ Dests: {} }))],
			['AF není pole', (pdf) => associatedFiles(pdf, PDFString.of('neni-pole'))],
			['položka AF není odkaz', (pdf) => associatedFiles(pdf, pdf.context.obj([42]))],
			[
				'EF/F není stream',
				(pdf) => {
					const spec = pdf.context.register(
						pdf.context.obj({
							Type: 'Filespec',
							F: PDFString.of(ISDOC_ATTACHMENT),
							EF: {
								F: PDFString.of('neni-stream'),
							},
						}),
					);
					associatedFiles(pdf, pdf.context.obj([spec]));
				},
			],
			[
				'filespec bez jména a dat',
				(pdf) =>
					associatedFiles(
						pdf,
						pdf.context.obj([pdf.context.register(pdf.context.obj({ Type: 'Filespec' }))]),
					),
			],
			[
				'EmbeddedFiles odkazuje na chybějící objekt',
				(pdf) => pdf.catalog.set(PDFName.of('Names'), pdf.context.obj({ EmbeddedFiles: PDFRef.of(99_999) })),
			],
			[
				'EmbeddedFiles je číslo',
				(pdf) => pdf.catalog.set(PDFName.of('Names'), pdf.context.obj({ EmbeddedFiles: PDFNumber.of(42) })),
			],
			[
				'položky stromu jmen nejsou filespecy',
				(pdf) =>
					pdf.catalog.set(
						PDFName.of('Names'),
						pdf.context.obj({
							EmbeddedFiles: {
								Names: [PDFString.of('neplatný filespec'), 42, PDFString.of('osiřelé jméno')],
							},
						}),
					),
			],
		];
		for (const [label, corrupt] of scenarios) {
			const pdf = await samplePdf();
			corrupt(pdf);

			expect([label, await reason(pdf)]).toEqual([label, MISSING]);
		}
	});

	it('filespec bez datového streamu nepřečte ani nenahradí', async () => {
		const pdf = await samplePdf();
		const spec = pdf.context.register(
			pdf.context.obj({
				Type: 'Filespec',
				F: PDFString.of(ISDOC_ATTACHMENT),
			}),
		);
		embeddedFiles(pdf, [[PDFString.of(ISDOC_ATTACHMENT), spec]]);

		expect(await reason(pdf)).toEqual(MISSING);
		await expect(replaceIsdoc(pdf, 'new')).rejects.toEqual(new Error('PDF neobsahuje přílohu ISDOC.'));
	});

	it('neplatnou přílohu se jménem ISDOC nenahradí', async () => {
		const pdf = await withAttachments([[ISDOC_ATTACHMENT, CONTRACT]]);

		await expect(replaceIsdoc(pdf, 'new')).rejects.toEqual(new Error('PDF neobsahuje přílohu ISDOC.'));
	});
});

describe('strom jmen příloh', () => {
	async function chained(levels: number): Promise<PDFDocument> {
		const pdf = await samplePdf();
		const spec = attachment(pdf, PDFString.of(ISDOC_ATTACHMENT), 'text/xml', ENCODER.encode(MINIMAL_ISDOC));
		let node = pdf.context.register(pdf.context.obj({ Names: [PDFString.of(ISDOC_ATTACHMENT), spec] }));
		for (let level = 0; level < levels; level++) node = pdf.context.register(pdf.context.obj({ Kids: [node] }));
		pdf.catalog.set(PDFName.of('Names'), pdf.context.obj({ EmbeddedFiles: node }));
		return pdf;
	}

	async function wide(count: number): Promise<PDFDocument> {
		const pdf = await samplePdf();
		const spec = attachment(pdf, PDFString.of(ISDOC_ATTACHMENT), 'text/xml', ENCODER.encode(MINIMAL_ISDOC));
		const kids = Array.from({ length: count - 1 }, () => pdf.context.register(pdf.context.obj({})));
		kids.push(pdf.context.register(pdf.context.obj({ Names: [PDFString.of(ISDOC_ATTACHMENT), spec] })));
		pdf.catalog.set(
			PDFName.of('Names'),
			pdf.context.obj({
				EmbeddedFiles: {
					Kids: kids,
				},
			}),
		);
		return pdf;
	}

	it('projde šestnáct úrovní /Kids, sedmnáctou už ne', async () => {
		expect(await embeddedXml(await chained(16))).toBe(MINIMAL_ISDOC);
		expect(await reason(await chained(17))).toEqual(MISSING);
	});

	it('navštíví nejvýš deset tisíc uzlů', async () => {
		expect(await embeddedXml(await wide(10_000))).toBe(MINIMAL_ISDOC);
		expect(await reason(await wide(10_001))).toEqual(MISSING);
	});

	it('cyklický strom nezacyklí', async () => {
		const pdf = await samplePdf();
		const node = pdf.context.nextRef();
		pdf.context.assign(node, pdf.context.obj({ Kids: Array.from({ length: 200 }, () => node) }));
		pdf.catalog.set(PDFName.of('Names'), pdf.context.obj({ EmbeddedFiles: node }));

		expect(await reason(pdf)).toEqual(MISSING);
	});
});

describe('obsah přílohy', () => {
	function padded(xml: string, size: number): Uint8Array {
		const content = new Uint8Array(size).fill(0x20);
		content.set(ENCODER.encode(xml));
		return content;
	}

	async function compressed(content: Uint8Array): Promise<PDFDocument> {
		const pdf = await samplePdf();
		const stream = pdf.context.flateStream(content, {
			Type: 'EmbeddedFile',
			Subtype: PDFName.of('text/xml'),
		});
		expect(stream.contents.byteLength < 1024 * 1024).toBe(true);
		embeddedFiles(pdf, [[PDFString.of(ISDOC_ATTACHMENT), filespec(pdf, PDFString.of(ISDOC_ATTACHMENT), stream)]]);
		return pdf;
	}

	it('zabalenou přílohu rozbalí, zip bombu přes strop ne', async () => {
		// Mezery za kořenem XML povoluje, takže nafouknutá příloha zůstává platným ISDOC a najít ji brání
		// jen strop velikosti.
		const xml = await ownIsdoc();
		const small = padded(xml, xml.length + 1024 * 1024);

		expect(await embeddedXml(await compressed(small))).toBe(new TextDecoder().decode(small));
		expect(await reason(await compressed(padded(xml, MAX_ATTACHMENT_BYTES + 1)))).toEqual(MISSING);
	});

	it('filtr FlateDecode zadaný polem rozbalí, řetězec filtrů ne', async () => {
		const xml = await ownIsdoc();
		const filtered = (filters: string[]) => (pdf: PDFDocument) => {
			const stream = pdf.context.flateStream(ENCODER.encode(xml));
			stream.dict.set(PDFName.of('Filter'), pdf.context.obj(filters.map((filter) => PDFName.of(filter))));
			return stream;
		};

		expect(await embeddedXml(await withAssociated(filtered(['FlateDecode'])))).toBe(xml);
		expect(await reason(await withAssociated(filtered(['ASCIIHexDecode', 'FlateDecode'])))).toEqual(MISSING);
	});

	it('pole filtrů s jiným nebo dalším filtrem nerozbaluje', async () => {
		const xml = await ownIsdoc();
		const raw = (filters: string[]) => (pdf: PDFDocument) =>
			pdf.context.stream(ENCODER.encode(xml), {
				Filter: filters.map((filter) => PDFName.of(filter)),
			});

		expect(await embeddedXml(await withAssociated(raw(['ASCIIHexDecode'])))).toBe(xml);
		expect(await embeddedXml(await withAssociated(raw(['FlateDecode', 'ASCIIHexDecode'])))).toBe(xml);
	});

	it('poškozená zabalená data přeskočí', async () => {
		const pdf = await withAssociated((holder) =>
			holder.context.stream(ENCODER.encode('http://isdoc.cz/namespace/2013 nezabaleno'), {
				Filter: 'FlateDecode',
			}),
		);

		expect(await reason(pdf)).toEqual(MISSING);
	});

	it('neznámý filtr dá syrový obsah, pokud se vejde pod strop', async () => {
		const xml = await ownIsdoc();
		const raw = (content: Uint8Array) => (pdf: PDFDocument) => pdf.context.stream(content, { Filter: 'DCTDecode' });
		const unreadable = (size: number) => {
			const content = new Uint8Array(size).fill(0xff);
			content.set(ENCODER.encode('http://isdoc.cz/namespace/2013'));
			return content;
		};

		expect(await embeddedXml(await withAssociated(raw(ENCODER.encode(xml))))).toBe(xml);
		expect(await reason(await withAssociated(raw(unreadable(MAX_ATTACHMENT_BYTES))))).toEqual(
			new Error('PDF má vadnou přílohu ISDOC — příloha není v kódování UTF-8'),
		);
		expect(await reason(await withAssociated(raw(unreadable(MAX_ATTACHMENT_BYTES + 1))))).toEqual(MISSING);
	});

	it('strop velikosti platí pro všechny přílohy dohromady', async () => {
		const xml = ENCODER.encode(await ownIsdoc());
		const filler = (size: number) => new Uint8Array(size).fill(0x20);

		const fits = await withAttachments([
			['smlouva.txt', filler(MAX_ATTACHMENT_BYTES - xml.byteLength)],
			[ISDOC_ATTACHMENT, xml],
		]);
		const over = await withAttachments([
			['smlouva.txt', filler(MAX_ATTACHMENT_BYTES - xml.byteLength + 1)],
			[ISDOC_ATTACHMENT, xml],
		]);

		expect(await embeddedXml(fits)).toBe(new TextDecoder().decode(xml));
		expect(await reason(over)).toEqual(MISSING);
	});

	it('šestnáct příloh projde, sedmnáct už ne', async () => {
		const xml = ENCODER.encode(await ownIsdoc());
		const others = (count: number) =>
			Array.from({ length: count }, (_, index): [string, Uint8Array] => [`smlouva-${index}.txt`, CONTRACT]);

		const sixteen = await withAttachments([...others(15), [ISDOC_ATTACHMENT, xml]]);
		const seventeen = await withAttachments([...others(16), [ISDOC_ATTACHMENT, xml]]);

		expect(await embeddedXml(sixteen)).toBe(new TextDecoder().decode(xml));
		expect(await reason(seventeen)).toEqual(new Error('PDF má víc než 16 příloh'));
	});
});

describe('náhrada ISDOC přílohy', () => {
	it('přepíše existující stream, zruší filtr a zapíše velikost i datum změny', async () => {
		const xml = await ownIsdoc();
		const replacement = buildIsdoc(creditNote());
		const pdf = await samplePdf();
		const stream = pdf.context.flateStream(ENCODER.encode(xml), {
			Type: 'EmbeddedFile',
			Subtype: PDFName.of('application/xml'),
			DecodeParms: {
				Columns: 1,
			},
			Params: {
				Size: 1,
				CheckSum: PDFString.of('stary'),
			},
		});
		const spec = filespec(pdf, PDFString.of(ISDOC_ATTACHMENT), stream);
		embeddedFiles(pdf, [[PDFString.of(ISDOC_ATTACHMENT), spec]]);

		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(INSTANT);
		try {
			await replaceIsdoc(pdf, replacement);
		} finally {
			vi.useRealTimers();
		}
		const reloaded = await loadPdf(await savePdf(pdf));
		const written = embeddedStream(reloaded, nameTree(reloaded).spec);
		const params = lookupDict(reloaded, written.dict, 'Params');

		expect(await embeddedXml(reloaded)).toBe(replacement);
		expect(written.dict.get(PDFName.of('Filter'))).toBe(undefined);
		expect(written.dict.get(PDFName.of('DecodeParms'))).toBe(undefined);
		expect(written.dict.get(PDFName.of('Subtype'))).toBe(PDFName.of('text/xml'));
		expect(params.keys()).toEqual([PDFName.of('Size'), PDFName.of('ModDate')]);
		expect(params.get(PDFName.of('Size'))).toEqual(PDFNumber.of(ENCODER.encode(replacement).byteLength));
		expect(decoded(params.get(PDFName.of('ModDate')))).toBe('D:20260930123456Z');
	});

	it('stream vložený přímo ve filespecu nahradit nejde, i když se přečte', async () => {
		const xml = await ownIsdoc();
		const pdf = await samplePdf();
		const spec = pdf.context.register(
			pdf.context.obj({
				Type: 'Filespec',
				F: PDFString.of(ISDOC_ATTACHMENT),
				EF: {
					F: pdf.context.stream(ENCODER.encode(xml), { Subtype: PDFName.of('text/xml') }),
				},
			}),
		);
		embeddedFiles(pdf, [[PDFString.of(ISDOC_ATTACHMENT), spec]]);

		expect(await embeddedXml(pdf)).toBe(xml);
		await expect(replaceIsdoc(pdf, xml)).rejects.toEqual(
			new Error('ISDOC přílohu v PDF nejde bezpečně nahradit — nemá samostatný datový stream.'),
		);
	});

	it('nepřepíše jinou přílohu místo vložené', async () => {
		const xml = await ownIsdoc();
		const pdf = await samplePdf();
		const inline = pdf.context.register(
			pdf.context.obj({
				Type: 'Filespec',
				F: PDFString.of(ISDOC_ATTACHMENT),
				EF: {
					F: pdf.context.stream(ENCODER.encode(xml), { Subtype: PDFName.of('text/xml') }),
				},
			}),
		);
		const fallback = attachment(pdf, PDFString.of('fallback.isdoc'), 'text/xml', ENCODER.encode(xml));
		embeddedFiles(pdf, [
			[PDFString.of(ISDOC_ATTACHMENT), inline],
			[PDFString.of('fallback.isdoc'), fallback],
		]);

		expect(await reason(pdf)).toEqual(AMBIGUOUS);
		await expect(replaceIsdoc(pdf, 'new')).rejects.toEqual(new Error('PDF obsahuje více platných ISDOC příloh.'));
	});
});

describe('elektronický podpis v PDF', () => {
	async function withObject(object: (pdf: PDFDocument) => PDFObject): Promise<PDFDocument> {
		const pdf = await samplePdf();
		pdf.context.register(object(pdf));
		return pdf;
	}

	function nested(levels: number, wrap: (inner: PDFObject) => PDFObject): PDFObject {
		let object: PDFObject = PDFNull;
		for (let level = 0; level < levels; level++) object = wrap(object);
		return object;
	}

	it('pozná podpis dokumentu, podpisové pole i podpis ve streamu a v poli', async () => {
		const signatures: ((pdf: PDFDocument) => PDFObject)[] = [
			(pdf) => pdf.context.obj({ Type: 'Sig' }),
			(pdf) => pdf.context.obj({ FT: 'Sig' }),
			(pdf) => pdf.context.stream(new Uint8Array(), { Type: 'Sig' }),
			(pdf) => pdf.context.obj([pdf.context.obj({ Type: 'Sig' })]),
			(pdf) =>
				pdf.context.obj({
					AcroForm: {
						Fields: [pdf.context.obj({ FT: 'Sig' })],
					},
				}),
		];
		for (const signature of signatures) {
			expect(hasSignature(await withObject(signature))).toBe(true);
		}
		expect(
			hasSignature(
				await withObject((pdf) =>
					pdf.context.obj({
						Type: 'Annot',
						FT: 'Tx',
					}),
				),
			),
		).toBe(false);
	});

	it('vnoření do 64 úrovní projde, hlubší se počítá jako podpis', async () => {
		const arrays = (levels: number) => (pdf: PDFDocument) => nested(levels, (inner) => pdf.context.obj([inner]));
		const dicts = (levels: number) => (pdf: PDFDocument) =>
			nested(levels, (inner) => pdf.context.obj({ Child: inner }));

		expect(hasSignature(await withObject(arrays(64)))).toBe(false);
		expect(hasSignature(await withObject(arrays(65)))).toBe(true);
		expect(hasSignature(await withObject(arrays(66)))).toBe(true);
		expect(hasSignature(await withObject(dicts(64)))).toBe(false);
		expect(hasSignature(await withObject(dicts(65)))).toBe(true);
	});
});
