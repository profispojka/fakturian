import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { errorText } from '~/utils/errors';
import { validateNumber } from '~/utils/numbering';

import { invoiceWrites, writePdf } from './mod.ts';

import { sentAt, setSent, toXml } from '../isdoc/mod.ts';
import { intoInvoice } from '../isdoc/projection.ts';
import { hasSignature, loadPdf, readIsdoc, replaceIsdoc, savePdf } from '../pdf.ts';
import { overVault } from '../vault.ts';

import { documentNumberCount, findDocument } from './index.ts';

import type { Document } from '@xmldom/xmldom';
import type { PDFDocument } from 'pdf-lib';

// Podpis ISDOC stojí na konci dokladu jako prvek v tomhle jmenném prostoru (skupina `Signature` v XSD).
const XMLDSIG_NAMESPACE = 'http://www.w3.org/2000/09/xmldsig#';

// Akce je jednosměrná: zrušení příznaku by znovu otevřelo možnost přepsat doklad, který už mohl dostat
// zákazník.
export function markInvoiceSent({ vaultPath, number }: { vaultPath: string; number: string }): Promise<string> {
	return invoiceWrites(async () => {
		const numberProblem = validateNumber(number);
		if (numberProblem) throw new Error(numberProblem);
		const root = await overVault(vaultPath);
		const invoices = join(root, 'faktury');
		const count = await documentNumberCount(invoices, number);
		if (count > 1) {
			throw new Error(
				`Číslo dokladu ${number} je ve složce faktury/ víckrát. Nejdřív rozhodni konflikt ve Finderu.`,
			);
		}
		const path = await findDocument(invoices, number);
		if (path === undefined) throw new Error(`Fakturu ${number} se nepodařilo najít.`);
		let pdf: PDFDocument;
		try {
			const bytes = await readFile(path);
			pdf = await loadPdf(bytes);
		} catch (error) {
			throw new Error(
				`Doklad ${number} nejde přečíst, proto ho nelze označit jako odeslaný: ${errorText(error)}`,
				{ cause: error },
			);
		}
		let document: Document;
		try {
			({ document } = await readIsdoc(pdf));
		} catch (error) {
			throw new Error(
				`Doklad ${number} nejde přečíst (${errorText(error)}), proto ho nelze označit jako odeslaný.`,
				{ cause: error },
			);
		}
		// Už odeslaný doklad vrátí svůj čas beze změny, i když ho mezitím někdo podepsal.
		const sent = sentAt(document);
		if (sent !== undefined) return sent;
		if (hasSignature(pdf)) {
			throw new Error(`Doklad ${number} obsahuje elektronický podpis. Zápis stavu odeslání by ho zneplatnil.`);
		}
		const signatures = Array.from(document.getElementsByTagNameNS(XMLDSIG_NAMESPACE, '*'));
		if (signatures.some((element) => element.parentNode === document.documentElement)) {
			throw new Error(
				`ISDOC dokladu ${number} obsahuje elektronický podpis. Zápis stavu odeslání by ho zneplatnil.`,
			);
		}

		const at = new Date().toISOString();
		const invoice = intoInvoice(document);
		setSent(document, at, invoice.supplier.name);
		await replaceIsdoc(pdf, toXml(document));
		const bytes = await savePdf(pdf);
		await writePdf(root, path, number, bytes);
		return at;
	});
}
