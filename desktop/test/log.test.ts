import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loggedLines } from './support.ts';

import { log } from '../log.ts';

let home = '';
const realHome = process.env.HOME;

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), 'fakturian-log-'));
	process.env.HOME = home;
});

afterEach(async () => {
	if (realHome === undefined) delete process.env.HOME;
	else process.env.HOME = realHome;
	await rm(home, { recursive: true });
});

describe('log appky', () => {
	it('řádek začíná časem v UTC a log leží tam, kde ho macOS čeká', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime('2026-10-18T12:34:56.789Z');
		try {
			await log('MCP socket se nepodařilo otevřít.');
		} finally {
			vi.useRealTimers();
		}

		const text = await readFile(join(home, 'Library', 'Logs', 'com.fakturian.desktop', 'Fakturian.log'), 'utf8');
		expect(text).toBe('2026-10-18T12:34:56.789Z MCP socket se nepodařilo otevřít.\n');
	});

	it('další zpráva se připíše na konec', async () => {
		await log('první');
		await log('druhá');

		expect(await loggedLines(home)).toEqual(['první', 'druhá']);
	});

	it('nepovedený zápis jde na stderr a nic neshodí', async () => {
		const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
		await writeFile(join(home, 'Library'), '');
		await expect(log('první')).resolves.toBe(undefined);

		delete process.env.HOME;
		await expect(log('druhá')).resolves.toBe(undefined);

		expect(stderr.mock.calls.map(([text]) => text)).toEqual(['první\n', 'druhá\n']);
	});

	it('když selže i stderr, log nic neshodí', async () => {
		const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => {
			throw new Error('EPIPE: broken pipe, write');
		});
		delete process.env.HOME;

		await expect(log('zpráva')).resolves.toBe(undefined);
		expect(stderr).toHaveBeenCalledTimes(1);
	});
});
