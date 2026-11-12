import { conclusion } from './lib.ts';

export default {
	name: 'platby',
	stage: 'stage.ts',
	viewport: {
		width: 1280,
		height: 800,
	},
	deviceScaleFactor: 2,
	fps: 30,
	url: '/invoice',

	steps: [
		{
			card: {
				kicker: 'Platby',
				title: 'Zaplacené faktury si odškrtne banka',
			},
			duration: 1.8,
		},
		{
			caption: 'Stav je vidět u každého dokladu.',
			focus: {
				selector: '[data-testid="invoices-table"]',
				zoom: 1.4,
				padding: 40,
			},
			duration: 2.6,
		},
		{
			// Přepínač stavů kreslí Nuxt UI; značka je na skupině, volba se najde podle role a hodnoty.
			caption: 'Po splatnosti se zvýrazní — a nabídne upomínku.',
			click: '[data-testid="invoice-state-filter"] [role="radio"][value="overdue"]',
			focus: null,
			duration: 2.6,
		},
		{
			caption: 'Fio spáruje platbu podle variabilního symbolu a částky.',
			goto: '/integrations',
			focus: {
				selector: '[data-testid="integrations-fio"]',
				zoom: 1.4,
				padding: 60,
			},
			duration: 3.2,
		},
		conclusion,
	],
};
