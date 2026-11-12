import { Buffer } from 'node:buffer';
import { inflateSync } from 'node:zlib';

import { NodeCompiler, type NodeTypstDocument } from '@myriaddreamin/typst-ts-node-compiler';
import {
	PDFArray,
	PDFDict,
	PDFDocument,
	PDFName,
	PDFRawStream,
	PDFRef,
	PDFStream,
	PDFString,
	type PDFObject,
} from 'pdf-lib';

import { errorText } from '~/utils/errors';

import { MAX_ISDOC_BYTES, parse } from './isdoc/mod.ts';

import type { Document } from '@xmldom/xmldom';

// Pod tímhle jménem ho vkládá `#pdf.attach` v `invoice/template.ts`.
export const ISDOC_ATTACHMENT = 'invoice.isdoc';

// Soubory pro typst žijí jen v paměti překladače; cesta na disku za nimi není.
const WORKSPACE = '/fakturian';
const MAIN = `${WORKSPACE}/main.typ`;

const COMPILER = NodeCompiler.create({ workspace: WORKSPACE });

// Stryker disable next-line Regex: ekvivalentní mutant, typst.ts začíná SVG vždy touhle hlavičkou.
const SVG_SIZE = /^<svg viewBox="0 0 ([\d.]+) ([\d.]+)" width="[\d.]+pt" height="[\d.]+pt"/;

export type TypstFiles = Record<string, Uint8Array>;

// Překladač je sdílený: mezi `resetShadow` a překladem není `await`, takže se soubory dvou dokladů
// nepromíchají.
export function compileTypst(source: string, files: TypstFiles): NodeTypstDocument {
	COMPILER.resetShadow();
	COMPILER.mapShadow(MAIN, Buffer.from(source));
	for (const [name, content] of Object.entries(files)) {
		COMPILER.mapShadow(`${WORKSPACE}/${name}`, Buffer.from(content));
	}
	const compiled = COMPILER.compile({ mainFilePath: MAIN });
	const error = compiled.takeError();
	if (error) {
		throw new Error('Doklad se nepodařilo vysázet.', {
			cause: new Error(JSON.stringify(COMPILER.fetchDiagnostics(error))),
		});
	}
	// Typy typst.ts dokument a chybu nesvazují; bez chyby dokument být musí.
	const document = compiled.result;
	if (!document) throw new Error('Doklad se nepodařilo vysázet.');
	return document;
}

export function renderTypstPdf(source: string, files: TypstFiles): Uint8Array {
	const document = compileTypst(source, files);
	try {
		return COMPILER.pdf(document, {
			pdfStandard: 'a-3a',
			creationTimestamp: Math.floor(Date.now() / 1000),
		});
	} catch (error) {
		throw new Error('Doklad se nepodařilo uložit jako PDF.', { cause: error });
	}
}

// Typst.ts vydá SVG celého dokumentu se stránkami pod sebou, takže stránka je výřez `viewBox`. Šablona
// nastavuje papír jednou pro celý doklad, stránky jsou proto stejně vysoké.
export function renderTypstSvg(source: string, files: TypstFiles): string[] {
	const document = compileTypst(source, files);
	const svg = COMPILER.plainSvg(document);
	// Bez rozměrů by každá „stránka“ potichu nesla celý dokument.
	const size = SVG_SIZE.exec(svg);
	if (!size) throw new Error('Náhled dokladu se nepodařilo připravit.');
	const [header, width, height] = size;
	const body = svg.slice(header.length);
	const pages = document.numOfPages;
	const pageHeight = Number(height) / pages;
	return Array.from(
		{ length: pages },
		(_, page) =>
			`<svg viewBox="0 ${page * pageHeight} ${width} ${pageHeight}" width="${width}pt" height="${pageHeight}pt"${body}`,
	);
}

// `ModDate` přílohy v UTC na celé sekundy. Odříznutí milisekund zaokrouhlí dolů i čas před rokem 1970.
export function pdfModDate(): string {
	return `D:${new Date().toISOString().slice(0, 19).replace(/\D/g, '')}Z`;
}

// `updateMetadata: false`: pdf-lib by jinak přepsal slovník `Info` a rozešel ho s XMP, na kterém stojí
// PDF/A. Chyba načtení nese důvod od pdf-lib, volající ho zasadí do své věty.
export function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
	return PDFDocument.load(bytes, { updateMetadata: false });
}

// Nové uložení mění dokument jen o vyměněnou přílohu: klasická tabulka xref bez proudů objektů, jak ho
// vysází typst, a žádná přidaná prázdná stránka.
export function savePdf(pdf: PDFDocument): Promise<Uint8Array> {
	return pdf.save({
		useObjectStreams: false,
		addDefaultPage: false,
	});
}

export interface EmbeddedIsdoc {
	xml: string;
	document: Document;
}

