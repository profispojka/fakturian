import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { VAT_LIMIT_CENTS } from '~/constants/dashboard';
import { DocumentKind } from '~/constants/invoice';
import { invoiceSchema } from '~/schemas/invoices';
import { isdocYear, yearOf } from '~/utils/date';
import { creditNotesOf, invoiceTotalCents } from '~/utils/invoice';
import { czechList } from '~/utils/locales';
import { validateNumber } from '~/utils/numbering';

import { buildIsdoc, invoiceUuid } from './isdoc.ts';
import { invoiceArgument, type Invoice } from './model.ts';
import { buildSpayd, qrPng } from './payment.ts';
import { invoiceData, invoiceTypst } from './template.ts';

import { copySent, ISSUING_SYSTEM, parse, sentAt, text, toXml } from '../isdoc/mod.ts';
import { intoInvoice } from '../isdoc/projection.ts';
import { ISDOC_ATTACHMENT, loadPdf, readIsdoc, renderTypstPdf, type LoadedPdf, type TypstFiles } from '../pdf.ts';
import { saveSnapshot, snapshotDir } from '../store.ts';
import { readDocument, writeAtomic, writeNew } from '../util.ts';
import { overVault, readLogo } from '../vault.ts';

import { documentNumberCount, findDocument, removeIndexEntry, scanInvoices } from './index.ts';

import type { Document } from '@xmldom/xmldom';

// Soubory, ze kterých typst doklad sází. Náhled dostane tytéž jako uložení, aby ukázal to, co se uloží;
// `previous` je ISDOC přepisované verze dokladu.
export async function invoiceFiles(vaultPath: string, invoice: Invoice, previous?: Document): Promise<TypstFiles> {
	// Doklad bez položek by vyrobil ISDOC, který neprojde XSD.
	if (invoice.lines.length === 0) throw new Error('Doklad nemá žádnou položku — ISDOC vyžaduje aspoň jednu.');
	let isdoc = buildIsdoc(invoice);
	// Odeslání je událost dokladu, ne jeho obsahu: bez původního času a odesílatele by se upravená
	// faktura tvářila jako neodeslaná.
	// Stryker disable next-line ConditionalExpression: ekvivalentní mutant, z neodeslaného dokladu `copySent` nic nepřenese; podmínka jen šetří rozbor a kontrolu XSD.
	if (previous && sentAt(previous) !== undefined) {
		const document = await parse(isdoc);
		copySent(previous, document);
		isdoc = toXml(document);
	}
	const spayd = buildSpayd(invoice);
	// Kvůli ozdobě nesmí selhat vystavení: logo, které nejde přečíst, se vynechá a stránkám ho
	// hlásí `vaultLogoState`.
	const logo = await readLogo(vaultPath);
	const hasLogo = typeof logo !== 'string';
	const data = invoiceData(invoice, spayd !== undefined, hasLogo);
	return {
		'invoice.json': new TextEncoder().encode(JSON.stringify(data)),
		[ISDOC_ATTACHMENT]: new TextEncoder().encode(isdoc),
		...(spayd !== undefined && { 'qr.png': qrPng(spayd) }),
		...(hasLogo && { 'logo.png': logo }),
	};
}

// Záloha jen tehdy, když je co zálohovat. Nemožnost ji napsat nesmí zablokovat vystavení faktury.
export async function writePdf(root: string, path: string, number: string, bytes: Uint8Array): Promise<void> {
	const [original] = await Promise.allSettled([readDocument(path)]);
	if (original.status === 'fulfilled') {
		await saveSnapshot(join(snapshotDir(root), 'faktury'), number, 'pdf', original.value);
	}
	await writeAtomic(path, bytes);
	await removeIndexEntry(root, path);
}

interface DocumentOnDisk {
	issuingSystem: string;
	invoice: Invoice;
	isdoc: Document;
}

// Doklad na cestě, kam se chystá zápis.
async function documentOnDisk(path: string): Promise<DocumentOnDisk> {
	const bytes = await readDocument(path);
	const pdf = await loadPdf(bytes);
	const { document } = await readIsdoc(pdf);
	// Neplatný údaj o odeslání je poškozený doklad; přepsat ho by rozpor tiše zahladilo.
	sentAt(document);
	return {
		issuingSystem: text(document.documentElement, 'IssuingSystem'),
		invoice: intoInvoice(document),
		isdoc: document,
	};
}

