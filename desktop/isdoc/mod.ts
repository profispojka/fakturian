import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import {
	DOMParser,
	Element,
	onWarningStopParsing,
	ProcessingInstruction,
	Text,
	XMLSerializer,
	type Document,
	type Node,
} from '@xmldom/xmldom';
import BigDecimal from 'big.js';
import pLimit from 'p-limit';

import { MAX_CENTS } from '~/bindings';

import SCHEMA from './isdoc-invoice-6.0.2.xsd';

export const ISDOC_NAMESPACE = 'http://isdoc.cz/namespace/2013';

// Podle `IssuingSystem` se pozná cizí archivovaný doklad, který se nesmí přepsat naší šablonou.
export const ISSUING_SYSTEM = 'Fakturian';

const EXTENSION_NAMESPACE = 'https://fakturian.app/isdoc/extensions/1';
const EXTENSION_PREFIX = 'fakturian';
const SENT_AT = 'SentAt';
const SENT_BY = 'SentBy';
export const USAGE_YEAR = 'UsageYear';

export const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';

export const MAX_ISDOC_BYTES = 32 * 1024 * 1024;
const MIB = 1024 * 1024;

// Skutečný ISDOC má do deseti úrovní; strop nechává místo cizím `<Extensions>`.
const MAX_ISDOC_DEPTH = 128;

// Pod jménem `invoice.isdoc` dostane doklad libxml2 ve `validator.ts`; z hlášky se odřízne i s řádkem.
// Stryker disable next-line Regex: ekvivalentní mutant, první řádek hlášky libxml2 začíná jménem souboru vždy.
const LIBXML_PLACE = /^invoice\.isdoc:(\d+): [^:]*?(?:error|warning) ?: /;

// Hláška libxml2 o schématu jmenuje prvek; anglický zbytek věty se uživateli neukazuje.
const LIBXML_ELEMENT = /Element '(.+?)': [\s\S]*/;
// Co prvek nejmenuje, je vada zápisu XML.
const LIBXML_SYNTAX = /(řádek \d+: )[\s\S]*/;

// Ze zdrojů běží `validator.ts` vedle tohoto modulu, z bundlu `validator.mjs` vedle `main.mjs`, se kterým
// sdílí `import.meta.url`.
const VALIDATOR = new URL(`./validator${extname(fileURLToPath(import.meta.url))}`, import.meta.url);
// Kontrola dokladu trvá milisekundy; strop jen brání tomu, aby zaseknutý worker zablokoval appku.
const VALIDATION_TIMEOUT = 30_000;

const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

// Znak mimo `Char` z XML 1.0, i osamělá polovina páru UTF-16, by z dokladu udělal nečitelný soubor.
const NOT_XML_CHAR = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

