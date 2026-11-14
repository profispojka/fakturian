import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

import { tailwindScales } from '../../tools/lint/oxlint-fakturian';

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
	languageOptions: {
		parserOptions: {
			lang: 'ts',
		},
	},
});

tester.run('tailwind-scales', tailwindScales, {
	valid: [
		{
			name: 'pojmenované utility',
			code: `const template = '<p class="text-stat rounded-row leading-prose text-ink-2">x</p>';`,
		},
		{
			name: 'hodnota bez odpovídajícího tokenu',
			code: `const template = '<p class="text-[9px]">x</p>';`,
		},
		{
			name: 'pojmenovaný zlom',
			code: `const template = '<div class="split:grid-cols-2 wide:grid-cols-3">x</div>';`,
		},
	],
	invalid: [
		{
			name: 'arbitrary text podle tokenu',
			code: `const template = '<p class="text-[18px]">x</p>';`,
			errors: [
				{
					message: 'text-[18px] → text-stat',
					line: 1,
					column: `const template = '<p class="`.length + 1,
				},
			],
		},
		{
			name: 'mrtvý zlom okna',
			code: `const template = '<div class="min-[760px]:grid-cols-2">x</div>';`,
			errors: [
				{
					message: 'min-[760px]: → smazat — vždycky pravda, okno se pod 760 px nezmenší',
					line: 1,
					column: `const template = '<div class="`.length + 1,
				},
			],
		},
	],
});
