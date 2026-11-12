import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

import { noContractMock } from '../tools/lint/oxlint-fakturian';

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

tester.run('no-contract-mock', noContractMock, {
	valid: [
		{
			name: 'okraj appky',
			code: "vi.mock('vue-echarts', () => ({ default: Chart }));",
		},
		{
			name: 'color mode',
			code: "mockNuxtImport('useColorMode', () => mode);",
		},
		{
			name: 'jiný composable',
			code: "vi.mock('~/composables/useVault');",
		},
	],
	invalid: [
		{
			name: 'useVaultFile',
			code: "vi.mock('~/composables/useVaultFile', () => ({}));",
			errors: 1,
		},
		{
			name: 'useVaultFile s příponou',
			code: "vi.doMock('../src/composables/useVaultFile.ts');",
			errors: 1,
		},
		{
			name: 'schéma',
			code: "vi.mock('~/schemas/invoices');",
			errors: 1,
		},
		{
			name: 'schéma přes import()',
			code: "vi.mock(import('~/schemas/payments'), () => ({}));",
			errors: 1,
		},
		{
			name: 'auto-import podle jména',
			code: "mockNuxtImport('useVaultFile', () => fake);",
			errors: 1,
		},
		{
			name: 'auto-import podle funkce',
			code: 'mockNuxtImport(useVaultFile, () => fake);',
			errors: 1,
		},
	],
});
