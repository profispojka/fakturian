import { readdir } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

import { DOCUMENT_EXTENSION } from '~/bindings';
import { daysBetween, parseDate } from '~/utils/date';
import { errorText } from '~/utils/errors';
import { invoiceTotalCents } from '~/utils/invoice';

import { alreadyThere, checkSource, isCreditNote, normIco, readSource, type Source } from './import.ts';
import { addCredit, batch, checkCredit, creditTargets } from './invoice/import.ts';
import { takenNumberKeys } from './invoice/index.ts';
import { asciiLower, compareNumbers } from './numbering.ts';
import { compareText } from './util.ts';
import { overVault, requireWithin } from './vault.ts';

import type { Invoice } from './invoice/model.ts';
import type { Dirent } from 'node:fs';
import type { AdoptCandidate, AdoptedSupplier, AdoptScan, ImportReport, SkippedFile } from '~/bindings';

// Vlastní složky vaultu; `.fakturian/` vynechá už tečka na začátku jména.
const OWN = new Set(['faktury', 'prijate']);

// Kolik souborů má smysl otevřít: každý kandidát znamená rozparsovat PDF, takže složka jako celé
// Dokumenty by výběr na minuty zamrzla.
const FILE_LIMIT = 1000;

const DEPTH_LIMIT = 6;

const DOCUMENT = new RegExp(`\\.${DOCUMENT_EXTENSION}$`, 'i');

// Nejvýš 9 míst pořadí; musí sedět s `validateTemplate` v `src/utils/numbering.ts`.
const SEQUENCE = /^\d{1,9}$/;

export interface FoundFiles {
	files: string[];
	skipped: SkippedFile[];
	truncated: boolean;
}

// Kořen se ověřuje zvlášť: nečitelná podsložka skončí v přeskočených, ale nepřipojený disk musí sken
// zastavit, ne vrátit „nic k převzetí“.
export async function findFiles(root: string, limit: number): Promise<FoundFiles> {
	try {
		await readdir(root);
	} catch (error) {
		throw new Error(`Složku ${root} nejde přečíst: ${errorText(error)}`, { cause: error });
	}
	const found: FoundFiles = {
		files: [],
		skipped: [],
		truncated: false,
	};
	// Do hloubky po jménech, takže výběr při dosaženém limitu je pokaždé stejný. Odkaz se neprochází ani
	// nenabízí: `x → ..` by limit zaplnil kopiemi a odkaz ven převzetí stejně odmítne.
	async function walk(dir: string, depth: number): Promise<void> {
		let entries: Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch (error) {
			found.skipped.push({
				file: relative(root, dir),
				reason: `nejde přečíst: ${errorText(error)}`,
			});
			return;
		}
		for (const entry of entries.toSorted((a, b) => compareText(a.name, b.name))) {
			const { name } = entry;
			if ((depth === 0 && OWN.has(name)) || name.startsWith('.') || entry.isSymbolicLink()) continue;
			const path = join(dir, name);
			if (entry.isDirectory()) {
				if (depth < DEPTH_LIMIT) await walk(path, depth + 1);
				if (found.truncated) return;
				continue;
			}
			// Smlouvy, fotky a videa se neotevírají vůbec: v přeskočených by byly jen šum.
			if (!DOCUMENT.test(name)) continue;
			if (found.files.length >= limit) {
				found.truncated = true;
				return;
			}
			found.files.push(path);
		}
	}
	await walk(root, 0);
	return found;
}

// Které IČO je v téhle složce „naše“. Zadané z nastavení má přednost; bez něj rozhoduje většina — ve
// složce s vlastní fakturací je dodavatelem na každém dokladu uživatel.
export function deriveOurIco(documents: Invoice[], given: string): string {
	if (given !== '') return given;
	const icos = documents.map((invoice) => normIco(invoice.supplier.ico)).filter((ico) => ico !== '');
	const counts = [...Map.groupBy(icos, (ico) => ico)];
	const [winner] = counts.toSorted(([a, x], [b, y]) => y.length - x.length || compareText(a, b));
	return winner?.[0] ?? '';
}

// Šablona řady z čísla dokladu a roku vystavení. Bez ní by řada z jiného softwaru změnila uprostřed
// roku tvar: po `2026022` by výchozí `{RRRR}{NNNN}` vystavilo `20260023`. Vlastní prefix se neodvozuje.
export function deriveTemplate(number: string, issueDate: string): string | undefined {
	const year = issueDate.slice(0, 4);
	if (year.length < 4 || !number.startsWith(year)) return undefined;
	const sequence = number.slice(year.length);
	return SEQUENCE.test(sequence) ? `{RRRR}{${'N'.repeat(sequence.length)}}` : undefined;
}