export async function saveInvoice({
	vaultPath,
	invoice: argument,
	isNew,
}: {
	vaultPath: string;
	invoice: unknown;
	isNew: boolean;
}): Promise<string> {
	const invoice = invoiceArgument(argument);
	const { number } = invoice;
	const numberProblem = validateNumber(number);
	if (numberProblem) throw new Error(numberProblem);
	const root = await overVault(vaultPath);
	const dir = join(root, 'faktury');

	// Počítají se i iCloud zástupci a konfliktní kopie: i ty číslo drží.
	const count = await documentNumberCount(dir, number);
	let previous: { path: string; isdoc: Document } | undefined;
	if (isNew) {
		if (count > 0) throw new Error(`Faktura ${number} už existuje. Zvol jiné číslo.`);
	} else {
		if (count > 1) {
			throw new Error(
				`Číslo dokladu ${number} je ve složce faktury/ víckrát. Nejdřív rozhodni konflikt ve Finderu.`,
			);
		}
		const path = await findDocument(dir, number);
		// Editace bez souboru na disku není editace: tiše založený nový doklad by ze smazání mimo
		// appku udělal úspěšné uložení.
		if (path === undefined) {
			throw new Error(
				`Doklad ${number} ve složce faktury/ není — smazal ho někdo mimo appku, nebo je odpojený disk? Ulož ho jako nový doklad.`,
			);
		}
		let onDisk: DocumentOnDisk;
		try {
			onDisk = await documentOnDisk(path);
		} catch (error) {
			throw new Error(
				`Doklad ${number} nejde přečíst, takže ho nelze bezpečně přepsat. Oprav nebo obnov PDF ze zálohy.`,
				{ cause: error },
			);
		}
		// Přeuložením by archivovaný záznam přestal existovat.
		if (onDisk.issuingSystem !== ISSUING_SYSTEM) {
			const issuer = onDisk.issuingSystem.trim() || 'jiný software';
			throw new Error(
				`Fakturu ${number} vystavil ${issuer}, ne Fakturian — přepsat archivovaný doklad nejde. Ulož ji jako nový doklad s vlastním číslem.`,
			);
		}
		// Pod číslem leží jiný vlastní doklad, třeba po přečíslování v editaci; přepsat ho by znamenalo
		// přijít o vystavený doklad beze stopy.
		if (onDisk.invoice.uuid.toLowerCase() !== invoiceUuid(invoice).toLowerCase()) {
			throw new Error(
				`Pod číslem ${number} už je jiný doklad (vystaven ${onDisk.invoice.issueDate} pro ${onDisk.invoice.customer.name}). Editace ho přepsat nesmí — vrať původní číslo, nebo zvol volné.`,
			);
		}
		previous = {
			path,
			isdoc: onDisk.isdoc,
		};
	}

	// Až za hlídkami, aby cizí doklad hlásil to podstatné. Stejné schéma jako formulář, jen bez
	// kontextu evidence (limity ceníku, cílová faktura dobropisu), který zná jen frontend.
	const checked = invoiceSchema().safeParse(invoice);
	if (!checked.success) {
		const problems = checked.error.issues.slice(0, 3).map((issue) => issue.message);
		throw new Error(`Doklad nejde uložit (${czechList.format(problems)}).`);
	}
	if (invoice.documentType === DocumentKind.CreditNote && !invoice.originalInvoice.trim()) {
		throw new Error('Dobropis musí odkazovat na fakturu, kterou opravuje.');
	}
	const scan = await scanInvoices({ vaultPath });
	const credits = creditNotesOf(number, scan.readable);
	if (previous && credits.length) {
		throw new Error(
			`Faktura ${number} má dobropis ${czechList.format(credits)}, proto ji nejde upravit. Nejdřív smaž dobropis.`,
		);
	}
	const prior = scan.readable.find((item) => item.path === previous?.path);
	const amount = invoiceTotalCents(invoice);
	const canIncrease =
		prior === undefined ? amount > 0 : amount > prior.totalCents || invoice.issueDate !== prior.issueDate;
	if (canIncrease) {
		if (scan.broken.length > 0) {
			throw new Error(
				'Limit obratu nejde ověřit, protože některé faktury nejdou přečíst. Nejdřív oprav vadné doklady v Přehledu.',
			);
		}
		const days = Map.groupBy(scan.items, (item) => item.issueDate);
		if (!days.has(invoice.issueDate)) days.set(invoice.issueDate, []);
		const dates = [...days.entries()].toSorted(([a], [b]) => a.localeCompare(b));
		const before = new Map<number, number>();
		const after = new Map<number, number>();
		const crossed = new Set<number>();
		for (const [date, dayItems] of dates) {
			const year = isdocYear(date);
			const oldDay = dayItems.reduce((sum, item) => sum + item.totalCents, 0);
			const newDay =
				oldDay - (prior?.issueDate === date ? prior.totalCents : 0) + (invoice.issueDate === date ? amount : 0);
			const oldTotal = (before.get(year) ?? 0) + oldDay;
			const newTotal = (after.get(year) ?? 0) + newDay;
			before.set(year, oldTotal);
			after.set(year, newTotal);
			if (oldTotal > VAT_LIMIT_CENTS) crossed.add(year);
			if ((newTotal > VAT_LIMIT_CENTS || crossed.has(year)) && newTotal > oldTotal) {
				throw new Error(
					'Doklad nejde uložit, protože by obrat za kalendářní rok překročil 2 000 000 Kč. Fakturian je určený pro podnikatele do tohoto limitu.',
				);
			}
		}
		if (amount > 0 && crossed.has(yearOf(checked.data.issueDate) - 1)) {
			throw new Error(
				'Doklad nejde uložit, protože obrat v předchozím roce překročil 2 000 000 Kč. Další postup ověř s účetním.',
			);
		}
	}

	const files = await invoiceFiles(vaultPath, invoice, previous?.isdoc);
	const pdf = renderTypstPdf(invoiceTypst(), files);
	if (previous) {
		await writePdf(root, previous.path, number, pdf);
		return previous.path;
	}
	await mkdir(dir, { recursive: true });
	const path = join(dir, `${number}.pdf`);
	// Jméno mohla mezi kontrolou a zápisem zabrat druhá instance appky nebo synchronizace.
	const written = await writeNew(path, pdf);
	if (written === 'taken') throw new Error(`Faktura ${number} už existuje. Zvol jiné číslo.`);
	await removeIndexEntry(root, path);
	return path;
}

