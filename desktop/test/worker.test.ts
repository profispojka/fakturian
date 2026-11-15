import { once } from 'node:events';
import { buffer } from 'node:stream/consumers';
import { createDeflate, deflateSync } from 'node:zlib';

import { PDFDocument } from 'pdf-lib';
import { Tinypool } from 'tinypool';
import { describe, expect, it, vi } from 'vitest';

import { MINIMAL_ISDOC } from './invoices.ts';
import { pdfWithIsdoc } from './pdfs.ts';
import { rejection } from './support.ts';

import { MAX_ISDOC_BYTES } from '../isdoc/mod.ts';
import { loadPdf, readIsdoc, replaceIsdoc } from '../pdf.ts';
import runPdfTask from '../worker.ts';

const ENCODER = new TextEncoder();
const CRASHED = 'PDF nejde rozbalit v rozumném čase ani paměti — takhle doklad nevypadá';
const MIB = 1024 * 1024;

// pdf-lib proud objektů rozbalí a rozebere už při načtení dokumentu.
function objectStreamPdf(count: number, first: number, packed: Uint8Array): Uint8Array {
	return Buffer.concat([
		Buffer.from(
			'%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n' +
				`3 0 obj\n<< /Type /ObjStm /N ${count} /First ${first} /Filter /FlateDecode /Length ${packed.byteLength} >>\nstream\n`,
			'latin1',
		),
		packed,
		Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R /Size 4 >>\n%%EOF\n', 'latin1'),
	]);
}

// Z pár MB se rozbalí na `mib` mezer.
async function objectStreamBomb(mib: number): Promise<Uint8Array> {
	const deflate = createDeflate({ level: 9 });
	const packed = buffer(deflate);
	const chunk = Buffer.alloc(MIB, ' ');
	for (let i = 0; i < mib; i++) {
		if (!deflate.write(chunk)) await once(deflate, 'drain');
	}
	deflate.end();
	const data = await packed;
	return objectStreamPdf(1, 4, data);
}

// Miliony drobných objektů, každý se v pdf-lib stane záznamem v haldě.
function manyObjects(count: number): Uint8Array {
	const object = '<< /A [1 2 3] >> ';
	const offsets = Array.from({ length: count }, (_, i) => `${i + 4} ${i * object.length}`);
	const header = `${offsets.join(' ')} `;
	const body = Buffer.from(header + object.repeat(count), 'latin1');
	return objectStreamPdf(count, header.length, deflateSync(body, { level: 9 }));
}

// Práce, která skončí, až ji pool zruší signálem.
function hang(_task: unknown, options?: { signal?: unknown }): Promise<unknown> {
	const signal = options?.signal as AbortSignal;
	return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
}

describe('práce s PDF ve workeru', () => {
	it('přečte přílohy, vymění jednu a chybu pdf-lib vrátí jako odpověď', async () => {
		const bytes = await pdfWithIsdoc(MINIMAL_ISDOC);

		const read = await runPdfTask({
			read: bytes,
			budget: MAX_ISDOC_BYTES,
		});
		const rewritten = (await runPdfTask({
			rewrite: bytes,
			index: 0,
			xml: '<Nove/>',
			budget: MAX_ISDOC_BYTES,
		})) as { result: Uint8Array };
		const reread = await runPdfTask({
			read: rewritten.result,
			budget: MAX_ISDOC_BYTES,
		});
		const broken = await runPdfTask({
			read: ENCODER.encode('tohle PDF neni'),
			budget: MAX_ISDOC_BYTES,
		});

		expect(read).toEqual({
			result: {
				signed: false,
				attachments: [
					{
						content: ENCODER.encode(MINIMAL_ISDOC),
						replaceable: true,
					},
				],
			},
		});
		expect(reread).toEqual({
			result: {
				signed: false,
				attachments: [
					{
						content: ENCODER.encode('<Nove/>'),
						replaceable: true,
					},
				],
			},
		});
		expect(broken).toEqual({
			error: new Error('Failed to parse PDF document (line:0 col:28 offset=14): No PDF header found'),
		});
	});

	it('strop příloh bere z požadavku', async () => {
		const bytes = await pdfWithIsdoc(MINIMAL_ISDOC);

		const answer = await runPdfTask({
			read: bytes,
			budget: 3,
		});

		expect(answer).toEqual({
			result: {
				signed: false,
				attachments: [],
			},
		});
	});
});

