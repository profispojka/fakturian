import { join } from 'node:path';

import { errorText } from '~/utils/errors';
import { validateNumber } from '~/utils/numbering';

import { writePdf } from './mod.ts';

import { clearSent, sentAt, setSent, toXml } from '../isdoc/mod.ts';
import { intoInvoice } from '../isdoc/projection.ts';
import { loadPdf, readIsdoc, replaceIsdoc, type LoadedPdf } from '../pdf.ts';
import { readDocument } from '../util.ts';
import { overVault } from '../vault.ts';

import { documentNumberCount, findDocument } from './index.ts';

import type { Document } from '@xmldom/xmldom';

// Podpis ISDOC stojí na konci dokladu jako prvek v tomhle jmenném prostoru (skupina `Signature` v XSD).
const XMLDSIG_NAMESPACE = 'http://www.w3.org/2000/09/xmldsig#';

async function loadForStatus(
	vaultPath: string,
	number: string,
	blocked: string,
): Promise<{ root: string; path: string; pdf: LoadedPdf; document: Document }> {
	const numberProblem = validateNumber(number);
	if (numberProblem) throw new Error(numberProblem);
	const root = await overVault(vaultPath);
	const invoices = join(root, 'faktury');
	const count = await documentNumberCount(invoices, number);
	if (count > 1) {
		throw new Error(`Číslo dokladu ${number} je ve složce faktury/ víckrát. Nejdřív rozhodni konflikt ve Finderu.`);
	}
	const path = await findDocument(invoices, number);
	if (path === undefined) throw new Error(`Fakturu ${number} se nepodařilo najít.`);
	let pdf: LoadedPdf;
	try {
		const bytes = await readDocument(path);
		pdf = await loadPdf(bytes);
	} catch (error) {
		throw new Error(`Doklad ${number} nejde přečíst, proto ${blocked}: ${errorText(error)}`, {
			cause: error,
		});
	}
	let document: Document;
	try {
		({ document } = await readIsdoc(pdf));
	} catch (error) {
		throw new Error(`Doklad ${number} nejde přečíst (${errorText(error)}), proto ${blocked}.`, {
			cause: error,
		});
	}
	return {
		root,
		path,
		pdf,
		document,
	};
}

function assertUnsigned(number: string, pdf: LoadedPdf, document: Document): void {
	if (pdf.signed) {
		throw new Error(`Doklad ${number} obsahuje elektronický podpis. Zápis stavu odeslání by ho zneplatnil.`);
	}
	const signatures = Array.from(document.getElementsByTagNameNS(XMLDSIG_NAMESPACE, '*'));
	if (signatures.some((element) => element.parentNode === document.documentElement)) {
		throw new Error(`ISDOC dokladu ${number} obsahuje elektronický podpis. Zápis stavu odeslání by ho zneplatnil.`);
	}
}

export async function markInvoiceSent({ vaultPath, number }: { vaultPath: string; number: string }): Promise<string> {
	const { root, path, pdf, document } = await loadForStatus(vaultPath, number, 'ho nelze označit jako odeslaný');
	// Už odeslaný doklad vrátí svůj čas beze změny, i když ho mezitím někdo podepsal.
	const sent = sentAt(document);
	if (sent !== undefined) return sent;
	assertUnsigned(number, pdf, document);

	const at = new Date().toISOString();
	const invoice = intoInvoice(document);
	setSent(document, at, invoice.supplier.name);
	const bytes = await replaceIsdoc(pdf, toXml(document));
	await writePdf(root, path, number, bytes);
	return at;
}

export async function unmarkInvoiceSent({ vaultPath, number }: { vaultPath: string; number: string }): Promise<null> {
	const { root, path, pdf, document } = await loadForStatus(vaultPath, number, 'ho nelze vrátit mezi neodeslané');
	if (sentAt(document) === undefined) return null;
	assertUnsigned(number, pdf, document);

	clearSent(document);
	const bytes = await replaceIsdoc(pdf, toXml(document));
	await writePdf(root, path, number, bytes);
	return null;
}
