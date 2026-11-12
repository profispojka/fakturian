import { copyFile, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { invoice, samples } from './invoices.ts';
import { invoicePdf } from './pdfs.ts';
import { expectPdfA3a, invoiceFiles } from './typst.ts';

import { saveInvoice } from '../invoice/mod.ts';
import { markInvoiceSent } from '../invoice/status.ts';
import { invoiceTypst } from '../invoice/template.ts';
import { setSent, toXml } from '../isdoc/mod.ts';
import { loadPdf, readIsdoc, renderTypstPdf, replaceIsdoc, savePdf } from '../pdf.ts';

describe('PDF/A-3a', () => {
	let dir = '';

	beforeEach(async () => {
		const temporary = await mkdtemp(join(tmpdir(), `fakturian-pdfa-${process.pid}-`));
		// veraPDF hlásí cestu bez symlinku, na macOS tedy `/private/tmp/…` místo `/tmp/…`.
		dir = await realpath(temporary);
	});

	afterEach(async () => {
		await rm(dir, { recursive: true });
	});

	it('každý doklad i s logem projde veraPDF', async () => {
		// Logo je další obrázek, který musí mít alternativní text.
		const logo = await readFile(new URL('fixtures/logo.png', import.meta.url));
		const paths: string[] = [];
		for (const document of samples()) {
			const path = join(dir, `${document.number}.pdf`);
			await writeFile(path, renderTypstPdf(invoiceTypst(), invoiceFiles(document, logo)));
			paths.push(path);
		}

		await expectPdfA3a(paths);
	});

	it('každý doklad uložený s logem z vaultu projde veraPDF, i odeslaný a upravený', async () => {
		await copyFile(new URL('fixtures/logo.png', import.meta.url), join(dir, 'logo.png'));
		const paths: string[] = [];
		for (const document of samples()) {
			const number = String(paths.length + 1).padStart(8, '0');
			const path = await saveInvoice({
				vaultPath: dir,
				invoice: {
					...document,
					number,
				},
				isNew: true,
			});
			paths.push(path);
		}
		for (const number of ['00000001', '00000002']) {
			await markInvoiceSent({
				vaultPath: dir,
				number,
			});
		}
		await saveInvoice({
			vaultPath: dir,
			invoice: {
				...invoice(),
				number: '00000001',
				note: 'Upraveno po odeslání.',
			},
			isNew: false,
		});

		expect(paths.length).toBe(samples().length);
		await expectPdfA3a(paths);
	});

	it('doklad s vyměněnou přílohou ISDOC po novém uložení dál projde veraPDF', async () => {
		const pdf = await loadPdf(await invoicePdf(invoice()));
		const { document } = await readIsdoc(pdf);
		setSent(document, '2026-05-29T10:15:00Z', 'Jan Dodavatel');
		await replaceIsdoc(pdf, toXml(document));
		const path = join(dir, 'odeslana.pdf');
		await writeFile(path, await savePdf(pdf));

		await expectPdfA3a([path]);
	});
});