describe('načtení PDF přes worker', () => {
	it('vrátí bajty i přílohy a vyměněnou přílohu přečte zpátky', async () => {
		const bytes = await pdfWithIsdoc(MINIMAL_ISDOC);
		const pdf = await loadPdf(bytes);
		const changed = MINIMAL_ISDOC.replace('<ID>20260001</ID>', '<ID>20260002</ID>');

		const saved = await replaceIsdoc(pdf, changed);
		const { xml } = await readIsdoc(await loadPdf(saved));
		const reloaded = await PDFDocument.load(saved);

		expect([pdf.bytes, pdf.signed, xml]).toEqual([bytes, false, changed]);
		expect(reloaded.getPageCount()).toBe(1);
	});

	it('chybu pdf-lib vrátí tak, jak přišla', async () => {
		await expect(loadPdf(ENCODER.encode('tohle PDF neni'))).rejects.toEqual(
			new Error('Failed to parse PDF document (line:0 col:28 offset=14): No PDF header found'),
		);
	});

	it('proud objektů, který se rozbalí přes 1 GB, ukončí dřív, než zabere paměť appky', async () => {
		const bomb = await objectStreamBomb(1536);
		// Bez časového limitu: práci musí zastavit hlídání paměti.
		vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(new AbortController().signal);

		const error = await rejection(loadPdf(bomb));
		const pdf = await loadPdf(await pdfWithIsdoc(MINIMAL_ISDOC));
		const { xml } = await readIsdoc(pdf);

		expect(error).toEqual(new Error(CRASHED, { cause: expect.objectContaining({ name: 'AbortError' }) }));
		expect(xml).toBe(MINIMAL_ISDOC);
	}, 30_000);

	it('práci, která nedoběhne do deseti sekund, ukončí', async () => {
		const timeout = new AbortController();
		const limit = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(timeout.signal);
		const run = vi.spyOn(Tinypool.prototype, 'run').mockImplementationOnce(hang);

		const outcome = rejection(loadPdf(await pdfWithIsdoc(MINIMAL_ISDOC)));
		await vi.waitFor(() => expect(run).toHaveBeenCalled());
		const cause = new Error('Vypršel čas.');
		timeout.abort(cause);

		expect(limit).toHaveBeenCalledWith(10_000);
		expect(await outcome).toEqual(new Error(CRASHED, { cause }));
	});

	it('PDF s miliony objektů ukončí dřív, než přeteče halda a s ní celá appka', async () => {
		const flood = manyObjects(3_000_000);

		const error = await rejection(loadPdf(flood));
		const { xml } = await readIsdoc(await loadPdf(await pdfWithIsdoc(MINIMAL_ISDOC)));

		expect(error).toEqual(new Error(CRASHED, { cause: expect.objectContaining({ name: 'AbortError' }) }));
		expect(xml).toBe(MINIMAL_ISDOC);
	});

	it('worker, který se nespustí, ohlásí jako vadu appky a další PDF načte', async () => {
		const crash = new Error('Worker spadl.');
		vi.spyOn(Tinypool.prototype, 'run').mockRejectedValueOnce(crash);
		const bytes = await pdfWithIsdoc(MINIMAL_ISDOC);

		const error = await rejection(loadPdf(bytes));
		const { xml } = await readIsdoc(await loadPdf(bytes));

		expect(error).toEqual(
			new Error('Fakturian nedokázal spustit čtení PDF — zkus ho restartovat', { cause: crash }),
		);
		expect(xml).toBe(MINIMAL_ISDOC);
	});

	it('hotová práce po sobě nenechá hlídání paměti', async () => {
		const bytes = await pdfWithIsdoc(MINIMAL_ISDOC);
		vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
		try {
			await loadPdf(bytes);

			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});
