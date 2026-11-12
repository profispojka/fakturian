import { conclusion } from './lib.ts';

export default {
	// Jméno klipu je jméno souborů v `public/media/` — web ho odkazuje jako `dovolena`.
	name: 'dovolena',
	stage: 'stage.ts',
	viewport: {
		width: 1280,
		height: 800,
	},
	deviceScaleFactor: 2,
	fps: 30,
	url: '/pricelist',

	steps: [
		{
			card: {
				kicker: 'Ceník',
				title: 'Roční limit, který se hlídá sám',
			},
			duration: 1.8,
		},
		{
			caption: 'Položka ceníku nese ikonku a nepovinné „maximálně ročně" ve své jednotce.',
			duration: 2.6,
		},
		{
			// Panel vykázání otevírá jen volba v nabídce akcí; recorder měří cíl kliknutí před krokem,
			// takže nabídka a volba v ní jsou dva kroky.
			caption: 'V nabídce u položky otevřeš vykázání.',
			click: '[data-testid="price-actions-p-konzultacni"]',
			duration: 1.4,
		},
		{
			caption: 'V nabídce u položky otevřeš vykázání.',
			click: '[data-testid="price-show-usage"]',
			duration: 1.2,
		},
		{
			caption: 'Vpravo je vidět, kolik z ní odešlo a kolik zbývá.',
			focus: {
				selector: '[data-testid="price-usage"]',
				zoom: 1.7,
				padding: 60,
			},
			duration: 3,
		},
		{
			caption: 'A na kterých fakturách to bylo.',
			focus: {
				selector: '[data-testid="price-usage"] table',
				zoom: 1.5,
				padding: 60,
			},
			duration: 2.6,
		},
		{
			caption: 'Na dokladu je to běžná položka; appka si pamatuje, kam patří.',
			goto: '/invoice',
			click: '[data-testid="invoice-entry-2026009"] [data-testid="invoice-open"]',
			duration: 2.8,
		},
		{
			caption: 'Faktura, která by limit překročila, se neuloží. Žádné „opravdu chcete".',
			focus: {
				selector: '[data-testid="limit-watch"]',
				zoom: 1.5,
				padding: 60,
			},
			duration: 3,
		},
		conclusion,
	],
};
