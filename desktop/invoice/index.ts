import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { DocumentKind } from '~/constants/invoice';
import { parseIsdocDate } from '~/utils/date';
import { errorText } from '~/utils/errors';
import { invoiceTotalCents } from '~/utils/invoice';
import { z, type Zod } from '~/utils/zod';

import { paymentSymbol } from './payment.ts';

import { checkSource, sourceFromPdf } from '../import.ts';
import { asciiLower, compareNumbers } from '../numbering.ts';
import { loadPdf } from '../pdf.ts';
import { cacheDir } from '../store.ts';
import { compareText, conflictOriginalName, errorCode, icloudOriginalName, writeAtomic } from '../util.ts';
import { overVault } from '../vault.ts';

import type { Invoice } from './model.ts';
import type { Stats } from 'node:fs';
import type { PDFDocument } from 'pdf-lib';
import type { BrokenInvoice } from '~/bindings';

const PDF_NAME = /(.+)\.pdf$/is;

const INDEX_FILE = 'index.json';

// Stejně přísné jako `invoiceSummarySchema` ve frontendu: podvržená cache se postaví znovu, místo aby
// rozbila přehled. Data zůstávají tak, jak je doklad nese.
const summarySchema = z.strictObject({
	number: z.string(),
	customer: z.string(),
	issueDate: z.string().refine((date) => parseIsdocDate(date) !== undefined),
	dueDate: z.string().refine((date) => !date.trim() || parseIsdocDate(date) !== undefined),
	totalCents: z.int(),
	variableSymbol: z.string(),
	documentType: z.enum(DocumentKind),
	originalInvoice: z.string(),
	sentAt: z.string().nullable(),
	usageLines: z.array(
		z.strictObject({
			itemId: z.string(),
			quantity: z.number(),
			usageYear: z.int().min(1000).max(9999).optional(),
		}),
	),
	path: z.string(),
});

export type InvoiceSummary = Zod.infer<typeof summarySchema>;

export interface InvoiceList {
	items: InvoiceSummary[];
	broken: BrokenInvoice[];
}

// Souhrn dokladu platí, dokud se soubor nezmění: razítko je čas změny a velikost.
const indexSchema = z.object({
	entries: z.record(
		z.string(),
		z.object({
			mtime_ms: z.number(),
			size: z.number(),
			summary: summarySchema,
		}),
	),
});

type IndexEntry = Zod.infer<typeof indexSchema>['entries'][string];

interface Candidate {
	name: string;
	path: string;
	// Jméno bez obalu iCloud zástupce a jeho kmen bez přípony.
	available: string;
	stem: string;
	// Jen zástupce dokladu, který iCloud na tenhle Mac nestáhl.
	placeholder: boolean;
	info: Stats;
}

// Konfliktní kopie `20260001 2.pdf` nebo `20260001 (conflicted copy).pdf` patří k dokladu `20260001`.
function conflictStem(fileName: string): string | undefined {
	const original = conflictOriginalName(fileName);
	// Stryker disable next-line ConditionalExpression: ekvivalentní mutant, `exec(undefined)` hledá v textu „undefined“ a příponu .pdf nenajde.
	if (original === undefined) return undefined;
	// Stryker disable next-line OptionalChaining: ekvivalentní mutant, volá se jen se jménem PDF a jeho konfliktní kopie příponu nese taky.
	return PDF_NAME.exec(original)?.[1];
}

// Skutečná PDF i iCloud zástupci. Složka jménem `20260001.pdf` vznikne po rozbalení zálohy nebo po
// konfliktu synchronizace a mezi doklady nepatří.
async function documentCandidates(dir: string): Promise<Candidate[]> {
	let names: string[];
	try {
		names = await readdir(dir);
	} catch (error) {
		// Chybějící `faktury/` je prázdný vault, nečitelná ne: řada by se jinak začala číslovat znovu.
		if (errorCode(error) === 'ENOENT') return [];
		throw new Error(`Složku ${dir} nejde přečíst: ${errorText(error)}`, { cause: error });
	}
	const candidates = await Promise.all(
		names.map(async (name): Promise<Candidate[]> => {
			const original = icloudOriginalName(name);
			const available = original ?? name;
			const stem = PDF_NAME.exec(available)?.[1];
			if (stem === undefined) return [];
			const path = join(dir, name);
			let info: Stats;
			try {
				info = await stat(path);
			} catch {
				return [];
			}
			if (!info.isFile()) return [];
			return [
				{
					name,
					path,
					available,
					stem,
					placeholder: original !== undefined,
					info,
				},
			];
		}),
	);
	return candidates.flat();
}

