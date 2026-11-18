import { ChildProcess, fork } from 'node:child_process';
import { once } from 'node:events';
import { buffer } from 'node:stream/consumers';
import { fileURLToPath } from 'node:url';
import { createDeflate, deflateSync } from 'node:zlib';

import { utilityProcess } from 'electron';
import { PDFDocument, PDFName } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MINIMAL_ISDOC } from './invoices.ts';
import { pdfWithIsdoc, samplePdf } from './pdfs.ts';
import { rejection } from './support.ts';

import { MAX_ISDOC_BYTES } from '../isdoc/mod.ts';
import { runPdfTask } from '../pdf-document.ts';
import { loadPdf, readIsdoc, replaceIsdoc } from '../pdf.ts';

const actual = await vi.importActual('node:child_process');

vi.mock('node:child_process', async (importOriginal) => {
	const original = await importOriginal();
	return {
		...original,
		fork: vi.fn(original.fork),
	};
});

// `utilityProcess` Electronu nahradí podproces Node, kterému `parent-port.ts` podvrhne `process.parentPort`.
vi.mock('electron', () => ({
	utilityProcess: {
		fork: vi.fn(),
	},
}));

const ENCODER = new TextEncoder();
const CRASHED = 'PDF nejde rozbalit v rozumném čase ani paměti — takhle doklad nevypadá';
const NOT_STARTED = 'Fakturian nedokázal spustit čtení PDF — zkus ho restartovat';
const MIB = 1024 * 1024;
const PDF_PROCESS = fileURLToPath(new URL('../pdf-process.ts', import.meta.url));
const PARENT_PORT = fileURLToPath(new URL('./parent-port.ts', import.meta.url));

afterEach(() => {
	Reflect.deleteProperty(process, 'type');
	vi.resetModules();
});

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

