import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Hlavní proces Electronu: Node bez DOM. Šablony Typstu a XSD se importují jako text, stejně jako je
// zabalí esbuild v `tools/desktop/build.ts`.
export default defineConfig({
	resolve: {
		alias: {
			'~': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	plugins: [
		{
			name: 'text-assets',
			async load(id) {
				if (!/\.(typ|xsd)$/.test(id)) return null;
				const text = await readFile(id, 'utf8');
				return `export default ${JSON.stringify(text)};`;
			},
		},
	],
	test: {
		name: 'desktop',
		environment: 'node',
		include: ['desktop/test/**/*.test.ts'],
		globalSetup: ['./test/setup/timezone.ts'],
		restoreMocks: true,
		// veraPDF startuje JVM a generativní testy sázejí desítky PDF; souběh s projektem `nuxt`
		// je zdrží přes výchozích 5 s.
		testTimeout: 30_000,
		allowOnly: false,
		passWithNoTests: false,
	},
});