interface FoundIsdoc {
	// Hodnota `/EF /F` tak, jak ve filespecu stojí: nahradit jde jen stream s vlastním odkazem.
	entry: PDFObject | undefined;
	stream: PDFRawStream;
	isdoc: EmbeddedIsdoc;
}

// Strop je proti vadnému souboru, ne proti velkému: skutečné PDF má jednotky uzlů.
const NODE_LIMIT = 10_000;
const MAX_TREE_DEPTH = 16;
const MAX_NESTING = 64;
// Doklad nese jednu přílohu, výjimečně pár dalších; PDF s tisíci odkazy na tutéž zip bombu by jinak
// rozbalovalo a rozebíralo každý zvlášť.
const MAX_ATTACHMENTS = 16;

const FLATE = PDFName.of('FlateDecode');
const SIGNATURE = PDFName.of('Sig');

// Jmenný prostor bez verze: k ISDOC se hlásí i doklad starší verze.
const ISDOC_CLAIM = 'http://isdoc.cz/namespace/';

// Stryker disable next-line StringLiteral: neplatné kódování hodí RangeError už při importu, takže se nespustí žádný test.
const UTF8 = new TextDecoder('utf-8', { fatal: true });
// Každý bajt na jeden znak, takže se jmenný prostor najde i v textu, který není UTF-8.
// Stryker disable next-line StringLiteral: neplatné kódování hodí RangeError už při importu, takže se nespustí žádný test.
const BYTES = new TextDecoder('latin1');

// Tři pojistky, protože hloubka nestačí: uzel s `/Kids`, který odkazuje sám na sebe, by při hloubce 16
// dal sto na šestnáctou návštěv.
function collectNameTree(
	pdf: PDFDocument,
	node: PDFObject | undefined,
	found: PDFDict[],
	depth: number,
	seen: Set<PDFRef>,
): void {
	// Stryker disable next-line ConditionalExpression: bez pojistek se zacyklený strom prochází do timeoutu.
	if (depth > MAX_TREE_DEPTH || seen.size >= NODE_LIMIT) return;
	if (node instanceof PDFRef) {
		// Stryker disable next-line ConditionalExpression: bez téhle pojistky se zacyklený strom prochází do timeoutu.
		if (seen.has(node)) return;
		seen.add(node);
	}
	const dict = pdf.context.lookup(node);
	if (!(dict instanceof PDFDict)) return;
	const names = dict.lookup(PDFName.of('Names'));
	// Pole střídá jméno a filespec; jméno je text, takže slovníkem je jen filespec.
	if (names instanceof PDFArray) {
		for (const value of names.asArray()) {
			const filespec = pdf.context.lookup(value);
			if (filespec instanceof PDFDict) found.push(filespec);
		}
	}
	const kids = dict.lookup(PDFName.of('Kids'));
	if (kids instanceof PDFArray) {
		for (const kid of kids.asArray()) collectNameTree(pdf, kid, found, depth + 1, seen);
	}
}

// Přílohy z name tree `EmbeddedFiles`; katalogové `/AF` jen tehdy, když strom nedá nic.
function embeddedFiles(pdf: PDFDocument): PDFDict[] {
	const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
	if (!(catalog instanceof PDFDict)) return [];
	const found: PDFDict[] = [];
	const names = catalog.lookup(PDFName.of('Names'));
	if (names instanceof PDFDict) collectNameTree(pdf, names.get(PDFName.of('EmbeddedFiles')), found, 0, new Set());
	if (found.length > 0) return found;
	const associated = catalog.lookup(PDFName.of('AF'));
	if (!(associated instanceof PDFArray)) return [];
	return associated
		.asArray()
		.map((item) => pdf.context.lookup(item))
		.filter((item) => item instanceof PDFDict);
}

// Obsah přílohy nejvýš do `limit` bajtů. Rozbalování se zastaví na stropu, takže zip bomba nerozbalí
// gigabajty; neznámý filtr dá syrová data, pokud se do stropu vejdou.
function streamBytes(stream: PDFRawStream, limit: number): Uint8Array | undefined {
	const filter = stream.dict.lookup(PDFName.of('Filter'));
	const flate = filter === FLATE || (filter instanceof PDFArray && filter.size() === 1 && filter.get(0) === FLATE);
	if (!flate) return stream.contents.byteLength <= limit ? stream.contents : undefined;
	try {
		return inflateSync(stream.contents, { maxOutputLength: limit });
	} /* Stryker disable next-line BlockStatement: ekvivalentní mutant, funkce bez návratu vrátí `undefined` taky. */ catch {
		// Vadná data i obsah přes strop jsou nečitelná příloha; jiná příloha v PDF může být v pořádku.
		return undefined;
	}
}

