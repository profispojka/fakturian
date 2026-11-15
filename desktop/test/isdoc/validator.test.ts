import { EventEmitter } from 'node:events';
import { createRequire, syncBuiltinESMExports } from 'node:module';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import SCHEMA from '../../isdoc/isdoc-invoice-6.0.2.xsd';
import { fixture } from '../isdoc.ts';

import type { Validation } from '../../isdoc/validator.ts';

// Worker běží mimo dosah pokrytí, takže se kontrola pouští ve vlákně testu. Lepidlo xmllint si při
// načtení registruje posluchače na `parentPort`, který ve vlákně testu není; podvrhne se v `worker_threads`,
// kam si ho bere přes `require` a kam `vi.mock` nesahá.
const threads: { parentPort: unknown } = createRequire(import.meta.url)('node:worker_threads');

let validate: (task: { xml: string; schema: string }) => Promise<Validation>;

beforeAll(async () => {
	threads.parentPort = new EventEmitter();
	syncBuiltinESMExports();
	({ default: validate } = await import('../../isdoc/validator.ts'));
});

afterAll(() => {
	threads.parentPort = null;
	syncBuiltinESMExports();
});

describe('validátor ISDOC ve workeru', () => {
	it('platný doklad ohlásí nulovým kódem a vadný s hláškou libxml2', async () => {
		expect(await validate({ xml: await fixture('foreign-document.isdoc'), schema: SCHEMA })).toEqual({
			code: 0,
			stderr: 'invoice.isdoc validates\n',
		});
		expect(await validate({ xml: '<Invoice/>', schema: SCHEMA })).toEqual({
			code: 3,
			stderr: expect.stringMatching(
				/^invoice\.isdoc:1: Schemas validity error : Element 'Invoice': No matching global declaration available for the validation root\.\n/,
			),
		});
	});
});
