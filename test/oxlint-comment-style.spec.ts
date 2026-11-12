import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

import { commentStyle } from '../tools/lint/oxlint-fakturian';

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

tester.run('comment-style', commentStyle, {
	valid: [
		{
			name: 'dva řádky',
			code: "import a from 'a';\n\n// jedna\n// dvě\nconst b = a;",
		},
		{
			name: 'JSDoc na dva řádky',
			code: "import a from 'a';\n\n/**\n * jedna\n * dvě\n */\nconst b = a;",
		},
		{
			name: 'oddělené skupiny',
			code: "import a from 'a';\n\n// jedna\n// dvě\n\n// tři\nconst b = a;",
		},
		{
			name: 'komentář první deklarace',
			code: '// Proč zrovna jedna.\nconst a = 1;',
		},
		{
			name: 'direktiva Strykeru',
			code: "import a from 'a';\n\n// Stryker disable all: důvod\n// jedna\n// dvě\nconst b = a;",
		},
		// Direktiva se skládá, jinak by si ji vitest přečetl jako prostředí tohohle souboru.
		{
			name: 'prostředí vitestu',
			code: `// ${['@vitest', 'environment'].join('-')} nuxt\nimport a from 'a';`,
		},
		{
			name: 'shebang',
			code: '#!/usr/bin/env node\nconst a = 1;',
		},
		{
			name: 'pomlčka v textu',
			code: "import a from 'a';\n\n// a -- b\nconst b = a;",
		},
		{
			name: 'komentář uvnitř testu',
			code: "it('x', () => {\n\t// proč\n\tf();\n});",
		},
		{
			name: 'test bez komentáře',
			code: "const a = 1;\n\nit('x', () => {});",
		},
		{
			name: 'komentáře za kódem',
			code: "import a from 'a';\n\nf(1); // jedna\nf(2); // dvě\nf(3); // tři",
		},
		{
			name: 'dvouřádkový komentář první deklarace',
			code: '// Proč\n// zrovna jedna.\nconst a = 1;',
		},
	],
	invalid: [
		{
			name: 'tři řádky',
			code: "import a from 'a';\n\n// jedna\n// dvě\n// tři\nconst b = a;",
			errors: 1,
		},
		{
			name: 'JSDoc na tři řádky',
			code: "import a from 'a';\n\n/**\n * jedna\n * dvě\n * tři\n */\nconst b = a;",
			errors: 1,
		},
		{
			name: 'blok za řádkovým',
			code: "import a from 'a';\n\n// jedna\n/* dvě\n tři */\nconst b = a;",
			errors: 1,
		},
		{
			name: 'baner',
			code: "import a from 'a';\n\n// ── Součty ──\nconst b = a;",
			errors: 1,
		},
		{
			name: 'baner z rovnítek',
			code: "import a from 'a';\n\n// =====\nconst b = a;",
			errors: 1,
		},
		{
			name: 'úvod modulu před importem',
			code: "// Modul dělá tohle.\nimport a from 'a';",
			errors: 1,
		},
		{
			name: 'úvod modulu s mezerou',
			code: '/** Modul dělá tohle. */\n\nconst a = 1;',
			errors: 1,
		},
		{
			name: 'doc nad testem',
			code: "/** Hlídá, že x. */\nit('x', () => {});",
			errors: 1,
		},
		{
			name: 'řádkový nad describe',
			code: "const a = 1;\n\n// Hlídá x.\ndescribe('x', () => {});",
			errors: 1,
		},
		{
			name: 'nad it.each',
			code: "const a = 1;\n\n// Hlídá x.\nit.each([1])('x %s', () => {});",
			errors: 1,
		},
	],
});