describe('práce s PDF v podprocesu', () => {
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

	it('pozná podpisové pole vnořené v poli mezi jinými poli formuláře', async () => {
		const pdf = await samplePdf();
		pdf.catalog.set(
			PDFName.of('AcroForm'),
			pdf.context.obj({
				Fields: [{ FT: 'Tx' }, { FT: 'Sig' }],
			}),
		);
		const bytes = await pdf.save();

		const answer = await runPdfTask({
			read: bytes,
			budget: MAX_ISDOC_BYTES,
		});

		expect(answer).toEqual({
			result: {
				signed: true,
				attachments: [],
			},
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

describe('načtení PDF přes podproces', () => {
	it('vrátí bajty i přílohy a vyměněnou přílohu přečte zpátky', async () => {
		const bytes = await pdfWithIsdoc(MINIMAL_ISDOC);
		const pdf = await loadPdf(bytes);
		const changed = MINIMAL_ISDOC.replace('<ID>20260001</ID>', '<ID>20260002</ID>');

		const saved = await replaceIsdoc(pdf, changed);
		const { xml } = await readIsdoc(await loadPdf(saved));
		const reloaded = await PDFDocument.load(saved);

		expect([pdf.bytes, pdf.signed, xml]).toEqual([bytes, false, changed]);
		expect(reloaded.getPageCount()).toBe(1);
		expect(fork).toHaveBeenCalledWith(PDF_PROCESS, {
			serialization: 'advanced',
			execArgv: ['--max-old-space-size=512'],
		});
	});

	it('chybu pdf-lib vrátí tak, jak přišla', async () => {
		await expect(loadPdf(ENCODER.encode('tohle PDF neni'))).rejects.toEqual(
			new Error('Failed to parse PDF document (line:0 col:28 offset=14): No PDF header found'),
		);
	});

	it('proud objektů, který se rozbalí přes 1 GB, zabije podproces, appka žije dál', async () => {
		const bomb = await objectStreamBomb(1536);

		const error = await rejection(loadPdf(bomb));
		const { xml } = await readIsdoc(await loadPdf(await pdfWithIsdoc(MINIMAL_ISDOC)));

		expect(error).toEqual(new Error(CRASHED, { cause: new Error('podproces PDF skončil s kódem null') }));
		expect(xml).toBe(MINIMAL_ISDOC);
	});

	it('PDF s miliony objektů přeteče haldu jen podprocesu', async () => {
		const flood = manyObjects(3_000_000);

		const error = await rejection(loadPdf(flood));
		const { xml } = await readIsdoc(await loadPdf(await pdfWithIsdoc(MINIMAL_ISDOC)));

		expect(error).toEqual(new Error(CRASHED, { cause: expect.any(Error) }));
		expect(xml).toBe(MINIMAL_ISDOC);
	});

	it('práci, která nedoběhne do deseti sekund, ukončí i s podprocesem', async () => {
		const { loadPdf: freshLoad } = await import('../pdf.ts');
		const bytes = await pdfWithIsdoc(MINIMAL_ISDOC);
		await freshLoad(bytes);
		const running = vi.mocked(fork).mock.results[0]?.value as ChildProcess;
		const silent = vi.spyOn(running, 'send').mockReturnValueOnce(true);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		let outcome: Promise<unknown>;
		try {
			outcome = rejection(freshLoad(bytes));
			await vi.advanceTimersByTimeAsync(9_999);
			expect(silent).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(1);
		} finally {
			vi.useRealTimers();
		}
		const error = await outcome;
		const { xml } = await readIsdoc(await freshLoad(bytes));

		expect(error).toEqual(new Error(CRASHED, { cause: new Error('podproces PDF skončil s kódem null') }));
		expect(xml).toBe(MINIMAL_ISDOC);
	});

	it('nečinný podproces nedrží proces naživu a hotová práce po sobě nenechá posluchače ani časovač', async () => {
		const unref = vi.spyOn(ChildProcess.prototype, 'unref');
		const { loadPdf: freshLoad } = await import('../pdf.ts');
		const bytes = await pdfWithIsdoc(MINIMAL_ISDOC);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		try {
			await freshLoad(bytes);
			const child = vi.mocked(fork).mock.results[0]?.value as ChildProcess;
			const listeners = [child.listenerCount('message'), child.listenerCount('exit')];
			await freshLoad(bytes);
			await freshLoad(bytes);

			expect([child.listenerCount('message'), child.listenerCount('exit')]).toEqual(listeners);
			expect(listeners[0]).toBe(0);
			expect(vi.getTimerCount()).toBe(0);
			expect(unref).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('podproces, který nejde ani založit, ohlásí jako vadu appky', async () => {
		const { loadPdf: freshLoad } = await import('../pdf.ts');
		const crash = new Error('Podproces nejde založit.');
		vi.mocked(fork).mockImplementationOnce(() => {
			throw crash;
		});

		await expect(freshLoad(await pdfWithIsdoc(MINIMAL_ISDOC))).rejects.toEqual(
			new Error(NOT_STARTED, { cause: crash }),
		);
	});

	it('podproces, který se nespustí, ohlásí jako vadu appky a další PDF načte novým', async () => {
		const { loadPdf: freshLoad } = await import('../pdf.ts');
		vi.mocked(fork).mockImplementationOnce((_path, options) => actual.fork('/neexistuje/pdf-process.ts', options));
		const bytes = await pdfWithIsdoc(MINIMAL_ISDOC);

		const error = await rejection(freshLoad(bytes));
		const pdf = await freshLoad(bytes);

		expect(error).toEqual(new Error(NOT_STARTED, { cause: new Error('podproces PDF skončil s kódem 1') }));
		expect(pdf.bytes).toEqual(bytes);
	});

	it('v Electronu čte PDF přes `utilityProcess` a zaseknutou práci ukončí i s ním', async () => {
		process.type = 'browser';
		const children: ChildProcess[] = [];
		vi.mocked(utilityProcess.fork).mockImplementation((path, args, options) => {
			const child = actual.fork(path, args, {
				serialization: 'advanced',
				execArgv: ['--import', PARENT_PORT, ...(options?.execArgv ?? [])],
			});
			children.push(child);
			child.postMessage = vi.fn((message: unknown) => child.send(message));
			return child;
		});
		const { loadPdf: freshLoad } = await import('../pdf.ts');
		const bytes = await pdfWithIsdoc(MINIMAL_ISDOC);

		try {
			const pdf = await freshLoad(bytes);
			const { xml } = await readIsdoc(pdf);
			vi.mocked(children[0].postMessage).mockImplementationOnce(() => undefined);
			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
			let outcome: Promise<unknown>;
			try {
				outcome = rejection(freshLoad(bytes));
				await vi.advanceTimersByTimeAsync(10_000);
			} finally {
				vi.useRealTimers();
			}
			const error = await outcome;

			expect(xml).toBe(MINIMAL_ISDOC);
			expect(error).toEqual(new Error(CRASHED, { cause: new Error('podproces PDF skončil s kódem null') }));
			expect(children[0].postMessage).toHaveBeenCalledWith(expect.anything(), []);
			expect(utilityProcess.fork).toHaveBeenCalledWith(PDF_PROCESS, [], {
				serviceName: 'Fakturian PDF',
				execArgv: ['--max-old-space-size=512'],
			});
		} finally {
			for (const child of children) child.kill();
		}
	});
});
