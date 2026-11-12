import { fileURLToPath } from 'node:url';

import { defineNuxtConfig } from 'nuxt/config';

import pkg from './package.json';

const e2eFile = (name: string) => fileURLToPath(new URL(`./e2e/${name}`, import.meta.url));

export default defineNuxtConfig({
	// Verze appky se čísluje na jednom místě — v `package.json`, protože podle něj se pojmenuje i
	// výsledný balíček.
	runtimeConfig: {
		public: {
			appVersion: pkg.version,
		},
	},

	ssr: false,
	srcDir: 'src/',
	compatibilityDate: '2025-01-01',

	modules: ['@nuxt/ui'],

	css: ['~/assets/css/main.css'],

	// Necháme @nuxt/icon prohledat šablony a všechny použité ikony zabundlovat přímo do klientského JS
	// — jinak by se tahaly z api.iconify.design a v okně appky bez sítě by zmizely.
	icon: {
		provider: 'iconify',
		clientBundle: {
			// `globInclude` schválně: výchozí prohledávání bere jen šablony (`.vue`, `.md`, …), jenže část
			// ikon je vyjmenovaná v `.ts` — sekce panelu (`constants/palette.ts`), rychlé „nové"
			// (`constants/quicknew.ts`) a nabídka ikon pro ceník (`constants/icons.ts`).
			scan: {
				globInclude: ['**/*.{vue,jsx,tsx,md,mdc,mdx,yml,yaml,ts}'],
			},
			includeCustomCollections: true,
		},
	},

	devtools: {
		enabled: false,
	},

	typescript: {
		strict: true,
		tsConfig: {
			compilerOptions: {
				allowUnreachableCode: false,
				allowUnusedLabels: false,
				noFallthroughCasesInSwitch: true,
				noImplicitReturns: true,
				noUncheckedSideEffectImports: true,
				incremental: true,
			},
		},
	},

	devServer: {
		host: '127.0.0.1',
		port: 1420,
	},

	app: {
		baseURL: '',
		buildAssetsDir: '/assets/',
		head: {
			title: 'Fakturian',
		},
	},

	vite: {
		clearScreen: false,
		server: {
			strictPort: true,
		},
		// `force: true` re-optimalizuje při každém startu — jinak se cache pre-bundlovaných závislostí po
		// restartu dev serveru rozejde a okno skončí na prázdné stránce (chybí mu už neexistující
		// optimize chunk).
		optimizeDeps: {
			force: true,
			// Seznam musí být **úplný**: co tu chybí, objeví Vite až při prvním importu za běhu, zahodí
			// rozpracovanou optimalizaci a rozdělané moduly skončí na 504 „Outdated Optimize Dep".
			include: [
				'big.js',
				'echarts/charts',
				'echarts/components',
				'echarts/core',
				'echarts/renderers',
				'vue-echarts',
				'zod',
			],
		},
	},

	$env: {
		e2e: {
			plugins: [e2eFile('e2e.client.ts')],
			buildDir: 'node_modules/.cache/nuxt/.nuxt-e2e',
			nitro: {
				output: {
					dir: '.output-e2e/app',
				},
			},
		},
	},
});