// Nesmyslné rozpětí se nenabízí: cizí doklad může mít cokoli a „−3 dny“ by se pak nabízely u každé
// nové faktury.
export function deriveDueDays(issueDate: string, dueDate: string): number | null {
	const from = parseDate(issueDate);
	const to = parseDate(dueDate);
	if (from === undefined || to === undefined) return null;
	const days = daysBetween(from, to);
	return days >= 0 && days <= 365 ? days : null;
}

export function deriveSupplier(documents: Invoice[]): AdoptedSupplier | null {
	const newest = documents
		.toSorted((a, b) => compareText(a.issueDate, b.issueDate) || compareNumbers(a.number, b.number))
		.at(-1);
	if (newest === undefined) return null;
	const { name, ico, address, email, registration } = newest.supplier;
	return {
		name,
		ico,
		address,
		email,
		registration,
		bankAccount: newest.bankAccount,
		bankCode: newest.bankCode,
		iban: newest.iban,
		invoiceNumberFormat: deriveTemplate(newest.number, newest.issueDate) ?? '',
		defaultDueDays: deriveDueDays(newest.issueDate, newest.dueDate),
	};
}

// Nic nepřesouvá: nabídne doklady, které by převzetí doopravdy vzalo.
export async function scanVault({
	vaultPath,
	ourIco,
}: {
	vaultPath: string;
	ourIco: string | null;
}): Promise<AdoptScan> {
	const root = await overVault(vaultPath);
	const { files, skipped, truncated } = await findFiles(root, FILE_LIMIT);

	const loaded: { path: string; source: Source }[] = [];
	for (const path of files) {
		const [read] = await Promise.allSettled([readSource(path)]);
		// Ve složce s fakturami leží i smlouvy a účtenky. Říct se to musí, jinak vypadá chybějící doklad
		// jako ztracený.
		if (read.status === 'rejected') {
			skipped.push({
				file: relative(root, path),
				reason: errorText(read.reason),
			});
			continue;
		}
		loaded.push({
			path,
			source: read.value,
		});
	}

	const eligible = loaded
		.filter(({ source }) => {
			try {
				checkSource(source, '');
			} catch {
				return false;
			}
			return true;
		})
		.map(({ source }) => source.invoice);
	// Stryker disable next-line StringLiteral: ekvivalentní mutant, `normIco` z textu bez číslic udělá prázdné IČO.
	const ours = deriveOurIco(eligible, normIco(ourIco ?? ''));
	const inVault = await takenNumberKeys(join(root, 'faktury'));
	const credits = await creditTargets(vaultPath);

	const own: Invoice[] = [];
	const candidates: AdoptCandidate[] = [];
	for (const { path, source } of loaded.toSorted(
		(a, b) => Number(isCreditNote(a.source)) - Number(isCreditNote(b.source)),
	)) {
		const { invoice } = source;
		try {
			if (inVault.has(asciiLower(invoice.number))) throw new Error(alreadyThere(invoice.number));
			checkSource(source, ours);
			checkCredit(credits, invoice);
		} catch (error) {
			skipped.push({
				file: relative(root, path),
				reason: errorText(error),
			});
			continue;
		}
		addCredit(credits, invoice);
		own.push(invoice);
		candidates.push({
			path,
			file: relative(root, path),
			number: invoice.number,
			customer: invoice.customer.name,
			issueDate: invoice.issueDate,
			totalCents: invoiceTotalCents(invoice),
		});
	}

	return {
		candidates: candidates.toSorted((a, b) => compareNumbers(b.number, a.number)),
		skipped,
		supplier: deriveSupplier(own),
		truncated,
	};
}

// Převzít jde jen soubor z datové složky: jinak by `..` nebo odkaz ven přestěhoval cizí soubor.
export async function adoptDocuments({
	vaultPath,
	paths,
	ourIco,
}: {
	vaultPath: string;
	paths: string[];
	ourIco: string | null;
}): Promise<ImportReport> {
	// Přesouvá se ověřená kanonická cesta, jinak by mezitím vyměněný symlink odklonil přesun ven.
	const documents: { path: string; file: string }[] = [];
	for (const path of paths) {
		const verified = await requireWithin(vaultPath, path);
		documents.push({
			path: verified,
			file: basename(path),
		});
	}
	const report = await batch(vaultPath, documents, ourIco, true);
	return report;
}
