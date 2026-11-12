import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

export default {
	testRunner: 'vitest',
	// Vyjmenovat plugin je nutnost, ne pořádkumilovnost: výchozí hodnota je glob `@stryker-mutator/*`
	// hledaný z pracovní kopie v `.stryker-tmp`, a ta v pnpm stromu na symlinky v kořenovém
	// `node_modules` nedosáhne — běh pak padá na „Cannot find TestRunner plugin »vitest«.
	plugins: ['@stryker-mutator/vitest-runner'],
	vitest: {
		configFile: 'vitest.mutation.config.ts',
	},
	mutate: [
		'src/services/ares.ts',
		'src/utils/crud.ts',
		'src/utils/date.ts',
		'src/utils/errors.ts',
		'src/utils/fio.ts',
		'src/constants/icons.ts',
		'src/utils/numbering.ts',
		'src/utils/locales.ts',
		'src/constants/quicknew.ts',
		'src/schemas/invoices.ts',
		'src/schemas/mcp.ts',
		'src/schemas/import.ts',
		'src/utils/import.ts',
		'src/schemas/payments.ts',
		'src/schemas/vault-data.ts',
		'src/services/invoices.ts',
		'src/services/import.ts',
		'desktop/**/*.ts',
		'!desktop/test/**',
		'!desktop/examples/**',
		'!desktop/**/*.d.ts',
		// Vstup Electronu Vitest nespustí, mutanti by v něm jen přežili.
		'!desktop/main.ts',
		// Validátor ISDOC běží ve vlákně workeru, kam aktivní mutant nedosáhne; instrumentovaný zdroj ho
		// navíc shodí a každá kontrola dokladu pak čeká na limit.
		'!desktop/isdoc/validator.ts',
	],
	// `perTest` potřebuje, aby runner uměl spustit jen dotčené testy — vitest to umí a bez toho by
	// každý mutant znamenal celou sadu.
	coverageAnalysis: 'perTest',
	// Výchozí je počet jader minus jedna, což vedle dalších běhů položí stroj do swapu.
	concurrency: 3,
	// Výchozích 5 s nestačí mutantům, které na runneru zabije až pomalý test s Typstem nebo veraPDF.
	timeoutMS: 30_000,
	reporters: ['html', 'json', 'clear-text', 'progress'],
	jsonReporter: {
		fileName: 'reports/mutation/mutation.json',
	},
	htmlReporter: {
		fileName: 'reports/mutation/index.html',
	},
	tempDirName: '.stryker-tmp',
	cleanTempDir: true,
	thresholds: {
		high: 100,
		low: 100,
		break: 100,
	},
	// Stryker si projekt kopíruje do `.stryker-tmp/sandbox-*`; výstupy buildu by se vlekly ke každému běhu.
	ignorePatterns: ['.output', 'dist', 'coverage', 'showcase', 'reports', '.agents', '.codex', '.claude', '!.nuxt'],
} satisfies PartialStrykerOptions;
