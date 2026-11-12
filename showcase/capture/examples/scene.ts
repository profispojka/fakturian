import type { Page } from 'playwright';

/**
 * Scénář jednoho klipu. Zkopíruj do `showcase/scenes/<nazev>.ts`.
 *
 * Klip má **jednu myšlenku** a 12–25 sekund. Delší video na landing page nikdo
 * nedokouká; když je toho víc, udělej dva klipy.
 *
 * Anatomie: titulek (1,5 s) → co je vidět (1–2 s) → akce → výsledek →
 * dovětek. Kamera se hýbe jen když má proč: přiblížení = „tohle je důležité".
 *
 * Selektory níž jsou ukázkové — nahraď je těmi, které opravdu máš v appce
 * (nejlíp stabilní `data-*` atributy, ne třídy z frameworku).
 */
export default {
	name: 'quick-start',
	stage: 'showcase/stage.ts', // sdílené nastavení (baseUrl, harness, motiv)

	viewport: {
		width: 1280,
		height: 800,
	},
	deviceScaleFactor: 2,
	fps: 30,
	url: '/',

	steps: [
		{
			card: {
				kicker: 'Základní scénář',
				title: 'Od nuly k hotovému za dvacet vteřin',
				subtitle: 'Bez nastavování, bez účtu.',
			},
			duration: 1.8,
			chapter: 'Úvod',
		},
		{
			caption: 'Začínáš na přehledu — všechno podstatné na jedné obrazovce.',
			focus: null,
			duration: 2,
		},
		{
			caption: 'Nová položka jedním klikem.',
			click: '[data-demo="new"]',
			focus: {
				selector: '[data-demo="new"]',
				zoom: 1.9,
				padding: 140,
			},
			duration: 2.2,
		},
		{
			caption: 'Stačí začít psát — zbytek se doplní sám.',
			type: {
				selector: '[data-demo="search"]',
				text: 'Ostrava',
			},
			focus: {
				selector: '[data-demo="form"]',
				zoom: 1.7,
			},
			duration: 3,
		},
		{
			caption: 'Potvrdíš a je to uložené.',
			press: 'Enter',
			focus: {
				selector: '[data-demo="form"]',
				zoom: 1.7,
			},
			duration: 2.4,
			at: 0.15,
		},
		{
			caption: 'Zkratkou ⌘K se dostaneš kamkoli.',
			chip: '⌘K',
			before: async (page: Page) => {
				await page.keyboard.press('ControlOrMeta+k');
				await page.waitForTimeout(150);
			},
			focus: {
				selector: '[role="dialog"]',
				zoom: 1.4,
			},
			duration: 2.6,
		},
		{
			card: {
				title: 'Tvoje data. Tvůj počítač.',
				subtitle: 'priklad.cz',
			},
			duration: 2,
			chapter: 'Závěr',
		},
	],
};
