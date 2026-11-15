import { parentPort, workerData } from 'node:worker_threads';

import { readPdf, rewritePdf, type PdfContent, type PdfRequest } from './pdf-document.ts';

if (!parentPort || typeof workerData !== 'number')
	throw new Error('Práce s PDF běží jen jako worker se stropem příloh.');
const port = parentPort;
const budget = workerData;

// Chyba pdf-lib jde hlavnímu vláknu jako odpověď; událost `error` workeru znamená, že práce nedoběhla.
async function answer(request: PdfRequest): Promise<void> {
	let result: PdfContent | Uint8Array;
	try {
		if ('read' in request) result = await readPdf(request.read, budget);
		else result = await rewritePdf(request.rewrite, budget, request);
	} catch (error) {
		port.postMessage({ error }, []);
		return;
	}
	port.postMessage({ result }, []);
}

port.on('message', (request: PdfRequest) => {
	void answer(request);
});
