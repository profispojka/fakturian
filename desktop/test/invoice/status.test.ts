import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFName, type PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invoiceTotalCents } from '~/utils/invoice';

import { listInvoices } from '../../invoice/index.ts';
import { loadInvoice, saveInvoice } from '../../invoice/mod.ts';
import { markInvoiceSent } from '../../invoice/status.ts';
import { loadPdf, savePdf } from '../../pdf.ts';
import { invoice } from '../invoices.ts';
import { schemaReport } from '../isdoc.ts';
import { embeddedXml, rewriteIsdoc, samplePdf } from '../pdfs.ts';
import { names } from '../support.ts';

import type { Invoice } from '../../invoice/model.ts';

const INSTANT = '2026-09-30T12:34:56.789Z';

let base = '';

beforeEach(async () => {
	base = await mkdtemp(join(tmpdir(), `fakturian-sent-${process.pid}-`));
});

afterEach(async () => {
	await rm(base, { recursive: true });
});

function saveNumbered(number: string, document: Invoice = invoice()): Promise<string> {
	return saveInvoice({
		vaultPath: base,
		invoice: {
			...document,
			number,
		},
		isNew: true,
	});
}

function markSent(number: string): Promise<string> {
	return markInvoiceSent({
		vaultPath: base,
		number,
	});
}

// Upraví PDF dokladu na disku tak, jak by ho upravil jiný software.
// Vrátí bajty, jak leží na disku, aby šly porovnat s dalším čtením.
async function changePdf(path: string, change: (pdf: PDFDocument) => void): Promise<Buffer> {
	const pdf = await loadPdf(await readFile(path));
	change(pdf);
	await writeFile(path, await savePdf(pdf));
	return readFile(path);
}

describe('označení jako odeslané', () => {
	it('stav odeslání leží v platných Extensions ISDOC a přežije úpravu dokladu', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(INSTANT);
		let sentAt: string;
		const path = await saveNumbered('20260002', {
			...invoice(),
			supplier: {
				...invoice().supplier,
				name: 'Petr & syn',
			},
		});
		try {
			sentAt = await markSent('20260002');
		} finally {
			vi.useRealTimers();
		}

		expect(sentAt).toBe('2026-09-30T12:34:56.789Z');
		const xml = await embeddedXml(path);
		expect(xml.split('<RefCurrRate>1</RefCurrRate>')[1]?.split('<AccountingSupplierParty>')[0]).toBe(
			'<Extensions>' +
				'<fakturian:SentAt xmlns:fakturian="https://fakturian.app/isdoc/extensions/1">2026-09-30T12:34:56.789Z</fakturian:SentAt>' +
				'<fakturian:SentBy xmlns:fakturian="https://fakturian.app/isdoc/extensions/1"><![CDATA[Petr & syn]]></fakturian:SentBy>' +
				'</Extensions>',
		);
		expect(await schemaReport(xml)).toBe('- validates\n');
		expect(await names(base)).toEqual(['.fakturian', 'faktury']);
		const listed = await listInvoices({ vaultPath: base });
		expect(listed.items.map((item) => item.sentAt)).toEqual([sentAt]);

		const original = await loadInvoice({
			vaultPath: base,
			number: '20260002',
		});
		const [first, second] = original.lines;
		const edited = {
			...original,
			supplier: {
				...original.supplier,
				name: 'Jiný dodavatel',
			},
			lines: [
				{
					...first!,
					unitPriceCents: first!.unitPriceCents + 100_000,
				},
				second!,
			],
		};
		await saveInvoice({
			vaultPath: base,
			invoice: edited,
			isNew: false,
		});

		const reloaded = await loadInvoice({
			vaultPath: base,
			number: '20260002',
		});
		expect(invoiceTotalCents(reloaded)).toBe(invoiceTotalCents(edited));
		const after = await embeddedXml(path);
		expect(after.split('<Extensions>')[1]?.split('</Extensions>')[0]).toBe(
			'<fakturian:SentAt xmlns:fakturian="https://fakturian.app/isdoc/extensions/1">2026-09-30T12:34:56.789Z</fakturian:SentAt>' +
				'<fakturian:SentBy xmlns:fakturian="https://fakturian.app/isdoc/extensions/1"><![CDATA[Petr & syn]]></fakturian:SentBy>',
		);
		expect(await schemaReport(after)).toBe('- validates\n');
		const again = await listInvoices({ vaultPath: base });
		expect(again.items.map((item) => item.sentAt)).toEqual([sentAt]);
	});

	it('čas odeslání je teď v UTC a ve tvaru RFC 3339', async () => {
		await saveNumbered('20260001');
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime('2026-09-30T14:34:56.789+02:00');
		let sentAt: string;
		try {
			sentAt = await markSent('20260001');
		} finally {
			vi.useRealTimers();
		}

		expect(sentAt).toBe('2026-09-30T12:34:56.789Z');
	});

	it('druhé označení vrátí týž čas a PDF znovu nezapíše, ani podepsané', async () => {
		const path = await saveNumbered('20260003');
		const sentAt = await markSent('20260003');
		const afterFirst = await readFile(path);

		expect(await markSent('20260003')).toBe(sentAt);
		expect(await readFile(path)).toEqual(afterFirst);

		const signed = await changePdf(path, (pdf) => {
			pdf.context.register(pdf.context.obj({ Type: 'Sig' }));
		});

		expect(await markSent('20260003')).toBe(sentAt);
		expect(await readFile(path)).toEqual(signed);
	});

	it('cizí rozšíření v hlavičce přežijí označení', async () => {
		const path = await saveNumbered('20260004');
		await rewriteIsdoc(path, (xml) =>
			xml.replace(
				'<AccountingSupplierParty>',
				'<Extensions><cizi:Reference xmlns:cizi="https://example.test/isdoc">ABC-42</cizi:Reference></Extensions><AccountingSupplierParty>',
			),
		);

		const sentAt = await markSent('20260004');

		const marked = await embeddedXml(path);
		expect(marked.split('<Extensions>')[1]?.split('</Extensions>')[0]).toBe(
			'<cizi:Reference xmlns:cizi="https://example.test/isdoc">ABC-42</cizi:Reference>' +
				`<fakturian:SentAt xmlns:fakturian="https://fakturian.app/isdoc/extensions/1">${sentAt}</fakturian:SentAt>` +
				'<fakturian:SentBy xmlns:fakturian="https://fakturian.app/isdoc/extensions/1">Jan Dodavatel</fakturian:SentBy>',
		);
		expect(await schemaReport(marked)).toBe('- validates\n');
	});
});