// Značky, jejichž obsah do hloubky nepatří; průchod je přeskočí až za jejich konec.
const SKIPPED = [
	['<!--', '-->'],
	['<![CDATA[', ']]>'],
	['<?', '?>'],
	['<!', '>'],
] as const;
// Začátek nebo konec prvku (skupina nese `/` konce); hodnoty atributů smí obsahovat `>`.
const TAG = /<(\/?)[^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/y;

// RFC 3339 s velkým `T` a `Z`, jak ho píše appka a jak ho přečte `parseAbsolute` ve frontendu.
const RFC3339 = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

// xmldom sjednocuje konce řádků podle XML 1.1, kde je koncem řádku i U+2028; ISDOC je XML 1.0 a tam
// jsou to data.
const PARSER = new DOMParser({
	onError: onWarningStopParsing,
	normalizeLineEndings: (source) => source.replace(/\r\n?/g, '\n'),
});
const SERIALIZER = new XMLSerializer();

interface Validation {
	code: number;
	stderr: string;
}

// Jeden worker na proces, založený až první kontrolou: modul xmllint se v něm přeloží jednou.
let validator: Worker | undefined;
// Kontroly jdou po jedné, takže odpověď workeru patří vždy té, která zrovna čeká.
const validations = pLimit(1);

// Hloubka se měří plochým průchodem dřív, než doklad dostane libxml2. Syntaktickou chybu, na které
// průchod skončí, nahlásí validace i s řádkem.
function checkDepth(xml: string): void {
	let depth = 0;
	let at = xml.indexOf('<');
	// Každý krok posune `at` dál nebo průchod ukončí, takže je lineární i na neukončeném komentáři.
	// Stryker disable next-line BlockStatement,UnaryOperator: mutant smyčku zacyklí, skončí jen timeoutem.
	while (at !== -1) {
		const start = at;
		const skipped = SKIPPED.find(([open]) => xml.startsWith(open, start));
		if (skipped) {
			const [open, close] = skipped;
			// Stryker disable next-line ArithmeticOperator: mutant smyčku zacyklí, skončí jen timeoutem.
			const end = xml.indexOf(close, start + open.length);
			// Stryker disable next-line ConditionalExpression,UnaryOperator: mutant smyčku zacyklí, skončí jen timeoutem.
			if (end === -1) return;
			at = xml.indexOf('<', end + close.length);
			continue;
		}
		TAG.lastIndex = at;
		const match = TAG.exec(xml);
		if (!match) return;
		const [markup, closing] = match;
		if (closing === '/') depth = Math.max(depth - 1, 0);
		else if (!markup.endsWith('/>')) depth += 1;
		// Stryker disable next-line BlockStatement: hluboký doklad pak dostane libxml2 a test skončí jen timeoutem.
		if (depth > MAX_ISDOC_DEPTH) {
			throw new Error(`ISDOC je vnořený hlouběji než ${MAX_ISDOC_DEPTH} úrovní — takhle doklad nevypadá.`);
		}
		at = xml.indexOf('<', TAG.lastIndex);
	}
}

function startValidator(): Worker {
	// XSD dostane worker od nás: ze zdrojů ho Node jako text nenačte, v bundlu vedle workeru neleží.
	const worker = new Worker(VALIDATOR, { workerData: SCHEMA });
	// Proces naživu drží čekající kontrola se svým časovačem, ne worker.
	// Stryker disable next-line CallExpression: ekvivalentní mutant, proces drží naživu čekající kontrola, test pozdější konec procesu nevidí.
	worker.unref();
	// Stryker disable next-line BlockStatement,StringLiteral: další kontrola by čekala na mrtvý worker celý limit.
	worker.once('exit', () => {
		validator = undefined;
	});
	validator = worker;
	return worker;
}

// Spadlý nebo zaseknutý worker je chyba téhle kontroly; další kontrola založí nový.
async function ask(xml: string): Promise<Validation> {
	const worker = validator ?? startValidator();
	const answer = Promise.withResolvers<Validation>();
	const stopped = () => answer.reject(new Error('kontrola proti XSD nedoběhla'));
	const timer = setTimeout(() => void worker.terminate(), VALIDATION_TIMEOUT);
	worker.once('message', answer.resolve);
	worker.once('error', answer.reject);
	worker.once('exit', stopped);
	try {
		// Prázdný seznam přenášených bufferů: bez něj lint plete `postMessage` s tím z `window`.
		worker.postMessage(xml, []);
		const result = await answer.promise;
		return result;
	} finally {
		clearTimeout(timer);
		// Stryker disable next-line StringLiteral,CallExpression: ekvivalentní mutant, posluchač `once` po odpovědi zmizí sám a bez odpovědi worker skončil.
		worker.off('message', answer.resolve);
		worker.off('error', answer.reject);
		worker.off('exit', stopped);
	}
}

// První hláška libxml2 s řádkem, česky; jmenný prostor ISDOC by u každého prvku jen překážel čtení.
function xmllintReason(output: string): string {
	const line = output.replace(LIBXML_PLACE, 'řádek $1: ').replaceAll(`{${ISDOC_NAMESPACE}}`, '');
	if (LIBXML_ELEMENT.test(line)) return line.replace(LIBXML_ELEMENT, 'prvek $1 neodpovídá standardu ISDOC');
	return line.replace(LIBXML_SYNTAX, '$1soubor není čitelné XML');
}

// Doklad musí projít celým XSD, ne jen kontrolou tvaru XML: projekce pak věří povinným prvkům,
// číselníkům i zápisu částek a dat.
export async function parse(xml: string): Promise<Document> {
	const size = new TextEncoder().encode(xml).byteLength;
	if (size > MAX_ISDOC_BYTES) {
		throw new Error(`ISDOC je nepřiměřeně velký (${Math.floor(size / MIB)} MB) — takhle doklad nevypadá.`);
	}
	checkDepth(xml);
	let validation: Validation;
	try {
		validation = await validations(() => ask(xml));
	} catch (error) {
		throw new Error('ISDOC nejde přečíst: kontrola dokladu nedoběhla', { cause: error });
	}
	// Nenulový kód je vadný doklad, i když libxml2 vyčerpá paměť: stderr říká proč.
	if (validation.code !== 0) throw new Error(`ISDOC nejde přečíst: ${xmllintReason(validation.stderr)}`);
	try {
		return PARSER.parseFromString(xml, 'text/xml');
	} catch (error) {
		// Entitu z vnitřní DTD libxml2 rozvine, xmldom ji nezná: po přeuložení by se text změnil.
		throw new Error('ISDOC nejde přečíst: doklad používá vlastní entity, které appka neumí zachovat', {
			cause: error,
		});
	}
}

// Deklarace je vždy vlastní: text dokladu je UTF-8, ať původní hlavička tvrdí cokoli.
export function toXml(document: Document): string {
	const nodes = Array.from(document.childNodes).filter(
		(node) => !(node instanceof Text) && !(node instanceof ProcessingInstruction && node.target === 'xml'),
	);
	const body = nodes.map((node) => SERIALIZER.serializeToString(node)).join('\n');
	return `${DECLARATION}\n${body.replace(NOT_XML_CHAR, '')}\n`;
}

export function children(parent: Element | null | undefined, name: string): Element[] {
	if (!parent) return [];
	return Array.from(parent.childNodes).filter(
		(node): node is Element =>
			node instanceof Element && node.namespaceURI === ISDOC_NAMESPACE && node.localName === name,
	);
}

export function child(parent: Element | null | undefined, name: string): Element | undefined {
	return children(parent, name)[0];
}

export function text(parent: Element | null | undefined, name: string): string {
	return child(parent, name)?.textContent ?? '';
}

// `Extensions` stojí v hlavičce těsně před povinným dodavatelem.
function headerExtensions(document: Document): Element {
	const root = document.documentElement;
	if (!root) throw new Error('Dokument ISDOC nemá kořenový prvek.');
	const existing = child(root, 'Extensions');
	if (existing) return existing;
	const created = document.createElementNS(ISDOC_NAMESPACE, 'Extensions');
	const [supplier = null] = children(root, 'AccountingSupplierParty');
	root.insertBefore(created, supplier);
	return created;
}

function isFakturianElement(node: Node, name: string): node is Element {
	return node instanceof Element && node.namespaceURI === EXTENSION_NAMESPACE && node.localName === name;
}

// Text a CDATA se skládají, komentář se přeskočí; vnořený prvek hodnotou není.
function elementText(element: Element): string {
	let value = '';
	for (const node of Array.from(element.childNodes)) {
		if (node instanceof Element) throw new Error('Údaj Fakturianu v ISDOC nemá textovou hodnotu.');
		if (node instanceof Text) value += node.data;
	}
	return value.trim();
}

// Druhý výskyt je poškozený doklad: vybrat si z nich jeden by schovalo rozpor, kvůli kterému by se
// doklad otevřel k editaci.
function singleValue(extensions: Element | undefined, name: string, duplicate: string): string | undefined {
	if (!extensions) return undefined;
	const [element, second] = Array.from(extensions.childNodes).filter((node) => isFakturianElement(node, name));
	if (second) throw new Error(duplicate);
	return element === undefined ? undefined : elementText(element);
}

// `Date.parse` přetočí 30. února na březen, takže platnost data a času prozradí až zpětný zápis.
function instantProblem(value: string): string | undefined {
	// Stryker disable next-line ArrayDeclaration: ekvivalentní mutant, bez shody je druhá položka `undefined` tak jako tak.
	const [, local] = RFC3339.exec(value) ?? [];
	if (local === undefined) return `„${value}“ není čas ve tvaru RFC 3339`;
	const parsed = Date.parse(`${local}Z`);
	if (Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 19) !== local) {
		return `„${value}“ není platný čas`;
	}
	return undefined;
}

