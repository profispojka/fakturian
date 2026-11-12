import { defineVitestProject } from '@nuxt/test-utils/config';
import { mergeConfig } from 'vitest/config';

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
		include: ['test/nuxt/*.spec.ts'],
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
export default mergeConfig(nuxtProject, {
	test: {
		setupFiles: ['test/setup/nuxt-state.ts', 'test/setup/properties.ts'],
	},
});
