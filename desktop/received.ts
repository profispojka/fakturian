import { lstat, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import { DocumentKind } from '~/constants/invoice';
import { parseIsdocDate } from '~/utils/date';
import { errorText } from '~/utils/errors';

import { child, text, toCents } from './isdoc/mod.ts';
import { intoInvoice } from './isdoc/projection.ts';
import { type EmbeddedIsdoc, loadPdf, readIsdoc } from './pdf.ts';
import { compareText, errorCode, readDocument, writeAtomic } from './util.ts';
import { overVault } from './vault.ts';

import type { Invoice } from './invoice/model.ts';
import type { Stats } from 'node:fs';
import type { PDFDocument } from 'pdf-lib';
import type { BrokenReceived, ReceivedDocument } from '~/bindings';

// Acrobat toleruje před hlavičkou `%PDF-` až 1 024 bajtů smetí a některé skenery ho tam opravdu
// nechávají.
const PDF_HEADER_WINDOW = 1024;

const PDF_HEADER = Buffer.from('%PDF-');

// Prostý název souboru, ne cesta. Oddělovač se neořezává, ale odmítá: `../doklad.pdf` by po oříznutí
// z vaultu sice neutekl, ale smazal by jiný soubor, než na který uživatel ukázal.
function safeFileName(name: string): string {
	const base = name.trim();
	if (base === '' || base.startsWith('.') || /[/\\]/.test(base)) {
		throw new Error(`Nepoužitelný název souboru: ${name}`);
	}
	return base;
}

// Pod očištěným jménem: na macOS je `\` v názvu legální, ale `safeFileName` ho odmítá, takže by takový
// doklad nešlo z vaultu odstranit ani otevřít.
function sourceFileName(source: string): string {
	const cleaned = basename(source).trim().replace(/[\\:]/g, '-').replace(/^\.+/, '').trim();
	if (cleaned === '') throw new Error(`Nepoužitelný název souboru: ${source}`);
	return safeFileName(cleaned);
}

// Doklady subdodavatelů se běžně jmenují `faktura.pdf`. Jméno se zabírá atomicky: mezi dotazem
// „existuje?“ a kopií by soubor mohl založit souběžný import nebo synchronizace.
async function createFreeTarget(dir: string, name: string): Promise<string> {
	const extension = extname(name);
	const stem = name.slice(0, -extension.length);
	// Stryker disable next-line BlockStatement: mutant smyčku zacyklí, skončí jen timeoutem.
	for (let attempt = 1; ; attempt += 1) {
		// Stryker disable next-line ConditionalExpression,StringLiteral: mutant smyčku zacyklí, skončí jen timeoutem.
		const target = join(dir, attempt === 1 ? name : `${stem}-${attempt}${extension}`);
		// Stryker disable next-line BlockStatement: mutant smyčku zacyklí, skončí jen timeoutem.
		try {
			await writeFile(target, new Uint8Array(), { flag: 'wx' });
			return target;
		} /* Stryker disable next-line BlockStatement: mutant smyčku zacyklí, skončí jen timeoutem. */ catch (error) {
			// Stryker disable next-line ConditionalExpression,BlockStatement: mutant smyčku zacyklí, skončí jen timeoutem.
			if (errorCode(error) !== 'EEXIST') {
				throw new Error(`Doklad nejde zkopírovat: ${errorText(error)}`, { cause: error });
			}
		}
	}
}

async function readPdf(source: string, name: string): Promise<Uint8Array> {
	if (!/\.pdf$/i.test(name)) throw new Error(`Přijatý doklad musí být PDF: ${name}`);
	let content: Uint8Array;
	try {
		content = await readDocument(source);
	} catch (error) {
		throw new Error(`Doklad nejde přečíst: ${errorText(error)}`, { cause: error });
	}
	if (!Buffer.from(content.subarray(0, PDF_HEADER_WINDOW)).includes(PDF_HEADER)) {
		throw new Error(`${name} není PDF, má jen jeho příponu.`);
	}
	return content;
}

async function readReceived(content: Uint8Array, name: string): Promise<Omit<ReceivedDocument, 'file'>> {
	let pdf: PDFDocument;
	try {
		pdf = await loadPdf(content);
	} catch (error) {
		throw new Error(`${name} je poškozené PDF: ${errorText(error)}.`, { cause: error });
	}
	let isdoc: EmbeddedIsdoc;
	try {
		isdoc = await readIsdoc(pdf);
	} catch (error) {
		throw new Error(
			`${name}: ${errorText(error)} — Fakturian přijímá jen doklady s ISDOC, ze kterých přečte údaje i částku.`,
			{ cause: error },
		);
	}
	let invoice: Invoice;
	try {
		invoice = intoInvoice(isdoc.document);
	} catch (error) {
		throw new Error(`${name}: vložený ISDOC nejde přečíst (${errorText(error)}).`, { cause: error });
	}
	// Výdaj se počítá do měsíce svého data a pozná se podle dodavatele s číslem dokladu, takže bez nich
	// do evidence nesmí.
	if (parseIsdocDate(invoice.issueDate) === undefined) {
		throw new Error(`${name}: doklad nemá platné datum vystavení „${invoice.issueDate}“.`);
	}
	if (!invoice.supplier.name) throw new Error(`${name}: doklad neuvádí dodavatele.`);
	if (!invoice.number) throw new Error(`${name}: doklad neuvádí své číslo.`);
	// Výdaj je celá částka dokladu včetně daně. `PayableAmount` je po odečtení záloh, takže konečná
	// faktura by se zapsala jen s doplatkem; součet řádků je u plátce DPH jen základ daně.
	let amountCents: number;
	try {
		amountCents = toCents(text(child(isdoc.document.documentElement, 'LegalMonetaryTotal'), 'TaxInclusiveAmount'));
	} catch (error) {
		throw new Error(`${name}: částka s daní v <TaxInclusiveAmount>: ${errorText(error)}.`, { cause: error });
	}
	const kind = invoice.documentType === DocumentKind.CreditNote ? 'Dobropis' : 'Faktura';
	return {
		supplier: invoice.supplier.name,
		supplierIco: invoice.supplier.ico,
		number: invoice.number,
		uuid: invoice.uuid,
		description: `${kind} ${invoice.number}`,
		amountCents,
		date: invoice.issueDate,
		recipientIco: invoice.customer.ico,
	};
}

// Tentýž soubor přetažený podruhé: výdaj z druhé kopie by stál na dokladu, který evidence už má.
// Nečitelný soubor obsah nesdílí.
async function identicalFile(dir: string, content: Uint8Array): Promise<string | undefined> {
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch (error) {
		throw new Error(`Složku prijate/ nejde přečíst: ${errorText(error)}`, { cause: error });
	}
	for (const name of entries) {
		const path = join(dir, name);
		const [info] = await Promise.allSettled([stat(path)]);
		// Stryker disable next-line ConditionalExpression: ekvivalentní mutant, podmínka jen šetří čtení; jiný soubor vyřadí i porovnání obsahu.
		if (info.status === 'rejected' || !info.value.isFile() || info.value.size !== content.byteLength) continue;
		const [existing] = await Promise.allSettled([readFile(path)]);
		if (existing.status === 'fulfilled' && existing.value.equals(content)) return name;
	}
	return undefined;
}

// Doklad, ze kterého nejde přečíst ISDOC s částkou, se do `prijate/` vůbec nezkopíruje.
export async function importReceived({
	vaultPath,
	sourcePath,
}: {
	vaultPath: string;
	sourcePath: string;
}): Promise<ReceivedDocument> {
	const root = await overVault(vaultPath);
	const dir = join(root, 'prijate');
	const name = sourceFileName(sourcePath);
	const content = await readPdf(sourcePath, name);
	const document = await readReceived(content, name);
	try {
		await mkdir(dir, { recursive: true });
	} catch (error) {
		throw new Error(`Složku prijate/ nejde vytvořit: ${errorText(error)}`, { cause: error });
	}
	const existing = await identicalFile(dir, content);
	if (existing !== undefined) {
		throw new Error(`${name} už v prijate/ leží jako ${existing} — tentýž soubor podruhé.`);
	}
	// Hotová kopie se přejmenuje přes prázdnou rezervaci, takže useknutý doklad v `prijate/` nevznikne.
	// Po selhání se maže jen rezervace, kterou tenhle import sám založil.
	const target = await createFreeTarget(dir, name);
	try {
		await writeAtomic(target, content);
	} catch (error) {
		await Promise.allSettled([rm(target)]);
		throw new Error(`Doklad nejde zkopírovat: ${errorText(error)}`, { cause: error });
	}
	return {
		...document,
		file: basename(target),
	};
}

// Soubory v `prijate/`, se kterými appka nepracuje — třeba nakopírované mimo ni.
export async function listBrokenReceived({ vaultPath }: { vaultPath: string }): Promise<BrokenReceived[]> {
	const root = await overVault(vaultPath);
	const dir = join(root, 'prijate');
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return [];
		throw new Error(`Složku prijate/ nejde přečíst: ${errorText(error)}`, { cause: error });
	}
	const broken: BrokenReceived[] = [];
	for (const name of entries) {
		if (name.startsWith('.')) continue;
		const path = join(dir, name);
		const [info] = await Promise.allSettled([stat(path)]);
		if (info.status === 'rejected' || !info.value.isFile()) continue;
		try {
			const content = await readPdf(path, name);
			await readReceived(content, name);
		} catch (error) {
			broken.push({
				file: name,
				reason: errorText(error),
			});
		}
	}
	return broken.toSorted((a, b) => compareText(a.file, b.file));
}

// Volá se, když se import odmítne kvůli příjemci — cizí doklad nemá ve vaultu co dělat.
export async function removeReceived({ vaultPath, file }: { vaultPath: string; file: string }): Promise<null> {
	const name = safeFileName(file);
	const root = await overVault(vaultPath);
	const path = join(root, 'prijate', name);
	let info: Stats;
	try {
		info = await lstat(path);
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return null;
		throw new Error(`Doklad nejde smazat: ${errorText(error)}`, { cause: error });
	}
	if (info.isDirectory()) throw new Error(`Doklad nejde smazat: ${name} je složka, ne soubor.`);
	try {
		await rm(path);
	} catch (error) {
		throw new Error(`Doklad nejde smazat: ${errorText(error)}`, { cause: error });
	}
	return null;
}

export async function receivedPath({ vaultPath, file }: { vaultPath: string; file: string }): Promise<string> {
	const name = safeFileName(file);
	const root = await overVault(vaultPath);
	return join(root, 'prijate', name);
}
