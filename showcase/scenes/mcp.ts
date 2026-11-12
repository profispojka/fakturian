import { conclusion } from './lib.ts';

export default {
	name: 'mcp',
	stage: 'stage.ts',
	viewport: {
		width: 1280,
		height: 800,
	},
	deviceScaleFactor: 2,
	fps: 30,
	url: '/integrations',

	steps: [
		{
			card: {
				kicker: 'Claude connector',
				title: 'AI agent nad tvým účetnictvím',
			},
			duration: 1.8,
		},
		{
			caption: 'Integrace se zapínají jednotlivě — Fio a Claude.',
			duration: 2.4,
		},
		{
			caption: 'MCP server se registruje jedním příkazem.',
			focus: {
				selector: '[data-testid="integrations-mcp"]',
				zoom: 1.5,
				padding: 50,
			},
			duration: 3,
		},
		{
			caption: 'Agent čte doklady, výdaje i vykázané položky ceníku — a umí vystavit fakturu.',
			focus: {
				selector: '[data-testid="integrations-mcp"]',
				zoom: 1.5,
				padding: 50,
			},
			duration: 3,
		},
		{
			caption: 'Funguje proti běžící appce, takže do dat zapisuje pořád jen jeden proces.',
			focus: null,
			duration: 2.8,
		},
		conclusion,
	],
};