// Doklad se hledá podle čísla ve `faktury/`, ne podle cesty z frontendu: příkaz, který přečte
// libovolný soubor na disku, by s jakoukoli XSS posloužil jako čtečka souborů.
export async function loadInvoice({ vaultPath, number }: { vaultPath: string; number: string }): Promise<Invoice> {
	const root = await overVault(vaultPath);
	const path = await findDocument(join(root, 'faktury'), number);
	if (path === undefined) throw new Error(`Doklad ${number} ve složce faktury/ není.`);
	let pdf: LoadedPdf;
	try {
		const bytes = await readDocument(path);
		pdf = await loadPdf(bytes);
	} catch (error) {
		throw new Error(`Doklad ${number} nejde přečíst. Oprav nebo obnov PDF ze zálohy.`, { cause: error });
	}
	const { document } = await readIsdoc(pdf);
	return intoInvoice(document);
}

// Zdroj se hledá podle čísla jako v `loadInvoice`; cíl vybral uživatel v dialogu.
export async function exportInvoicePdf({
	vaultPath,
	number,
	target,
}: {
	vaultPath: string;
	number: string;
	target: string;
}): Promise<null> {
	const root = await overVault(vaultPath);
	const source = await findDocument(join(root, 'faktury'), number);
	if (source === undefined) throw new Error(`Doklad ${number} ve složce faktury/ není.`);
	// Přes dočasný soubor: export useknutý plným diskem by v cíli nechal půlku PDF.
	try {
		const bytes = await readDocument(source);
		await writeAtomic(target, bytes);
	} catch (error) {
		throw new Error(`PDF se nepodařilo uložit do ${target}.`, { cause: error });
	}
	return null;
}
