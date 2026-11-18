import { inflateSync } from 'node:zlib';

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

export interface PdfAttachment {
	content: Uint8Array;
	// Nahradit jde jen stream s vlastním odkazem ve filespecu.
	replaceable: boolean;
}

export interface PdfContent {
	signed: boolean;
	attachments: PdfAttachment[] | { reason: string };
}

export interface PdfRewrite {
	// Pořadí přílohy ve výsledku `readPdf` nad stejnými bajty.
	index: number;
	xml: string;
}

// Strop příloh jde s každou prací: modul s ním importuje alias, který Node ze zdrojů nenačte.
export type PdfRequest = { budget: number } & ({ read: Uint8Array } | ({ rewrite: Uint8Array } & PdfRewrite));

export type PdfAnswer = { result: PdfContent | Uint8Array } | { error: unknown };

interface Found {
	// Hodnota `/EF /F` tak, jak ve filespecu stojí.
	entry: PDFObject | undefined;
	stream: PDFRawStream;
	content: Uint8Array;
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

// Strop `budget` platí pro všechny přílohy dohromady, takže se v jednom PDF rozbalí nejvýš tolik, kolik
// smí mít jediný ISDOC.
function attachments(pdf: PDFDocument, budget: number): Found[] | { reason: string } {
	const files = embeddedFiles(pdf);
	if (files.length > MAX_ATTACHMENTS) return { reason: `PDF má víc než ${MAX_ATTACHMENTS} příloh` };
	const found: Found[] = [];
	let left = budget;
	for (const filespec of files) {
		const embedded = filespec.lookup(PDFName.of('EF'));
		if (!(embedded instanceof PDFDict)) continue;
		const stream = embedded.lookup(PDFName.of('F'));
		if (!(stream instanceof PDFRawStream)) continue;
		const content = streamBytes(stream, left);
		// Stryker disable next-line ConditionalExpression: ekvivalentní mutant, prázdný obsah parser odmítne a k ISDOC se nehlásí.
		if (!content) continue;
		left -= content.byteLength;
		found.push({
			entry: embedded.get(PDFName.of('F')),
			stream,
			content,
		});
	}
	return found;
}

// Podpis PDF (`/Type /Sig`) i podpisové pole formuláře (`/FT /Sig`). Nesmyslně hluboké vnoření se
// počítá jako podpis: projít ho celé by znamenalo riskovat přetečení zásobníku.
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

// Chyba načtení nese důvod od pdf-lib, volající ho zasadí do své věty.
export async function readPdf(bytes: Uint8Array, budget: number): Promise<PdfContent> {
	const pdf = await PDFDocument.load(bytes);
	const found = attachments(pdf, budget);
	return {
		signed: pdf.context.enumerateIndirectObjects().some(([, object]) => objectHasSignature(object, 0)),
		attachments:
			'reason' in found
				? found
				: found.map(({ entry, content }) => ({
						content,
						replaceable: entry instanceof PDFRef,
					})),
	};
}

// Příloha se nahradí na místě, přidaná druhá by nechala starou i novou verzi. Uložení zůstane jako ze
// sazby typstem: klasická tabulka xref bez proudů objektů a bez přidané prázdné stránky.
export async function rewritePdf(bytes: Uint8Array, budget: number, rewrite: PdfRewrite): Promise<Uint8Array> {
	// `updateMetadata: false`: pdf-lib by jinak přepsal slovník `Info` a rozešel ho s XMP, na kterém stojí PDF/A.
	const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
	const found = attachments(pdf, budget);
	// Stryker disable next-line StringLiteral: ekvivalentní mutant, `{ reason }` na indexu přílohu nemá.
	const target = 'reason' in found ? undefined : found[rewrite.index];
	if (!(target?.entry instanceof PDFRef)) throw new Error('Příloha k nahrazení v PDF není.');
	const content = new TextEncoder().encode(rewrite.xml);
	const { dict } = target.stream;
	dict.delete(PDFName.of('Filter'));
	dict.delete(PDFName.of('DecodeParms'));
	dict.set(PDFName.of('Subtype'), PDFName.of('text/xml'));
	// Celé `Params` znovu: cizí PDF v nich může nést `/CheckSum` původního obsahu.
	dict.set(
		PDFName.of('Params'),
		pdf.context.obj({
			Size: content.byteLength,
			ModDate: PDFString.fromDate(new Date()),
		}),
	);
	pdf.context.assign(target.entry, PDFRawStream.of(dict, content));
	return pdf.save({
		useObjectStreams: false,
		addDefaultPage: false,
	});
}

// Chyba pdf-lib je odpověď o dokumentu; podproces, který neodpoví, práci nedokončil.
export async function runPdfTask(request: PdfRequest): Promise<PdfAnswer> {
	try {
		if ('read' in request) {
			const content = await readPdf(request.read, request.budget);
			return { result: content };
		}
		const saved = await rewritePdf(request.rewrite, request.budget, request);
		return { result: saved };
	} catch (error) {
		return { error };
	}
}
