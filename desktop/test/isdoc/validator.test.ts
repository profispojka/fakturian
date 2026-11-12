import { EventEmitter } from 'node:events';
import { createRequire, syncBuiltinESMExports } from 'node:module';

import { afterEach, describe, expect, it, vi } from 'vitest';

import SCHEMA from '../../isdoc/isdoc-invoice-6.0.2.xsd';
import { fixture } from '../isdoc.ts';

// Worker běží mimo dosah pokrytí, takže se modul validátoru pouští ve vlákně testu. Port se podvrhne
// přímo v `worker_threads`: lepidlo xmllint si ho bere přes `require`, kam `vi.mock` nesahá.
const threads: { parentPort: unknown; workerData: unknown } = createRequire(import.meta.url)('node:worker_threads');

class FakePort extends EventEmitter {
	postMessage = vi.fn<(message: unknown, transfer: unknown[]) => void>();
}

function pretendWorker(port: FakePort | null, workerData: unknown): void {
	threads.parentPort = port;
	threads.workerData = workerData;
	syncBuiltinESMExports();
}

async function answer(port: FakePort, xml: string): Promise<unknown> {
	port.postMessage.mockClear();
	port.emit('message', xml);
	await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalled(), { timeout: 10_000 });
	return port.postMessage.mock.calls[0];
}

afterEach(() => {
	pretendWorker(null, null);
	vi.resetModules();
});

describe('validátor ISDOC ve workeru', () => {
	it('platný doklad ohlásí nulovým kódem a vadný s hláškou libxml2', async () => {
		const port = new FakePort();
		pretendWorker(port, SCHEMA);
		await import('../../isdoc/validator.ts');

		expect(await answer(port, await fixture('foreign-document.isdoc'))).toEqual([
			{
				code: 0,
				stderr: 'invoice.isdoc validates\n',
			},
			[],
		]);
		expect(await answer(port, '<Invoice/>')).toEqual([
			{
				code: 3,
				stderr: expect.stringMatching(
					/^invoice\.isdoc:1: Schemas validity error : Element 'Invoice': No matching global declaration available for the validation root\.\n/,
				),
			},
			[],
		]);
	});

	it('mimo worker nebo bez schématu odmítne běžet', async () => {
		const refused = new Error('Validátor ISDOC běží jen jako worker se schématem.');
		pretendWorker(null, SCHEMA);
		await expect(import('../../isdoc/validator.ts')).rejects.toEqual(refused);
		vi.resetModules();

		pretendWorker(new FakePort(), null);
		await expect(import('../../isdoc/validator.ts')).rejects.toEqual(refused);
	});
});