// Název ani MIME nejsou důkaz o obsahu faktury. Důvod selhání se vrací jen u přílohy, která se k ISDOC
// hlásí svým jmenným prostorem — obrázek nebo jiné XML vadou dokladu není.
async function parseAttachment(bytes: Uint8Array): Promise<EmbeddedIsdoc | string | undefined> {
	const claimsIsdoc = BYTES.decode(bytes).includes(ISDOC_CLAIM);
	let xml: string;
	try {
		xml = UTF8.decode(bytes);
	} catch {
		return claimsIsdoc ? 'příloha není v kódování UTF-8' : undefined;
	}
	try {
		const document = await parse(xml);
		return {
			xml,
			document,
		};
	} catch (error) {
		return claimsIsdoc ? errorText(error) : undefined;
	}
}

// Příloh může být víc a každá se ověří úplným parserem. Dvě platné ISDOC přílohy jsou doklad, u kterého
// nejde říct, která platí.
async function uniqueIsdoc(pdf: PDFDocument): Promise<FoundIsdoc | { reason: string }> {
	let found: FoundIsdoc | undefined;
	let failure: string | undefined;
	const files = embeddedFiles(pdf);
	if (files.length > MAX_ATTACHMENTS) return { reason: `PDF má víc než ${MAX_ATTACHMENTS} příloh` };
	// Strop platí pro všechny přílohy dohromady, takže se v jednom PDF rozbalí a rozebere nejvýš tolik,
	// kolik smí mít jediný ISDOC.
	let budget = MAX_ISDOC_BYTES;
	for (const filespec of files) {
		const embedded = filespec.lookup(PDFName.of('EF'));
		if (!(embedded instanceof PDFDict)) continue;
		const stream = embedded.lookup(PDFName.of('F'));
		if (!(stream instanceof PDFRawStream)) continue;
		const bytes = streamBytes(stream, budget);
		// Stryker disable next-line ConditionalExpression: ekvivalentní mutant, prázdný obsah parser odmítne a k ISDOC se nehlásí.
		if (!bytes) continue;
		budget -= bytes.byteLength;
		const attachment = await parseAttachment(bytes);
		if (typeof attachment !== 'object') {
			failure = failure ?? attachment;
			continue;
		}
		if (found) return { reason: 'PDF obsahuje více platných ISDOC příloh' };
		found = {
			entry: embedded.get(PDFName.of('F')),
			stream,
			isdoc: attachment,
		};
	}
	if (found) return found;
	if (failure === undefined) return { reason: 'PDF neobsahuje přílohu ISDOC' };
	return { reason: `PDF má vadnou přílohu ISDOC — ${failure}` };
}

// Chyba říká, jestli příloha chybí, je vadná, nebo jsou platné dvě.
export async function readIsdoc(pdf: PDFDocument): Promise<EmbeddedIsdoc> {
	const lookup = await uniqueIsdoc(pdf);
	if ('reason' in lookup) throw new Error(lookup.reason);
	return lookup.isdoc;
}

// Obsah nalezené přílohy se nahradí na místě: přidaná druhá příloha by v dokumentu nechala starou
// i novou verzi.
export async function replaceIsdoc(pdf: PDFDocument, xml: string): Promise<void> {
	const lookup = await uniqueIsdoc(pdf);
	if ('reason' in lookup) throw new Error(`${lookup.reason}.`);
	if (!(lookup.entry instanceof PDFRef)) {
		throw new Error('ISDOC přílohu v PDF nejde bezpečně nahradit — nemá samostatný datový stream.');
	}
	const content = new TextEncoder().encode(xml);
	const { dict } = lookup.stream;
	dict.delete(PDFName.of('Filter'));
	dict.delete(PDFName.of('DecodeParms'));
	dict.set(PDFName.of('Subtype'), PDFName.of('text/xml'));
	// Celé `Params` znovu: cizí PDF v nich může nést `/CheckSum` původního obsahu.
	dict.set(
		PDFName.of('Params'),
		pdf.context.obj({
			Size: content.byteLength,
			ModDate: PDFString.of(pdfModDate()),
		}),
	);
	pdf.context.assign(lookup.entry, PDFRawStream.of(dict, content));
}

function objectHasSignature(object: PDFObject, depth: number): boolean {
	if (depth > MAX_NESTING) return true;
	if (object instanceof PDFArray) return object.asArray().some((value) => objectHasSignature(value, depth + 1));
	const dict = object instanceof PDFStream ? object.dict : object;
	if (!(dict instanceof PDFDict)) return false;
	return (
		dict.get(PDFName.of('Type')) === SIGNATURE ||
		dict.get(PDFName.of('FT')) === SIGNATURE ||
		dict.values().some((value) => objectHasSignature(value, depth + 1))
	);
}

// Podpis PDF (`/Type /Sig`) i podpisové pole formuláře (`/FT /Sig`). Nesmyslně hluboké vnoření se
// počítá jako podpis: projít ho celé by znamenalo riskovat přetečení zásobníku.
export function hasSignature(pdf: PDFDocument): boolean {
	return pdf.context.enumerateIndirectObjects().some(([, object]) => objectHasSignature(object, 0));
}
