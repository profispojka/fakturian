import type { Page } from 'playwright';

/**
 * Vizuální kontrola hotového webu (ne appky) — po `bun run generate` a spuštění
 * `node capture/serve.ts --dir .output/public --port 3901`.
 *
 *   node capture/shoot.ts --config web-check.config.ts
 *
 * Obrázky jdou do `media/check/`, do gitu nepatří.
 */
export default {
	baseUrl: 'http://127.0.0.1:3901',
	viewport: {
		width: 1440,
		height: 950,
	},
	deviceScaleFactor: 1,
	locale: 'cs-CZ',
	timezoneId: 'Europe/Prague',
	ready: 'h1',
	outDir: 'media/check',
	themes: ['light', 'dark'],
	continueOnError: true,
	entry: '/',

	applyTheme: async (page: Page, scheme: 'light' | 'dark') => {
		await page.evaluate((s: 'light' | 'dark') => {
			localStorage.setItem('theme', s);
			document.documentElement.dataset.theme = s;
		}, scheme);
	},

	shots: [
		{
			name: 'web-home',
			path: '/',
			fullPage: true,
		},
		{
			name: 'web-funkce',
			path: '/funkce',
		},
		{
			name: 'web-usecase',
			path: '/pro/programatory',
			fullPage: true,
		},
		{
			name: 'web-napoveda',
			path: '/napoveda/zalohovani',
		},
		{
			name: 'web-cena',
			path: '/cena',
		},
	],
};
