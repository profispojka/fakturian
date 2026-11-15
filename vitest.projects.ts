import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { defineVitestProject } from '@nuxt/test-utils/config';
import { defineConfig, mergeConfig } from 'vitest/config';

export const unitProject = defineConfig({
	resolve: {
		alias: {
			'~': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	test: {
		name: 'unit',
		environment: 'node',
		include: ['test/unit/**/*.spec.ts', 'test/tooling/**/*.spec.ts'],
		globalSetup: ['./test/setup/timezone.ts'],
		setupFiles: ['./test/setup/properties.ts'],
		restoreMocks: true,
		allowOnly: false,
		passWithNoTests: false,
	},
});

export async function createNuxtProject() {
	const nuxtProject = await defineVitestProject({
		test: {
			name: 'nuxt',
			environment: 'nuxt',
			environmentOptions: {
				nuxt: {
					domEnvironment: 'happy-dom',
					overrides: {
						// @nuxt/fonts (přichází s @nuxt/ui) si při startu stahuje katalogy všech providerů, i když
						// appka jede jen na systémových fontech. Testy tak nechodí na síť.
						fonts: {
							providers: {
								adobe: false,
								bunny: false,
								fontshare: false,
								fontsource: false,
								google: false,
								googleicons: false,
							},
						},
						// Funkci sem dát nejde, nastavení prostředí jde do workeru serializované.
						modules: ['~~/test/setup/keep-page-meta.ts'],
					},
				},
				happyDom: {
					settings: {
						navigator: {
							userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
						},
					},
				},
			},
			include: ['test/nuxt/**/*.spec.ts'],
			// Virtuální vstup Nuxtu se z cache načte jako `/node_modules/...`; relativní importy pak nedohledá.
			fsModuleCache: false,
			globalSetup: ['./test/setup/timezone.ts'],
			restoreMocks: true,
			/**
			 * Nuxt runtime se staví jednou na soubor a do výchozích 10 s se vejde jen tak tak (běžně 1–9
			 * s) — `setupNuxt()` pak spadne na timeout a **přeskočí celý spec**, tedy zeleně nehlásí nic.
			 */
			hookTimeout: 30_000,
			/** Test má na sebe 15 s, ne výchozích 5. */
			testTimeout: 15_000,
		},
	});

	// Setup `@nuxt/test-utils` volá `vi.resetModules()` a vlastní `setupFiles` by `defineVitestProject` řadil
	// za náš — spec by pak dostal jiné instance falešného backendu, `#app` i `@vue/test-utils` než `nuxt-state.ts`.
	// `mergeConfig` pole spojí v pořadí, takže naše soubory poběží až po něm.
	return mergeConfig(nuxtProject, {
		test: {
			setupFiles: ['test/setup/nuxt-state.ts', 'test/setup/properties.ts'],
		},
	});
}

export const desktopProject = defineConfig({
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
		// `restoreMocks` vrací jen špehy z `vi.spyOn`; volání `vi.fn()` z továren `vi.mock` by jinak přetékala mezi testy.
		clearMocks: true,
		// veraPDF startuje JVM a generativní testy sázejí desítky PDF; souběh s projektem `nuxt`
		// je zdrží přes výchozích 5 s.
		testTimeout: 30_000,
		allowOnly: false,
		passWithNoTests: false,
	},
});
