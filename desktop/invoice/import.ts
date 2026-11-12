import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { DocumentKind } from '~/constants/invoice';
import { errorText } from '~/utils/errors';
import { invoiceTotalCents } from '~/utils/invoice';

import { alreadyThere, checkSource, isCreditNote, normIco, readSource, type Source } from '../import.ts';
import { fromCents } from '../isdoc/mod.ts';
import { asciiLower } from '../numbering.ts';
import { errorCode, type NewFile, readDocument, writeNew } from '../util.ts';
import { moveFile, overVault } from '../vault.ts';

import { listInvoices, takenNumberKeys } from './index.ts';

import type { Invoice } from './model.ts';
import type { ImportReport } from '~/bindings';

interface CreditTarget {
	totalCents: number;
	creditNote: string | undefined;
}

// Faktury, na které smí mířit dobropis: ve vaultu i ty, které přinesla tatáž dávka. Pravidla jsou
// stejná jako ve formuláři (`creditProblem` v `src/schemas/invoices.ts`).
export type CreditTargets = Map<string, CreditTarget>;

function recordCredit(targets: CreditTargets, original: string, number: string): void {
	const target = targets.get(original);
	if (target) target.creditNote = number;
}

export async function creditTargets(vaultPath: string): Promise<CreditTargets> {
	const { items } = await listInvoices({ vaultPath });
	const targets: CreditTargets = new Map();
	for (const { number, totalCents, documentType } of items) {
		if (documentType === DocumentKind.Invoice) {
			targets.set(number, {
				totalCents,
				creditNote: undefined,
			});
		}
	}
	for (const { number, originalInvoice, documentType } of items) {
		if (documentType === DocumentKind.CreditNote) recordCredit(targets, originalInvoice, number);
	}
	return targets;
}

export function checkCredit(targets: CreditTargets, invoice: Invoice): void {
	if (invoice.documentType !== DocumentKind.CreditNote) return;
	const original = invoice.originalInvoice.trim();
	const target = targets.get(original);
	if (target === undefined) {
		throw new Error(`dobropis opravuje fakturu ${original}, která není ve vaultu ani v tomtéž importu`);
	}
	if (target.creditNote !== undefined) {
		throw new Error(`faktura ${original} už má dobropis ${target.creditNote}; Fakturian vede k faktuře jediný`);
	}
	const cents = invoiceTotalCents(invoice);
	if (cents !== -target.totalCents) {
		throw new Error(
			`dobropis vrací ${fromCents(-cents)} Kč, ale faktura ${original} je na ${fromCents(target.totalCents)} Kč; ` +
				'Fakturian vede jen dobropis na celou fakturu',
		);
	}
}

export function addCredit(targets: CreditTargets, invoice: Invoice): void {
	if (invoice.documentType === DocumentKind.CreditNote) {
		recordCredit(targets, invoice.originalInvoice.trim(), invoice.number);
		return;
	}
	targets.set(invoice.number, {
		totalCents: invoiceTotalCents(invoice),
		creditNote: undefined,
	});
}

// Hotové PDF do `faktury/` bez přepisu: jméno se zabere dřív, než se na ně kopíruje nebo přesouvá,
// takže doklad, který mezitím uložila appka nebo synchronizace, zůstane netknutý.
export async function placePdf(source: string, target: string, move: boolean): Promise<NewFile> {
	if (!move) {
		let content: Uint8Array;
		try {
			content = await readDocument(source);
		} catch (error) {
			throw new Error(`nejde zkopírovat: ${errorText(error)}`, { cause: error });
		}
		return writeNew(target, content);
	}
	try {
		await writeFile(target, new Uint8Array(), { flag: 'wx' });
	} catch (error) {
		if (errorCode(error) === 'EEXIST') return 'taken';
		throw new Error(`nejde přesunout: ${errorText(error)}`, { cause: error });
	}
	try {
		await moveFile(source, target);
	} catch (error) {
		await Promise.allSettled([rm(target)]);
		throw error;
	}
	return 'written';
}