// Čas odeslání nese ISDOC v PDF, ne model dokladu; doplní ho až `summarizePdf`.
export function summarize(invoice: Invoice, path: string): InvoiceSummary {
	return {
		number: invoice.number,
		customer: invoice.customer.name,
		issueDate: invoice.issueDate,
		dueDate: invoice.dueDate,
		totalCents: invoiceTotalCents(invoice),
		variableSymbol: paymentSymbol(invoice),
		documentType: invoice.documentType,
		originalInvoice: invoice.originalInvoice,
		sentAt: null,
		// Jen řádky s vazbou na ceník: z nich se počítá vykázané množství i roční limit.
		usageLines: invoice.lines
			.filter((line) => line.itemId)
			.map(({ itemId, quantity, usageYear }) => ({
				itemId,
				quantity,
				...(usageYear && { usageYear }),
			})),
		path,
	};
}

// Doklad ve `faktury/` mohl přinést Finder nebo synchronizace, ne import. Přehled proto ukáže jen to,
// co by import vzal; ostatní skončí mezi vadnými i s důvodem.
async function summarizePdf(path: string): Promise<InvoiceSummary> {
	let pdf: PDFDocument;
	try {
		const bytes = await readFile(path);
		pdf = await loadPdf(bytes);
	} catch (error) {
		// Stryker disable next-line ObjectLiteral: ekvivalentní mutant, chyba skončí jen jako text důvodu vadného dokladu.
		throw new Error(`PDF nejde přečíst: ${errorText(error)}`, { cause: error });
	}
	const source = await sourceFromPdf(pdf);
	checkSource(source, '');
	return {
		...summarize(source.invoice, path),
		sentAt: source.sentAt ?? null,
	};
}

// Konfliktní jméno zabere původní i doslovný kmen: `F2026 2` může být skutečné číslo dokladu a z řady
// se nesmí ztratit. Čitelná kopie místo původního kmene zabere číslo, které nese.
async function numberHints(candidate: Candidate): Promise<string[]> {
	const hints = [candidate.stem];
	const original = conflictStem(candidate.available);
	if (original === undefined) return hints;
	if (!candidate.placeholder) {
		try {
			const { number } = await summarizePdf(candidate.path);
			if (number !== candidate.stem) hints.push(number);
			return hints;
		} catch {
			// Nečitelná kopie zabere obě jména, která mohla nést.
		}
	}
	hints.push(original);
	return hints;
}

async function documentStems(dir: string): Promise<string[]> {
	const candidates = await documentCandidates(dir);
	const hints = await Promise.all(candidates.map(numberHints));
	return hints.flat();
}

// Obsazená čísla v podobě z `asciiLower` pro dávky: `findDocument` čte kvůli každému dotazu celou
// složku, což je nad tisícem souborů O(soubory × faktury).
export async function takenNumberKeys(dir: string): Promise<Set<string>> {
	const stems = await documentStems(dir);
	return new Set(stems.map(asciiLower));
}

export async function documentNumberCount(dir: string, number: string): Promise<number> {
	const stems = await documentStems(dir);
	return stems.filter((stem) => asciiLower(stem) === asciiLower(number)).length;
}

// Čtení i zápis se musí shodnout na tom, který soubor je „doklad 20260001“, i když se jmenuje
// `20260001.PDF`.
export async function findDocument(dir: string, number: string): Promise<string | undefined> {
	const candidates = await documentCandidates(dir);
	return candidates.find(({ placeholder, stem }) => !placeholder && asciiLower(stem) === asciiLower(number))?.path;
}

// Smazaný doklad leží v Koši a své číslo uvolnil.
export async function listUsedNumbers({ vaultPath }: { vaultPath: string }): Promise<string[]> {
	const vault = await overVault(vaultPath);
	const stems = await documentStems(join(vault, 'faktury'));
	return [...new Set(stems)].toSorted(compareText);
}

