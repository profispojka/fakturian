import { EventEmitter } from 'node:events';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { Worker } from 'node:worker_threads';

import { PDFDocument } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MINIMAL_ISDOC } from './invoices.ts';
import { pdfWithIsdoc } from './pdfs.ts';
import { rejection } from './support.ts';

import { MAX_ISDOC_BYTES } from '../isdoc/mod.ts';
import { loadPdf, readIsdoc, replaceIsdoc } from '../pdf.ts';

// Worker běží mimo dosah pokrytí, takže se jeho modul pouští ve vlákně testu s podvrženým portem.
const threads: { parentPort: unknown; workerData: unknown } = createRequire(import.meta.url)('node:worker_threads');

const ENCODER = new TextEncoder();
const CRASHED = 'PDF nejde rozbalit v rozumném čase ani paměti — takhle doklad nevypadá';

class FakePort extends EventEmitter {
	postMessage = vi.fn<(message: unknown, transfer: unknown[]) => void>();
}

function pretendWorker(port: FakePort | null, workerData: unknown): void {
	threads.parentPort = port;
	threads.workerData = workerData;
	syncBuiltinESMExports();
}

async function answer(port: FakePort, request: unknown): Promise<unknown> {
	port.postMessage.mockClear();
	port.emit('message', request);
	await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalled());
	return port.postMessage.mock.calls[0];
}

afterEach(() => {
	pretendWorker(null, null);
	vi.resetModules();
});

describe('práce s PDF ve workeru', () => {
	it('přečte přílohy, vymění jednu a chybu pdf-lib vrátí jako odpověď', async () => {
		const port = new FakePort();
		pretendWorker(port, MAX_ISDOC_BYTES);
		await import('../worker.ts');
		const bytes = await pdfWithIsdoc(MINIMAL_ISDOC);

		expect(await answer(port, { read: bytes })).toEqual([
			{
				result: {
					signed: false,
					attachments: [
						{
							content: ENCODER.encode(MINIMAL_ISDOC),
							replaceable: true,
						},
					],
				},
			},
			[],
		]);
		const [rewritten] = (await answer(port, { rewrite: bytes, index: 0, xml: '<Nove/>' })) as [
			{ result: Uint8Array },
		];
		const reread = await answer(port, { read: rewritten.result });
		expect(reread).toEqual([
			{
				result: {
					signed: false,
					attachments: [
						{
							content: ENCODER.encode('<Nove/>'),
							replaceable: true,
						},
					],
				},
			},
			[],
		]);
		expect(await answer(port, { read: ENCODER.encode('tohle PDF neni') })).toEqual([
			{ error: new Error('Failed to parse PDF document (line:0 col:28 offset=14): No PDF header found') },
			[],
		]);
	});

	it('mimo worker nebo bez stropu příloh odmítne běžet', async () => {
		const refused = new Error('Práce s PDF běží jen jako worker se stropem příloh.');
		pretendWorker(null, MAX_ISDOC_BYTES);
		await expect(import('../worker.ts')).rejects.toEqual(refused);
		vi.resetModules();

		pretendWorker(new FakePort(), null);
		await expect(import('../worker.ts')).rejects.toEqual(refused);
	});
});

describe('načtení PDF přes worker', () => {
	it('vrátí bajty i přílohy a vyměněnou přílohu přečte zpátky', async () => {
		const bytes = await pdfWithIsdoc(MINIMAL_ISDOC);
		const pdf = await loadPdf(bytes);
		const changed = MINIMAL_ISDOC.replace('<ID>20260001</ID>', '<ID>20260002</ID>');

		const saved = await replaceIsdoc(pdf, changed);
		const { xml } = await readIsdoc(await loadPdf(saved));

		expect([pdf.bytes, pdf.signed, xml]).toEqual([bytes, false, changed]);
		expect((await PDFDocument.load(saved)).getPageCount()).toBe(1);
	});

	it('práci, která nedoběhne do třiceti sekund, ukončí a další PDF načte novým workerem', async () => {
		const bytes = await pdfWithIsdoc(MINIMAL_ISDOC);
		const silent = vi.spyOn(Worker.prototype, 'postMessage').mockImplementation(() => undefined);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		let outcome: Promise<unknown>;
		try {
			outcome = rejection(loadPdf(bytes));
			await vi.advanceTimersByTimeAsync(29_999);
			expect(silent.mock.calls.length).toBe(1);
			await vi.advanceTimersByTimeAsync(1);
		} finally {
			vi.useRealTimers();
			silent.mockRestore();
		}
		expect(await outcome).toEqual(new Error(CRASHED, { cause: new Error('práce s PDF nedoběhla') }));
		const pdf = await loadPdf(bytes);

		expect((await readIsdoc(pdf)).xml).toBe(MINIMAL_ISDOC);
	});

	it('pád workeru ohlásí jako chybu té práce a další PDF načte', async () => {
		const bytes = await pdfWithIsdoc(MINIMAL_ISDOC);
		const crash = vi.spyOn(Worker.prototype, 'postMessage').mockImplementation(function (this: Worker) {
			setImmediate(() => this.emit('error', new Error('Worker spadl.')));
		});
		try {
			await expect(loadPdf(bytes)).rejects.toEqual(new Error(CRASHED, { cause: new Error('Worker spadl.') }));
		} finally {
			crash.mockRestore();
		}
		const pdf = await loadPdf(bytes);

		expect((await readIsdoc(pdf)).xml).toBe(MINIMAL_ISDOC);
	});
});
