import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

import { z } from '~/utils/zod';

// Most staví `tools/testing/test-contracts.ts` z `desktop/test/contract-bridge.ts`.
const bridge = z.string().min(1).parse(process.env.FAKTURIAN_CONTRACT_BRIDGE);
const fixtures = resolve('desktop/test/fixtures');

// Odmítnutí backendu vyletí jako `Error` s jeho hláškou, aby ho test porovnal celým řetězcem.
export function realBackend(request: Record<string, unknown>): unknown {
	const answer = spawnSync(process.execPath, [bridge], {
		input: JSON.stringify(request),
		encoding: 'utf8',
		timeout: 60_000,
		maxBuffer: 8 * 1024 * 1024,
	});
	if (answer.error) throw answer.error;
	if (answer.status !== 0) throw new Error(answer.stderr.trim());
	return JSON.parse(answer.stdout);
}

export function fixture(name: string): string {
	return join(fixtures, name);
}

export function sample(name: string): string {
	return readFileSync(fixture(name), 'utf8');
}

/** Cizí ISDOC zabalený do PDF, jak ho posílá jiný software — jediný tvar, který import bere. */
export function foreignPdf(path: string, xml: string): string {
	realBackend({
		command: 'wrap',
		xml,
		path,
	});
	return path;
}

const replySchema = z.union([z.strictObject({ ok: z.unknown() }), z.strictObject({ error: z.string() })]);

/**
 * Jeden proces mostu pro celý test. `store` si mezi čtením a zápisem souboru pamatuje jeho otisk,
 * takže soubory vaultu nejdou přes `realBackend()`, který pro každé volání pouští nový proces.
 */
export function backendSession(): {
	call: (request: Record<string, unknown>) => Promise<unknown>;
	close: () => void;
} {
	const child = spawn(process.execPath, [bridge, '--serve'], {
		stdio: ['pipe', 'pipe', 'inherit'],
	});
	const waiting: ((line: string) => void)[] = [];
	createInterface({ input: child.stdout }).on('line', (line) => waiting.shift()?.(line));
	return {
		call: (request) => {
			const { promise, resolve: answered } = Promise.withResolvers<string>();
			waiting.push(answered);
			child.stdin.write(`${JSON.stringify(request)}\n`);
			return promise.then((line) => {
				const reply = replySchema.parse(JSON.parse(line));
				// Chyba jde jako řetězec, stejně jako přes IPC.
				if ('error' in reply) return Promise.reject(reply.error);
				return reply.ok;
			});
		},
		close: () => child.stdin.end(),
	};
}
