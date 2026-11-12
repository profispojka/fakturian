import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

import { exactText } from '../tools/lint/oxlint-fakturian';

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

tester.run('exact-text', exactText, {
	valid: [
		{
			name: 'toBe',
			code: "expect(text).toBe('Uloženo');",
		},
		{
			name: 'chyba celou hláškou',
			code: "expect(() => f()).toThrow(new Error('Plný disk'));",
		},
		{
			name: 'odmítnutí celou hláškou',
			code: "await expect(p).rejects.toThrow(new Error('Plný disk'));",
		},
		{
			name: 'bez argumentu',
			code: 'expect(() => f()).toThrow();',
		},
		{
			name: 'objekt',
			code: 'expect(x).toMatchObject({ a: 1 });',
		},
	],
	invalid: [
		{
			name: 'toMatch',
			code: 'expect(text).toMatch(/Uloženo/);',
			errors: 1,
		},
		{
			name: 'stringContaining',
			code: "expect(x).toEqual({ title: expect.stringContaining('Ulož') });",
			errors: 1,
		},
		{
			name: 'not.stringMatching',
			code: 'expect(x).toEqual({ title: expect.not.stringMatching(/^Zk/) });',
			errors: 1,
		},
		{
			name: 'toThrow s kusem textu',
			code: "expect(() => f()).toThrow('Plný');",
			errors: 1,
		},
		{
			name: 'toThrow se vzorem',
			code: 'expect(() => f()).toThrow(/Plný/);',
			errors: 1,
		},
		{
			name: 'toThrowError',
			code: "expect(() => f()).toThrowError('Plný');",
			errors: 1,
		},
		{
			name: 'rejects',
			code: 'await expect(p).rejects.toThrow(`Plný disk`);',
			errors: 1,
		},
	],
});
