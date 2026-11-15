import { Buffer } from 'node:buffer';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { NodeCompiler, type NodeTypstDocument } from '@myriaddreamin/typst-ts-node-compiler';
import pLimit from 'p-limit';

import { errorText } from '~/utils/errors';

import { MAX_ISDOC_BYTES, parse } from './isdoc/mod.ts';

import type { PdfContent, PdfRequest } from './pdf-document.ts';
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

// Ze zdrojů běží `worker.ts` vedle tohoto modulu, z bundlu `worker.mjs` vedle `main.mjs`. Ze
// zdrojů ho Node spouští bez překladu, takže jeho importy nesmí sáhnout na alias `~/`.
const PDF_WORKER = new URL(`./worker${extname(fileURLToPath(import.meta.url))}`, import.meta.url);
// Hlavní proces na worker nečeká blokovaně, takže limit jen uklidí zaseknutou práci; doklad trvá zlomek sekundy.
const PDF_TIMEOUT = 30_000;
// Skutečný doklad má stovky objektů. Proud objektů, který se rozbalí na miliony, přeteče a zabije worker, ne appku.
const PDF_HEAP_MB = 256;

// pdf-lib rozbalí proudy objektů synchronně a bez stropu, takže PDF čte a ukládá jen worker, který jde
// zabít. Jeden na proces, založený až prvním PDF.
let pdfWorker: Worker | undefined;
// Práce jdou po jedné, takže odpověď workeru patří vždy té, která zrovna čeká.
const pdfJobs = pLimit(1);

type PdfAnswer<T> = { result: T } | { error: unknown };

function startPdfWorker(): Worker {
	// Strop příloh dostane worker od nás: modul s ním importuje alias, který Node ze zdrojů nenačte.
	const worker = new Worker(PDF_WORKER, {
		workerData: MAX_ISDOC_BYTES,
		resourceLimits: {
			maxOldGenerationSizeMb: PDF_HEAP_MB,
		},
	});
	// Stryker disable next-line CallExpression: ekvivalentní mutant, proces drží naživu čekající práce, test pozdější konec procesu nevidí.
	worker.unref();
	// Stryker disable next-line BlockStatement,StringLiteral: další práce by čekala na mrtvý worker celý limit.
	worker.once('exit', () => {
		pdfWorker = undefined;
	});
	pdfWorker = worker;
	return worker;
}

async function exchange<T>(request: PdfRequest): Promise<PdfAnswer<T>> {
	const worker = pdfWorker ?? startPdfWorker();
	const answer = Promise.withResolvers<PdfAnswer<T>>();
	const stopped = () => answer.reject(new Error('práce s PDF nedoběhla'));
	const timer = setTimeout(() => void worker.terminate(), PDF_TIMEOUT);
	worker.once('message', answer.resolve);
	worker.once('error', answer.reject);
	worker.once('exit', stopped);
	try {
		// Prázdný seznam přenášených bufferů: bez něj lint plete `postMessage` s tím z `window`.
		worker.postMessage(request, []);
		const reply = await answer.promise;
		return reply;
	} finally {
		clearTimeout(timer);
		// Stryker disable next-line StringLiteral,CallExpression: ekvivalentní mutant, posluchač `once` po odpovědi zmizí sám a bez odpovědi worker skončil.
		worker.off('message', answer.resolve);
		worker.off('error', answer.reject);
		worker.off('exit', stopped);
	}
}

// Spadlý, přeteklý nebo zaseknutý worker je chyba téhle práce; další práce založí nový.
async function ask<T>(request: PdfRequest): Promise<T> {
	let reply: PdfAnswer<T>;
	try {
		reply = await pdfJobs(() => exchange<T>(request));
	} catch (error) {
		throw new Error('PDF nejde rozbalit v rozumném čase ani paměti — takhle doklad nevypadá', { cause: error });
	}
	if ('error' in reply) throw reply.error;
	return reply.result;
}

// Načtené PDF jsou jen data: hlavní proces dokument pdf-lib nedrží.
export interface LoadedPdf extends PdfContent {
	bytes: Uint8Array;
}

export async function loadPdf(bytes: Uint8Array): Promise<LoadedPdf> {
	const content = await ask<PdfContent>({ read: bytes });
	return {
		bytes,
		...content,
	};
}

export interface EmbeddedIsdoc {
	xml: string;
	document: Document;
}

interface FoundIsdoc {
	index: number;
	replaceable: boolean;
	isdoc: EmbeddedIsdoc;
}

// Jmenný prostor bez verze: k ISDOC se hlásí i doklad starší verze.
const ISDOC_CLAIM = 'http://isdoc.cz/namespace/';

// Stryker disable next-line StringLiteral: neplatné kódování hodí RangeError už při importu, takže se nespustí žádný test.
const UTF8 = new TextDecoder('utf-8', { fatal: true });
// Každý bajt na jeden znak, takže se jmenný prostor najde i v textu, který není UTF-8.
// Stryker disable next-line StringLiteral: neplatné kódování hodí RangeError už při importu, takže se nespustí žádný test.
const BYTES = new TextDecoder('latin1');

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
async function uniqueIsdoc(pdf: PdfContent): Promise<FoundIsdoc | { reason: string }> {
	if ('reason' in pdf.attachments) return pdf.attachments;
	let found: FoundIsdoc | undefined;
	let failure: string | undefined;
	for (const [index, { content, replaceable }] of pdf.attachments.entries()) {
		const attachment = await parseAttachment(content);
		if (typeof attachment !== 'object') {
			failure = failure ?? attachment;
			continue;
		}
		if (found) return { reason: 'PDF obsahuje více platných ISDOC příloh' };
		found = {
			index,
			replaceable,
			isdoc: attachment,
		};
	}
	if (found) return found;
	if (failure === undefined) return { reason: 'PDF neobsahuje přílohu ISDOC' };
	return { reason: `PDF má vadnou přílohu ISDOC — ${failure}` };
}

// Chyba říká, jestli příloha chybí, je vadná, nebo jsou platné dvě.
export async function readIsdoc(pdf: PdfContent): Promise<EmbeddedIsdoc> {
	const lookup = await uniqueIsdoc(pdf);
	if ('reason' in lookup) throw new Error(lookup.reason);
	return lookup.isdoc;
}

// Vrátí bajty PDF s vyměněnou přílohou; původní `pdf` zůstane, jak byl.
export async function replaceIsdoc(pdf: LoadedPdf, xml: string): Promise<Uint8Array> {
	const lookup = await uniqueIsdoc(pdf);
	if ('reason' in lookup) throw new Error(`${lookup.reason}.`);
	if (!lookup.replaceable) {
		throw new Error('ISDOC přílohu v PDF nejde bezpečně nahradit — nemá samostatný datový stream.');
	}
	const saved = await ask<Uint8Array>({
		rewrite: pdf.bytes,
		index: lookup.index,
		xml,
	});
	return saved;
}
