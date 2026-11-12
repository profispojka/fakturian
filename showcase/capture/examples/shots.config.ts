/**
 * Seznam obrázků. Zkopíruj do `showcase/shots.config.ts` a uprav.
 *
 * Pravidlo: **hero obrázek je celá obrazovka, obrázek funkce je výřez.**
 * Screenshot celé appky zmenšený do karty funkce nikdo nepřečte.
 *
 * Cesty a selektory jsou ukázkové — nahraď je svými.
 */
import stage from './stage.ts';

import type { Page } from 'playwright';

export default {
	...stage,
	outDir: 'showcase/public/media/shots',
	themes: ['light', 'dark'],
	continueOnError: true,

	shots: [
		// --- hero: celý produkt, ať je vidět, o čem to je ------------------
		{
			name: 'hero-dashboard',
			path: '/',
			group: 'hero',
		},

		// --- top funkce: výřez na jednu věc, s dechem kolem ----------------
		{
			name: 'feature-editor',
			path: '/items/new',
			group: 'features',
			waitFor: '[data-demo="form"]',
			crop: {
				selector: '[data-demo="form"]',
				padding: 28,
				ratio: '16/10',
			},
		},
		{
			// „Zoom" varianta: kamera přiblíží prohlížeč, teprve pak se fotí —
			// text zůstane ostrý (na rozdíl od zvětšeného obrázku).
			name: 'feature-status',
			path: '/items',
			group: 'features',
			focus: {
				selector: '[data-demo="status-badge"]',
				zoom: 2.2,
				padding: 120,
			},
		},
		{
			name: 'feature-command-palette',
			path: '/',
			group: 'features',
			before: async (page: Page) => {
				await page.keyboard.press('ControlOrMeta+k');
				await page.waitForTimeout(200);
			},
			crop: {
				selector: '[role="dialog"]',
				padding: 40,
				ratio: '4/3',
			},
		},

		// --- landing pages: obrázek ke konkrétnímu use-casu ----------------
		{
			name: 'usecase-team',
			path: '/reports?demo=team',
			group: 'usecases',
		},
		{
			name: 'usecase-solo',
			path: '/reports?demo=solo',
			group: 'usecases',
			scroll: {
				y: 0,
			},
		},

		// --- dlouhý obrázek do nápovědy ------------------------------------
		{
			name: 'help-settings-full',
			path: '/settings',
			group: 'help',
			fullPage: true,
		},
	],
};
