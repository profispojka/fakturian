import { readFile, writeFile } from 'node:fs/promises';

import { PDFDocument, PDFName, PDFString, type PDFObject, type PDFRawStream, type PDFRef } from 'pdf-lib';

import { invoiceFiles } from './typst.ts';

import { buildIsdoc } from '../invoice/isdoc.ts';
import { invoiceTypst } from '../invoice/template.ts';
import { ISDOC_ATTACHMENT, loadPdf, readIsdoc, renderTypstPdf, replaceIsdoc, savePdf } from '../pdf.ts';

import type { Invoice } from '../invoice/model.ts';

export async function samplePdf(): Promise<PDFDocument> {
	const pdf = await PDFDocument.create();
	pdf.addPage();
	return pdf;
}

// Filespec se jménem v `/F` i `/UF` a daty pod vlastním odkazem.
export function filespec(pdf: PDFDocument, name: PDFObject, data: PDFRawStream): PDFRef {
	const stream = pdf.context.register(data);
	return pdf.context.register(
		pdf.context.obj({
			Type: 'Filespec',
			F: name,
			UF: name,
			EF: {
				F: stream,
				UF: stream,
			},
		}),
	);
}

export function embeddedFiles(pdf: PDFDocument, items: [PDFObject, PDFRef][]): void {
	pdf.catalog.set(
		PDFName.of('Names'),
		pdf.context.obj({
			EmbeddedFiles: {
				Names: items.flat(),
			},
		}),
	);
}

// Doklad vysázený typstem i s vlastním ISDOC, ne se zástupným.
export function invoicePdf(document: Invoice): Uint8Array {
	const isdoc = buildIsdoc(document);
	return renderTypstPdf(invoiceTypst(), {
		...invoiceFiles(document),
		[ISDOC_ATTACHMENT]: new TextEncoder().encode(isdoc),
	});
}

// PDF s vloženým ISDOC, jak ho pošle jiný software.
export async function pdfWithIsdoc(xml: string): Promise<Uint8Array> {
	const pdf = await samplePdf();
	const name = PDFString.of(ISDOC_ATTACHMENT);
	const data = pdf.context.stream(new TextEncoder().encode(xml), { Type: 'EmbeddedFile' });
	embeddedFiles(pdf, [[name, filespec(pdf, name, data)]]);
	return savePdf(pdf);
}

export async function embeddedXml(path: string): Promise<string> {
	const pdf = await loadPdf(await readFile(path));
	const { xml } = await readIsdoc(pdf);
	return xml;
}

// Vloženou přílohu dokladu na disku přepíše tím, co z ní udělá `change`.
export async function rewriteIsdoc(path: string, change: (xml: string) => string): Promise<void> {
	const pdf = await loadPdf(await readFile(path));
	const { xml } = await readIsdoc(pdf);
	await replaceIsdoc(pdf, change(xml));
	await writeFile(path, await savePdf(pdf));
}