// Cache není zdroj pravdy: kterou nejde přečíst, přehled postaví znovu z dokladů.
async function loadIndex(vault: string): Promise<Map<string, IndexEntry>> {
	let json: unknown;
	try {
		// Stryker disable next-line StringLiteral: ekvivalentní mutant, bez kódování přijde Buffer a `JSON.parse` ho přečte jako UTF-8.
		const text = await readFile(join(cacheDir(vault), INDEX_FILE), 'utf8');
		json = JSON.parse(text);
	} /* Stryker disable next-line BlockStatement: ekvivalentní mutant, `safeParse(undefined)` neprojde a cache je prázdná tak jako tak. */ catch {
		return new Map();
	}
	const index = indexSchema.safeParse(json);
	return new Map(index.success ? Object.entries(index.data.entries) : []);
}

// Zápis cache je best-effort: nesmí zablokovat práci s doklady.
async function saveIndex(vault: string, entries: Map<string, IndexEntry>): Promise<void> {
	const dir = cacheDir(vault);
	await Promise.allSettled([mkdir(dir, { recursive: true })]);
	const json = JSON.stringify({ entries: Object.fromEntries(entries) });
	await Promise.allSettled([writeAtomic(join(dir, INDEX_FILE), new TextEncoder().encode(json))]);
}

export async function removeIndexEntry(vault: string, path: string): Promise<void> {
	const entries = await loadIndex(vault);
	if (entries.delete(basename(path))) await saveIndex(vault, entries);
}

export async function listInvoices({ vaultPath }: { vaultPath: string }): Promise<InvoiceList> {
	const vault = await overVault(vaultPath);
	const old = await loadIndex(vault);
	const fresh = new Map<string, IndexEntry>();
	const parsed: { fileName: string; summary: InvoiceSummary; namedConflict: boolean }[] = [];
	const broken: BrokenInvoice[] = [];
	let changed = false;

	const candidates = await documentCandidates(join(vault, 'faktury'));
	for (const { name, path, stem, placeholder, info } of candidates) {
		if (placeholder) {
			broken.push({
				fileName: name,
				path,
				reason: 'Doklad je na tomto Macu dostupný jen jako iCloud zástupce. Nech ho ve Finderu stáhnout a potom přehled obnov.',
			});
			continue;
		}
		const cached = old.get(name);
		old.delete(name);
		let summary: InvoiceSummary;
		if (cached && cached.mtime_ms === info.mtimeMs && cached.size === info.size) {
			// Cesta z cache by po přesunu vaultu mířila do zaniklé složky.
			summary = {
				...cached.summary,
				path,
			};
		} else {
			changed = true;
			try {
				summary = await summarizePdf(path);
			} catch (error) {
				broken.push({
					fileName: name,
					path,
					reason: errorText(error),
				});
				continue;
			}
		}
		const { number } = summary;
		const namedConflict = conflictStem(name) === number;
		// Soubor by obsadil číslo podle jména, ale přehled by ukazoval jiné — otevřít, odeslat ani smazat
		// by ho nešlo.
		if (!namedConflict && asciiLower(stem) !== asciiLower(number)) {
			broken.push({
				fileName: name,
				path,
				reason: `Jméno souboru neodpovídá číslu dokladu ${number}. Přejmenuj ho na ${number}.pdf.`,
			});
			continue;
		}
		fresh.set(name, {
			mtime_ms: info.mtimeMs,
			size: info.size,
			summary,
		});
		parsed.push({
			fileName: name,
			summary,
			namedConflict,
		});
	}
	// Zbylé záznamy staré cache patří smazaným dokladům.
	if (changed || old.size > 0) await saveIndex(vault, fresh);

	const sameNumber = Map.groupBy(parsed, ({ summary }) => asciiLower(summary.number));
	const items: InvoiceSummary[] = [];
	for (const { fileName, summary, namedConflict } of parsed) {
		const { number, path } = summary;
		// Stryker disable next-line OptionalChaining: ekvivalentní mutant, každé číslo z `parsed` ve skupinách je.
		if (sameNumber.get(asciiLower(number))?.length !== 1) {
			broken.push({
				fileName,
				path,
				reason: `Číslo dokladu ${number} je v několika souborech. Rozhodni konflikt ve Finderu.`,
			});
		} else if (namedConflict) {
			broken.push({
				fileName,
				path,
				reason: `Soubor vypadá jako konfliktní kopie dokladu ${number}. Ve Finderu rozhodni, která verze platí, a přejmenuj ji na ${number}.pdf.`,
			});
		} else {
			items.push(summary);
		}
	}
	return {
		items: items.toSorted((a, b) => compareNumbers(b.number, a.number)),
		broken: broken.toSorted((a, b) => compareText(a.fileName, b.fileName)),
	};
}