interface Batch {
	dir: string;
	ourIco: string;
	move: boolean;
	// Roste o právě zapsané doklady: snímek pořízený před dávkou o jejím prvním dokladu neví, takže by
	// dva soubory téhož čísla prošly oba.
	numbers: Set<string>;
	credits: CreditTargets;
}

async function importOne(context: Batch, path: string, source: Source, report: ImportReport): Promise<void> {
	checkSource(source, context.ourIco);
	const { invoice } = source;
	const taken = alreadyThere(invoice.number);
	const key = asciiLower(invoice.number);
	if (context.numbers.has(key)) throw new Error(taken);
	checkCredit(context.credits, invoice);
	const placed = await placePdf(path, join(context.dir, `${invoice.number}.pdf`), context.move);
	if (placed === 'taken') throw new Error(taken);
	context.numbers.add(key);
	addCredit(context.credits, invoice);

	report.imported.push({
		number: invoice.number,
		customer: invoice.customer.name,
		issueDate: invoice.issueDate,
		totalCents: invoiceTotalCents(invoice),
	});
	const { name, ico, dic, address, email } = invoice.customer;
	const normalized = normIco(ico);
	const known = report.customers.some((customer) =>
		normalized === '' ? asciiLower(customer.name) === asciiLower(name) : normIco(customer.ico) === normalized,
	);
	if (!known) {
		report.customers.push({
			name,
			ico,
			dic,
			address,
			email,
		});
	}
}

// Společné tělo importu i převzetí složky. Přesun potřebuje jedině převzetí: zdroj leží uvnitř vaultu
// a kopie by tam nechala tentýž doklad dvakrát.
export async function batch(
	vaultPath: string,
	documents: { path: string; file: string }[],
	ourIco: string | null,
	move: boolean,
): Promise<ImportReport> {
	// Kořen musí existovat: zakládat ho při importu by z odpojené složky udělalo druhý vault.
	const root = await overVault(vaultPath);
	const dir = join(root, 'faktury');
	try {
		await mkdir(dir, { recursive: true });
	} catch (error) {
		throw new Error(`Složku faktury/ nejde vytvořit: ${errorText(error)}`, { cause: error });
	}
	const numbers = await takenNumberKeys(dir);
	const credits = await creditTargets(vaultPath);
	const context: Batch = {
		dir,
		// Stryker disable next-line StringLiteral: ekvivalentní mutant, `normIco` z textu bez číslic udělá prázdné IČO.
		ourIco: normIco(ourIco ?? ''),
		move,
		numbers,
		credits,
	};

	// `file` je jméno, pod kterým doklad zná uživatel; `path` může být kanonická cesta k témuž souboru.
	const reads: { path: string; file: string; read: PromiseSettledResult<Source> }[] = [];
	for (const { path, file } of documents) {
		const [read] = await Promise.allSettled([readSource(path)]);
		reads.push({
			path,
			file,
			read,
		});
	}
	// Dobropis se ověřuje proti své faktuře, a tu může přinést až tatáž dávka.
	const creditLast = ({ read }: { read: PromiseSettledResult<Source> }) =>
		Number(read.status === 'fulfilled' && isCreditNote(read.value));

	const report: ImportReport = {
		imported: [],
		skipped: [],
		customers: [],
	};
	for (const { path, file, read } of reads.toSorted((a, b) => creditLast(a) - creditLast(b))) {
		if (read.status === 'rejected') {
			report.skipped.push({
				file,
				reason: errorText(read.reason),
			});
			continue;
		}
		try {
			await importOne(context, path, read.value, report);
		} catch (error) {
			report.skipped.push({
				file,
				reason: errorText(error),
			});
		}
	}
	return report;
}

// `ourIco` z nastavení nepustí mezi vydané faktury přijatý doklad: počítal by se jako vlastní tržba
// a nafoukl obrat pro limit plátcovství.
export function importDocuments({
	vaultPath,
	paths,
	ourIco,
}: {
	vaultPath: string;
	paths: string[];
	ourIco: string | null;
}): Promise<ImportReport> {
	return batch(
		vaultPath,
		paths.map((path) => ({
			path,
			file: basename(path),
		})),
		ourIco,
		false,
	);
}
