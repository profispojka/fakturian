import { Buffer } from 'node:buffer';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// Ze zdrojů běží `process.ts` vedle tohoto modulu, z bundlu `process.mjs` vedle `main.mjs`. Ze
// zdrojů ho Node spouští bez překladu, takže jeho importy nesmí sáhnout na alias `~/`.
const PDF_PROCESS = fileURLToPath(new URL(`./process${extname(fileURLToPath(import.meta.url))}`, import.meta.url));
// Doklad trvá zlomek sekundy; limit ukončí práci, která se zacyklí bez růstu paměti.
const PDF_TIMEOUT = 10_000;
// Přetečení haldy podprocesu skončí jen jeho pádem; skutečný doklad má stovky objektů.
const PDF_HEAP = '--max-old-space-size=512';

// pdf-lib rozbalí proudy objektů synchronně a bez stropu a přetečení jeho haldy V8 ohlásí pádem celého
// procesu. PDF proto čte a ukládá samostatný podproces: jeden, založený až prvním PDF, po pádu nový.
interface PdfProcess {
	events: NodeJS.EventEmitter;
	send: (request: PdfRequest) => void;
	kill: () => void;
}

let pdfProcess: PdfProcess | undefined;
// Po jedné, takže odpověď podprocesu patří vždy té práci, která zrovna čeká.
const pdfJobs = pLimit(1);

async function spawnPdfProcess(): Promise<PdfProcess> {
	// V appce `utilityProcess`: Electron s vypnutou fuse `runAsNode` jinak podproces Node nespustí.
	if (process.type === 'browser') {
		const { utilityProcess } = await import('electron');
		const child = utilityProcess.fork(PDF_PROCESS, [], {
			serviceName: 'Fakturian PDF',
			execArgv: [PDF_HEAP],
		});
		return {
			events: child,
			// Prázdný seznam přenášených portů: bez něj lint plete `postMessage` s tím z `window`.
			send: (request) => child.postMessage(request, []),
			kill: () => child.kill(),
		};
	}
	const child = fork(PDF_PROCESS, {
		serialization: 'advanced',
		execArgv: [PDF_HEAP],
	});
	// Nečinný podproces nedrží ukázky ani testy naživu; běžící práci drží její časovač.
	child.unref();
	// Stryker disable next-line OptionalChaining: ekvivalentní mutant, `fork` kanál IPC zakládá vždy.
	child.channel?.unref();
	return {
		events: child,
		send: (request) => child.send(request),
		kill: () => child.kill(),
	};
}

// Další zpráva podprocesu; když místo ní skončí, je to chyba.
async function nextMessage<T>(events: NodeJS.EventEmitter): Promise<T> {
	const settled = new AbortController();
	try {
		const [message] = await Promise.race([
			// Stryker disable next-line ObjectLiteral: ekvivalentní mutant, bez zprávy zůstane posluchač jen na skončeném podprocesu.
			once(events, 'message', { signal: settled.signal }),
			once(events, 'exit', { signal: settled.signal }).then(([code]) => {
				throw new Error(`podproces PDF skončil s kódem ${code}`);
			}),
		]);
		return message;
	} finally {
		settled.abort();
	}
}

function ask<T>(request: PdfRequest): Promise<T> {
	return pdfJobs(async () => {
		let current = pdfProcess;
		// Stryker disable next-line OptionalChaining: ekvivalentní mutant, založení podprocesu nečeká, takže za 10 s je `current` vždy přiřazený.
		const timer = setTimeout(() => current?.kill(), PDF_TIMEOUT);
		try {
			if (!current) {
				try {
					current = await spawnPdfProcess();
					await nextMessage(current.events);
				} catch (error) {
					current?.kill();
					// Podproces, který se nespustí, je vada appky, ne dokladu.
					throw new Error('Fakturian nedokázal spustit čtení PDF — zkus ho restartovat', { cause: error });
				}
				pdfProcess = current;
				current.events.once('exit', () => {
					pdfProcess = undefined;
				});
			}
			let reply: { result: T } | { error: unknown };
			try {
				current.send(request);
				reply = await nextMessage(current.events);
			} catch (error) {
				throw new Error('PDF nejde rozbalit v rozumném čase ani paměti — takhle doklad nevypadá', {
					cause: error,
				});
			}
			if ('error' in reply) throw reply.error;
			return reply.result;
		} finally {
			clearTimeout(timer);
		}
	});
}

// Načtené PDF jsou jen data: hlavní proces dokument pdf-lib nedrží.
export interface LoadedPdf extends PdfContent {
	bytes: Uint8Array;
}

export async function loadPdf(bytes: Uint8Array): Promise<LoadedPdf> {
	const content = await ask<PdfContent>({
		read: bytes,
		budget: MAX_ISDOC_BYTES,
	});
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
		budget: MAX_ISDOC_BYTES,
	});
	return saved;
}
