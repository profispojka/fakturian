import stage from './stage.ts';

import type { Page } from 'playwright';

/**
 * Seznam obrázků webu. Foto vzniká proti **produkčnímu buildu appky**
 * (`bun run generate` v kořeni repa) servírovanému přes `bun run serve:app`.
 *
 * Výřezy míří na `data-testid` z appky — tytéž značky drží testy, takže
 * přejmenování v UI shodí test dřív, než rozbije focení.
 */

/**
 * Otevře u položky ceníku vykázání a roční limit. Panel vpravo otevírá jen
 * volba v nabídce akcí řádku — klik na řádek položku jen označí.
 */
const pickItem = (id: string) => async (page: Page) => {
	await page.click(`[data-testid="price-actions-${id}"]`);
	await page.click('[data-testid="price-show-usage"]');
	await page.waitForSelector('[data-testid="price-usage"]', { timeout: 10_000 });
	await page.waitForTimeout(400);
};

export default {
	...stage,
	outDir: 'public/media/shots',
	themes: ['light', 'dark'],
	continueOnError: true,
	entry: '/',

	shots: [
		// ── hero: celá appka, ať je vidět, o čem to je ──────────────────────
		{
			name: 'hero-prehled',
			path: '/',
			group: 'hero',
		},

		// ── hlavní funkce: výřez přesně na tu jednu věc ─────────────────────
		{
			// Roční limit položky ceníku. Karta se ukáže až po kliknutí na
			// položku ve výpisu — vpravo pak stojí vykázání i faktury.
			name: 'feature-limit-ceniku',
			path: '/pricelist',
			group: 'features',
			before: pickItem('p-konzultacni'),
			crop: {
				selector: '[data-testid="price-usage"]',
				padding: 40,
				ratio: '4/3',
			},
		},
		{
			name: 'feature-platby',
			path: '/invoice',
			group: 'features',
			crop: {
				selector: '[data-testid="invoices-table"]',
				padding: 28,
				ratio: '16/10',
			},
		},
		{
			name: 'feature-mcp',
			path: '/integrations',
			group: 'features',
			crop: {
				selector: '[data-testid="integrations-mcp"]',
				padding: 32,
				ratio: '4/3',
			},
		},
		{
			name: 'feature-vault',
			path: '/settings',
			group: 'features',
			crop: {
				selector: '[data-testid="settings-vault"]',
				padding: 32,
				ratio: '16/10',
			},
		},

		// ── use-case stránky: každá jiná obrazovka a jiná data ──────────────
		{
			name: 'usecase-programatory',
			path: '/invoice/2026009',
			group: 'usecases',
			before: async (page: Page) => {
				await page.waitForSelector('[data-testid="field-number"]', { timeout: 10_000 });
				await page.waitForTimeout(400);
			},
		},
		{
			name: 'usecase-konzultanti',
			path: '/pricelist',
			group: 'usecases',
			before: pickItem('p-konzultacni'),
		},
		{
			name: 'usecase-remeslnici',
			path: '/pricelist',
			group: 'usecases',
		},
		{
			name: 'usecase-male-firmy',
			path: '/expense',
			group: 'usecases',
		},
		{
			name: 'usecase-fakturoid',
			path: '/invoice',
			group: 'usecases',
		},
		{
			name: 'usecase-idoklad',
			path: '/settings',
			group: 'usecases',
		},
		{
			name: 'usecase-bez-cloudu',
			path: '/customers',
			group: 'usecases',
		},
		{
			name: 'usecase-offline',
			path: '/integrations',
			group: 'usecases',
			crop: {
				selector: '[data-testid="integrations-fio"]',
				padding: 32,
				ratio: '16/10',
			},
		},
		{
			name: 'usecase-ai-agent',
			path: '/integrations',
			group: 'usecases',
			crop: {
				selector: '[data-testid="integrations-mcp"]',
				padding: 24,
				ratio: '16/10',
			},
		},
	],
};
