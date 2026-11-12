import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { requireTsMutations } from '../../tools/mutation/mutation-result.ts';

const reporter = resolve('tools/testing/required-tests-reporter.ts');
const vitest = resolve('node_modules/vitest/vitest.mjs');
const ts = (status: string) => ({
	files: {
		'source.ts': {
			mutants: [
				{
					status,
				},
			],
		},
	},
});

test('mutační report musí být úplný a bez timeoutů', () => {
	assert.doesNotThrow(() => requireTsMutations(ts('Killed')));
	assert.doesNotThrow(() => requireTsMutations(ts('CompileError')));
	for (const status of ['Survived', 'NoCoverage', 'Timeout', 'Pending', 'Ignored']) {
		assert.throws(() => requireTsMutations(ts(status)), /Mutace nejsou/);
	}
	assert.throws(() => requireTsMutations({ files: {} }), /Mutace nejsou/);
});

const cases: [string, string, boolean][] = [
	['úspěšný test', 'test("ok", () => expect(2 + 2).toBe(4))', true],
	['chybná aserce', 'test("bad", () => expect(2 + 2).toBe(5))', false],
	['skip', 'test.skip("skip", () => {})', false],
	['todo', 'test.todo("todo")', false],
	['only', 'test.only("only", () => {})', false],
	['prázdná sada', '', false],
	['chyba hooku', 'afterAll(() => { throw Error("hook") }); test("ok", () => {})', false],
	['opakování', 'let count = 0; test("retry", { retry: 1 }, () => expect(++count).toBe(2))', false],
	[
		'neošetřená výjimka',
		'test("error", async () => { process.emit("unhandledRejection", Error("unhandled"), Promise.resolve()); })',
		false,
	],
];

for (const [name, source, passes] of cases) {
	test(`brána: ${name}`, () => {
		const directory = mkdtempSync(join(tmpdir(), 'fakturian-gate-'));
		try {
			writeFileSync(
				join(directory, 'vitest.config.ts'),
				`export default ${JSON.stringify({
					test: {
						globals: true,
						include: ['probe.test.ts'],
						allowOnly: false,
						passWithNoTests: false,
						reporters: ['default', reporter],
					},
				})}`,
			);
			writeFileSync(join(directory, 'probe.test.ts'), source);
			const result = spawnSync(
				process.execPath,
				[vitest, 'run', '--root', directory, '--config', join(directory, 'vitest.config.ts')],
				{
					encoding: 'utf8',
					timeout: 30_000,
				},
			);
			assert.ifError(result.error);
			assert.equal(result.status === 0, passes, result.stdout + result.stderr);
		} finally {
			rmSync(directory, {
				recursive: true,
				force: true,
			});
		}
	});
}
