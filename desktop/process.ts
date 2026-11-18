import { Worker } from 'node:worker_threads';

import { runPdfTask, type PdfAnswer, type PdfRequest } from './pdf-document.ts';

// Rozbalené proudy leží v `ArrayBuffer` mimo haldu, kam strop haldy nedosáhne. Hlídač běží ve vlastním
// vlákně, protože hlavní vlákno podprocesu stojí v synchronním rozbalování pdf-lib.
const MEMORY_LIMIT = 1024 * 1024 * 1024;

// Naživu podproces drží kanál k rodiči, ne hlídač: se zavřeným kanálem skončí.
new Worker(
	`const { workerData } = require('node:worker_threads');
	setInterval(() => { if (process.memoryUsage.rss() > workerData) process.kill(process.pid, 'SIGKILL'); }, 50);`,
	{
		eval: true,
		workerData: MEMORY_LIMIT,
	},
).unref();

async function answer(request: PdfRequest, reply: (answer: PdfAnswer) => void): Promise<void> {
	const result = await runPdfTask(request);
	reply(result);
}

// V appce běží jako `utilityProcess` Electronu, v testech a ukázkách jako `child_process.fork` Node.
if (process.type === 'utility') {
	const port = process.parentPort;
	port.on('message', ({ data }: { data: PdfRequest }) => {
		void answer(data, (result) => port.postMessage(result));
	});
	port.postMessage('ready');
} else {
	process.on('message', (request: PdfRequest) => {
		void answer(request, (result) => process.send?.(result));
	});
	process.send?.('ready');
}
