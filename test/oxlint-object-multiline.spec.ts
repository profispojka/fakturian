import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

import { objectMultiline } from '../tools/lint/oxlint-fakturian';

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

tester.run('object-multiline', objectMultiline, {
	valid: [
		{
			name: 'prázdný objekt',
			code: 'const a = {};',
		},
		{
			name: 'rozepsaný objekt',
			code: 'const a = {\n\tb: 1,\n\tc: 2,\n};',
		},
		{
			name: 'destrukturování není objekt',
			code: 'const { b, c } = a;',
		},
		{
			name: 'jedna vlastnost v argumentu',
			code: 'go({ replace: true });',
		},
		{
			name: 'jedna vlastnost v poli',
			code: 'const a = {\n\tb: [{ c: 1 }],\n};',
		},
	],
	invalid: [
		{
			name: 'návratová hodnota',
			code: 'function f() { return { id: 1, name: "" }; }',
			output: 'function f() { return { \nid: 1, name: "" }; }',
			errors: 1,
		},
		{
			name: 'vnořený objekt na jednom řádku',
			code: 'const a = {\n\tb: { c: 1 },\n};',
			output: 'const a = {\n\tb: { \nc: 1 },\n};',
			errors: 1,
		},
	],
});