describe('doklad, který označit nejde', () => {
	it('chybějící doklad se ohlásí a nic se nezaloží', async () => {
		await expect(markSent('20269999')).rejects.toThrow(new Error('Fakturu 20269999 se nepodařilo najít.'));
		expect(await names(base)).toEqual([]);
	});

	it('číslo, které je cesta, odmítne dřív, než sáhne na disk', async () => {
		await expect(
			markInvoiceSent({
				vaultPath: join(base, 'neni'),
				number: '../cizi',
			}),
		).rejects.toThrow(
			new Error(
				'Číslo dokladu může mít nejvýš 64 znaků: písmena bez diakritiky, číslice, mezery, tečky, pomlčky a podtržítka, a musí začínat i končit písmenem nebo číslicí.',
			),
		);
		expect(await names(base)).toEqual([]);
	});

	it('nečitelné PDF se ohlásí s důvodem', async () => {
		await mkdir(join(base, 'faktury'));
		await writeFile(join(base, 'faktury', '20260006.pdf'), 'not a pdf');

		await expect(markSent('20260006')).rejects.toThrow(
			new Error(
				'Doklad 20260006 nejde přečíst, proto ho nelze označit jako odeslaný: Failed to parse PDF document (line:0 col:18 offset=9): No PDF header found',
				{ cause: expect.any(Error) },
			),
		);
	});

	it('PDF bez ISDOC ani s neplatným ISDOC se nezmění', async () => {
		await mkdir(join(base, 'faktury'));
		const bare = join(base, 'faktury', '20260010.pdf');
		await writeFile(bare, await savePdf(await samplePdf()));
		const invalid = await saveNumbered('20260011');
		await rewriteIsdoc(invalid, () => '<Invoice/>');
		const originals = [await readFile(bare), await readFile(invalid)];

		for (const number of ['20260010', '20260011']) {
			await expect(markSent(number)).rejects.toThrow(
				new Error(
					`Doklad ${number} nejde přečíst (PDF neobsahuje přílohu ISDOC), proto ho nelze označit jako odeslaný.`,
					{ cause: new Error('PDF neobsahuje přílohu ISDOC') },
				),
			);
		}
		expect([await readFile(bare), await readFile(invalid)]).toEqual(originals);
	});

	it('číslo, které je ve složce víckrát, se neoznačí', async () => {
		const canonical = await saveNumbered('20260007');
		await copyFile(canonical, join(base, 'faktury', '20260007 2.pdf'));

		await expect(markSent('20260007')).rejects.toThrow(
			new Error('Číslo dokladu 20260007 je ve složce faktury/ víckrát. Nejdřív rozhodni konflikt ve Finderu.'),
		);
	});

	it('podepsané PDF, podpisové pole ani podepsaný ISDOC se nezmění', async () => {
		const signedPdf = await saveNumbered('20260008');
		const signed = await changePdf(signedPdf, (pdf) => {
			pdf.context.register(pdf.context.obj({ Type: 'Sig' }));
		});
		const fieldPdf = await saveNumbered('20260014');
		const field = await changePdf(fieldPdf, (pdf) => {
			pdf.catalog.set(PDFName.of('AcroForm'), pdf.context.obj({ Fields: [pdf.context.obj({ FT: 'Sig' })] }));
		});
		const signedIsdoc = await saveNumbered('20260012');
		await rewriteIsdoc(signedIsdoc, (xml) =>
			xml.replace('</Invoice>', '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"/></Invoice>'),
		);
		const isdoc = await readFile(signedIsdoc);

		for (const number of ['20260008', '20260014']) {
			await expect(markSent(number)).rejects.toThrow(
				new Error(`Doklad ${number} obsahuje elektronický podpis. Zápis stavu odeslání by ho zneplatnil.`),
			);
		}
		await expect(markSent('20260012')).rejects.toThrow(
			new Error('ISDOC dokladu 20260012 obsahuje elektronický podpis. Zápis stavu odeslání by ho zneplatnil.'),
		);
		expect([await readFile(signedPdf), await readFile(fieldPdf), await readFile(signedIsdoc)]).toEqual([
			signed,
			field,
			isdoc,
		]);
	});

	it('podpis v cizím rozšíření podpisem dokladu není', async () => {
		const path = await saveNumbered('20260015');
		await rewriteIsdoc(path, (xml) =>
			xml.replace(
				'<AccountingSupplierParty>',
				'<Extensions><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"/></Extensions><AccountingSupplierParty>',
			),
		);

		const sentAt = await markSent('20260015');

		const marked = await embeddedXml(path);
		expect(marked.split('<Extensions>')[1]?.split('</Extensions>')[0]).toBe(
			'<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"/>' +
				`<fakturian:SentAt xmlns:fakturian="https://fakturian.app/isdoc/extensions/1">${sentAt}</fakturian:SentAt>` +
				'<fakturian:SentBy xmlns:fakturian="https://fakturian.app/isdoc/extensions/1">Jan Dodavatel</fakturian:SentBy>',
		);
	});

	it('neplatný čas odeslání udělá z dokladu vadný, ne upravitelný', async () => {
		const path = await saveNumbered('20260013');
		await rewriteIsdoc(path, (xml) =>
			xml.replace(
				'<AccountingSupplierParty>',
				'<Extensions><fakturian:SentAt xmlns:fakturian="https://fakturian.app/isdoc/extensions/1">včera</fakturian:SentAt></Extensions><AccountingSupplierParty>',
			),
		);

		const listed = await listInvoices({ vaultPath: base });
		expect([listed.items, listed.broken.map(({ reason }) => reason)]).toEqual([
			[],
			['ISDOC obsahuje neplatný čas odeslání: „včera“ není čas ve tvaru RFC 3339'],
		]);
		await expect(
			saveInvoice({
				vaultPath: base,
				invoice: {
					...invoice(),
					number: '20260013',
					note: 'pokus o přepis',
				},
				isNew: false,
			}),
		).rejects.toThrow(
			new Error(
				'Doklad 20260013 nejde přečíst, takže ho nelze bezpečně přepsat. Oprav nebo obnov PDF ze zálohy.',
			),
		);
		await expect(markSent('20260013')).rejects.toThrow(
			new Error('ISDOC obsahuje neplatný čas odeslání: „včera“ není čas ve tvaru RFC 3339'),
		);
	});

	it('nepovedený zápis nechá doklad neodeslaný', async () => {
		const path = await saveNumbered('20260009');
		const original = await readFile(path);
		await chmod(join(base, 'faktury'), 0o500);

		try {
			await expect(markSent('20260009')).rejects.toThrow(
				// Dočasné jméno nese náhodnou příponu.
				/^Zápis selhal: EACCES: permission denied, open '.+\.tmp'$/,
			);
		} finally {
			await chmod(join(base, 'faktury'), 0o700);
		}
		expect(await readFile(path)).toEqual(original);
	});
});
