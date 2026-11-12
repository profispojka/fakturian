import { AsyncEntry } from '@napi-rs/keyring';
import { describe, expect, it, vi } from 'vitest';

import { closeServers, MockHttp, reroute } from './http.ts';

import { fioClearToken, fioFetch, fioHasToken, fioSetToken, keepTokenInMemory } from '../fio.ts';

const execFile = vi.hoisted(() => vi.fn());

vi.mock(import('node:child_process'), async (importOriginal) => {
	const original = await importOriginal();
	return {
		...original,
		execFile,
	};
});

const TOKEN = 'abcdefghij0123456789ABCDEFGHIJabcdefghij0123456789ABCDEFGHIJ0123';

describe('token jen v paměti (E2E)', () => {
	it('uloží, najde, použije a smaže token bez klíčenky i bez `security`', async () => {
		reroute('https://fioapi.fio.cz');
		const keychain = [
			vi.spyOn(AsyncEntry.prototype, 'getPassword'),
			vi.spyOn(AsyncEntry.prototype, 'setPassword'),
			vi.spyOn(AsyncEntry.prototype, 'deleteCredential'),
		];
		const server = await MockHttp.answering(
			200,
			JSON.stringify({
				accountStatement: {
					info: {
						currency: 'CZK',
					},
					transactionList: {
						transaction: [],
					},
				},
			}),
		);
		keepTokenInMemory();

		expect(await fioHasToken()).toBe(false);
		await expect(
			fioFetch({
				from: '2026-05-01',
				to: '2026-05-31',
			}),
		).rejects.toThrow(new Error('Není uložený Fio token.'));
		expect(await fioSetToken({ token: ` ${TOKEN} ` })).toBe(null);
		expect(await fioHasToken()).toBe(true);
		expect(
			await fioFetch({
				from: '2026-05-01',
				to: '2026-05-31',
			}),
		).toEqual([]);
		expect(await fioClearToken()).toBe(null);
		expect(await fioHasToken()).toBe(false);

		expect(server.paths).toEqual([`/v1/rest/periods/${TOKEN}/2026-05-01/2026-05-31/transactions.json`]);
		expect(keychain.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0]);
		expect(execFile).not.toHaveBeenCalled();
		await closeServers();
	});
});
