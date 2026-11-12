import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

import { constantsDataOnly } from '../tools/lint/oxlint-fakturian';

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

tester.run('constants-data-only', constantsDataOnly, {
	valid: [
		{
			name: 'tabulka',
			code: "export const ICONS = [{ name: 'tag', label: 'Štítek' }] as const;",
		},
		{
			name: 'typ a enum',
			code: 'export type Kind = 1 | 2; export enum DocumentKind { Invoice = 1 }',
		},
	],
	invalid: [
		{
			name: 'deklarace funkce',
			code: 'export function normalize(x: string) { return x; }',
			errors: 1,
		},
		{
			name: 'šipková funkce',
			code: 'export const badge = (n: number) => String(n);',
			errors: 1,
		},
		{
			name: 'funkce v tabulce',
			code: 'export const ROUTES = { invoice: function () { return 1; } };',
			errors: 1,
		},
	],
});
