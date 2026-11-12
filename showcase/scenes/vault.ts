import { conclusion } from './lib.ts';

export default {
	name: 'vault',
	stage: 'stage.ts',
	viewport: {
		width: 1280,
		height: 800,
	},
	deviceScaleFactor: 2,
	fps: 30,
	url: '/settings',

	steps: [
		{
			card: {
				kicker: 'Data',
				title: 'Tvoje složka, tvoje soubory',
			},
			duration: 1.8,
		},
		{
			caption: 'Data leží tam, kam si je dáš — appka na nich nic nezamyká.',
			focus: {
				selector: '[data-testid="settings-vault"]',
				zoom: 1.5,
				padding: 50,
			},
			duration: 3,
		},
		{
			caption: 'Faktury jsou PDF s vloženým ISDOC, zbytek čitelné JSON soubory.',
			focus: {
				selector: '[data-testid="settings-vault"]',
				zoom: 1.5,
				padding: 50,
			},
			duration: 2.8,
		},
		{
			caption: 'Zálohu i synchronizaci řeší to, kam složku umístíš.',
			focus: null,
			duration: 2.6,
		},
		conclusion,
	],
};