// Víc hodnot nebo neplatný čas znamenají poškozený doklad — příznak se nesmí tiše skrýt a doklad
// otevřít k editaci.
export function sentAt(document: Document): string | undefined {
	const value = singleValue(
		child(document.documentElement, 'Extensions'),
		SENT_AT,
		'ISDOC obsahuje více údajů Fakturianu o odeslání.',
	);
	if (value === undefined) return undefined;
	const problem = instantProblem(value);
	if (problem !== undefined) throw new Error(`ISDOC obsahuje neplatný čas odeslání: ${problem}`);
	return value;
}

export function extensionElement(document: Document, name: string, value: string): Element {
	const element = document.createElementNS(EXTENSION_NAMESPACE, `${EXTENSION_PREFIX}:${name}`);
	element.setAttributeNS(XMLNS_NAMESPACE, `xmlns:${EXTENSION_PREFIX}`, EXTENSION_NAMESPACE);
	// Čtečka ISDOC v cizím prvku entitu `&amp;` zahodí, takže `Petr & syn` by po načtení vyšel jako
	// `Petr  syn`. CDATA přečte celé.
	const cdata = /[&<]/.test(value) && !value.includes(']]>');
	element.appendChild(cdata ? document.createCDATASection(value) : document.createTextNode(value));
	return element;
}

