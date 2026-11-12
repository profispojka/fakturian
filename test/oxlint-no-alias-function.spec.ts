import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

import { noAliasFunction } from '../tools/lint/oxlint-fakturian';

// `RuleTester` si `describe`/`it` bere ze statických vlastností, ne z globálů.
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
	languageOptions: {
		parserOptions: {
			lang: 'ts',
		},
	},
});

tester.run('no-alias-function', noAliasFunction, {
	valid: [
		{
			name: 'přidaný argument',
			code: "const onPick = (item) => emit('pick', item);",
		},
		{
			name: 'jiné pořadí',
			code: 'function swap(a, b) { return pair(b, a); }',
		},
		{
			name: 'metoda parametru',
			code: 'const text = (x) => x.toString();',
		},
		{
			name: 'víc příkazů',
			code: 'async function save() { busy = true; await write(); }',
		},
		{
			name: 'odvozený argument',
			code: 'const label = (n) => format(n + 1);',
		},
		{
			name: 'callback nepojmenovaný',
			code: 'items.map((i) => format(i));',
		},
		{
			name: 'výchozí hodnota',
			code: 'function f(a = 1) { return g(a); }',
		},
		{
			name: 'přetížení nese podpis',
			code: 'function formRef<T>(v: T): Ref<T>; function formRef(v: object): Ref<object> { return ref(v); }',
		},
		{
			name: 'exportované přetížení',
			code: 'export function f(v: string): string; export function f(v: unknown): unknown { return g(v); }',
		},
	],
	invalid: [
		{
			name: 'settle',
			code: 'async function settle() { await flushPromises(); }',
			errors: 1,
		},
		{
			name: 'return',
			code: 'function run(a, b) { return exec(a, b); }',
			errors: 1,
		},
		{
			name: 'šipka se zkráceným tělem',
			code: 'const dialogReturns = (path) => backend.dialog.push(path);',
			errors: 1,
		},
		{
			name: 'funkční výraz',
			code: 'const clear = function () { store.clear(); };',
			errors: 1,
		},
		{
			name: 'rest parametry',
			code: 'const log = (...args) => write(...args);',
			errors: 1,
		},
	],
});
