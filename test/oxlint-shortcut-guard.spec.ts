import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

import { shortcutGuard } from '../tools/lint/oxlint-fakturian';

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

const GUARD = `if (document.querySelector('[data-slot="overlay"]')) return;`;

tester.run('shortcut-guard', shortcutGuard, {
	valid: [
		{
			name: 'šipková funkce',
			code: `defineShortcuts({ meta_s: { usingInput: true, handler: () => { ${GUARD} save(); } } });`,
		},
		{
			name: 'funkční výraz a víc zkratek',
			code:
				`defineShortcuts({ meta_p: { usingInput: true, handler: function () { ${GUARD} open(); } },` +
				` meta_n: { handler: () => {\n ${GUARD}\n create(); }, usingInput: true } });`,
		},
		{
			name: 'jiná funkce',
			code: 'registerShortcuts({ meta_s: () => save() });',
		},
	],
	invalid: [
		{
			name: 'holá funkce',
			code: 'defineShortcuts({ meta_s: () => save() });',
			errors: 1,
		},
		{
			name: 'bez usingInput',
			code: `defineShortcuts({ meta_s: { handler: () => { ${GUARD} save(); } } });`,
			errors: 1,
		},
		{
			name: 'usingInput false',
			code: `defineShortcuts({ meta_s: { usingInput: false, handler: () => { ${GUARD} save(); } } });`,
			errors: 1,
		},
		{
			name: 'bez plachty',
			code: 'defineShortcuts({ meta_s: { usingInput: true, handler: () => { save(); } } });',
			errors: 1,
		},
		{
			name: 'plachta až druhá',
			code: `defineShortcuts({ meta_s: { usingInput: true, handler: () => { blur(); ${GUARD} save(); } } });`,
			errors: 1,
		},
		{
			name: 'zkrácené tělo',
			code: 'defineShortcuts({ meta_s: { usingInput: true, handler: () => save() } });',
			errors: 1,
		},
		{
			name: 'bez handleru',
			code: 'defineShortcuts({ meta_s: { usingInput: true } });',
			errors: 1,
		},
		{
			name: 'rozprostřené volby',
			code: 'defineShortcuts({ ...shared });',
			errors: 1,
		},
	],
});
