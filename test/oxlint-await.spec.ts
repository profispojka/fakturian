import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

import { awaitStandalone } from '../tools/lint/oxlint-fakturian';

// `RuleTester` si `describe`/`it` bere ze statických vlastností, ne z globálů, a `globals: true` sada nemá.
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
	languageOptions: {
		parserOptions: {
			lang: 'ts',
		},
	},
});

// Skutečný linter, ne `create()` nad vymyšleným uzlem: co pravidlo hlídá, závisí na tvaru AST od oxlintu
// (závorky kolem výrazu v něm žádný uzel nemají).
tester.run('await-standalone', awaitStandalone, {
	valid: [
		{
			name: 'samostatný příkaz',
			code: 'async function f() { await g(); }',
		},
		{
			name: 'inicializátor konstanty',
			code: 'async function f() { const a = await g(); return a; }',
		},
		{
			name: 'přiřazení do refu',
			code: 'async function f() { stav.value = await g(); }',
		},
		{
			name: 'závorky navíc nevadí',
			code: 'async function f() { const a = (await g()); return a; }',
		},
		{
			name: 'for await není await výraz',
			code: 'async function f() { for await (const x of s) h(x); }',
		},
	],
	invalid: [
		{
			name: 'return',
			code: 'async function f() { return await g(); }',
			errors: 1,
		},
		{
			name: 'zkrácené tělo šipkové funkce',
			code: 'const f = async () => await g();',
			errors: 1,
		},
		{
			name: 'negace v podmínce',
			code: 'async function f() { if (!(await g())) return; }',
			errors: 1,
		},
		{
			name: 'argument volání',
			code: 'async function f() { return h(await g()); }',
			errors: 1,
		},
		{
			name: 'porovnání',
			code: 'async function f() { return (await g()) === true; }',
			errors: 1,
		},
		{
			name: 'větev ternárního výrazu',
			code: 'async function f() { return c ? await g() : null; }',
			errors: 1,
		},
		{
			name: 'v poli',
			code: 'async function f() { return [await g(), 1]; }',
			errors: 1,
		},
		{
			name: 'zdroj for..of',
			code: 'async function f() { for (const x of await g()) h(x); }',
			errors: 1,
		},
		{
			name: 'oba vnořené naráz',
			code: 'async function f() { const a = await h(await g()); return a; }',
			errors: 1,
		},
		{
			name: 'přiřazení uvnitř výrazu',
			code: 'async function f() { h((x = await g())); }',
			errors: 1,
		},
	],
});