// Čas dostává volající, aby šlo chování testovat bez systémových hodin.
export function setSent(document: Document, at: string, by: string): void {
	const problem = instantProblem(at);
	if (problem !== undefined) throw new Error(`Čas odeslání nejde zapsat: ${problem}`);
	if (sentAt(document) !== undefined) return;
	const extensions = headerExtensions(document);
	extensions.appendChild(extensionElement(document, SENT_AT, at));
	extensions.appendChild(extensionElement(document, SENT_BY, by));
}

// Údaje o odeslání se přenesou tak, jak v dokladu leží: přepis by z nich dělal nový záznam o odeslání.
export function copySent(from: Document, to: Document): void {
	const source = child(from.documentElement, 'Extensions');
	if (!source) return;
	const carried = Array.from(source.childNodes).filter(
		(node) => isFakturianElement(node, SENT_AT) || isFakturianElement(node, SENT_BY),
	);
	if (carried.length === 0) return;
	const extensions = headerExtensions(to);
	for (const node of carried) extensions.appendChild(to.importNode(node, true));
}

// Rozsah zrcadlí `usageYear` ve formuláři: rok mimo něj je poškozený doklad, ne hodnota k zahození.
export function lineUsageYear(line: Element): number | undefined {
	const id = text(line, 'ID');
	const value = singleValue(
		child(line, 'Extensions'),
		USAGE_YEAR,
		`řádek ${id}: ISDOC obsahuje více roků čerpání limitu.`,
	);
	if (value === undefined) return undefined;
	const year = Number(value);
	if (!/^\+?\d+$/.test(value) || year < 1000 || year > 9999) {
		throw new Error(`řádek ${id}: neplatný rok čerpání limitu „${value}“.`);
	}
	return year;
}

// Peníze do ISDOC v účetním tvaru: `1200.00`, `-50.00`.
export function fromCents(cents: number): string {
	const sign = cents < 0 ? '-' : '';
	const whole = Math.abs(cents);
	return `${sign}${Math.trunc(whole / 100)}.${String(whole % 100).padStart(2, '0')}`;
}

// Hodnota `xs:decimal` z dokladu, který prošel XSD; `big.js` jen nebere znaménko `+`.
export function decimal(value: string): BigDecimal {
	// Stryker disable next-line Regex: ekvivalentní mutant, `xs:decimal` pustí `+` jen na začátek.
	return new BigDecimal(value.trim().replace(/^\+/, ''));
}

// Zaokrouhlení půlkou od nuly. Částka nad strop se odmítne, oříznutá by v evidenci vypadala jako
// skutečná.
export function amountCents(amount: BigDecimal): number | undefined {
	const cents = amount.times(100).round(0, BigDecimal.roundHalfUp);
	if (cents.abs().gt(MAX_CENTS)) return undefined;
	return cents.toNumber();
}

export function toCents(value: string): number {
	const cents = amountCents(decimal(value));
	if (cents === undefined) throw new Error(`částka „${value.trim()}“ přesahuje strop 90 miliard Kč`);
	return cents;
}
