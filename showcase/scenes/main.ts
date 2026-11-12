import { mark } from './lib.ts';

/** Hlavní klip: od přehledu k hotovému dokladu. */
export default {
	name: 'hlavni',
	stage: 'stage.ts',
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
				kicker: 'Fakturian',
				title: 'Vidíš, jak na tom podnikání je',
				subtitle: 'Faktury, náklady a vykázané dny na jednom místě. Lokálně.',
			},
			duration: 2,
			chapter: 'Úvod',
		},
		{
			caption: 'Přehled: co je vyfakturované, co zaplacené a co po splatnosti.',
			duration: 2.6,
		},
		{
			caption: 'Limit plátcovství DPH se hlídá z obratu, ne z marže.',
			focus: {
				selector: '[data-testid="overview-vat"]',
				zoom: 2,
				padding: 90,
			},
			duration: 2.6,
		},
		{
			caption: 'Seznam dokladů.',
			click: '[data-testid="menu-section/invoice"]',
			focus: null,
			duration: 2.4,
			chapter: 'Faktury',
		},
		{
			caption: 'Stav vidíš u každé faktury — zaplaceno, po splatnosti, vystaveno.',
			focus: {
				selector: '[data-testid="invoices-table"]',
				zoom: 1.5,
				padding: 40,
			},
			duration: 3,
		},
		{
			caption: 'Nový doklad.',
			click: '[data-testid="menu-new"]',
			focus: null,
			duration: 1.8,
			chapter: 'Nová faktura',
		},
		{
			// „Vytvořit" rozbalí nabídku dokladů — fakturu z ní vybereme. Nabídku kreslí Nuxt UI,
			// značka se na její obal nedostane, proto `role`.
			caption: 'Faktura.',
			click: '[data-testid="menu-new-invoice"]',
			focus: {
				selector: '[role="menu"]',
				zoom: 1.7,
				padding: 80,
			},
			duration: 2,
		},
		{
			caption: 'Odběratele vybereš ze seznamu — nebo ho dotáhneš z ARESu podle IČO.',
			click: '[data-testid="choose-customer"]',
			focus: null,
			duration: 2.8,
		},
		{
			caption: 'Vybereš ze svých odběratelů.',
			before: mark('[data-testid="customer-picker-item"]', 'Studio Kolmá', 'customer-row'),
			click: '[data-shot="customer-row"]',
			focus: {
				selector: '[role="dialog"]',
				zoom: 1.35,
				padding: 60,
			},
			duration: 2.4,
		},
		{
			caption: 'Položky se berou z ceníku, takže na dokladu vypadají vždycky stejně.',
			click: '[data-testid="insert-from-pricelist"]',
			focus: null,
			duration: 2.6,
		},
		{
			caption: 'Sazbu i popis má položka uložené — doplníš jen množství.',
			before: mark('[data-testid="pricelist-insert"]', 'Vývoj na zakázku', 'item'),
			click: '[data-shot="item"]',
			focus: {
				selector: '[role="dialog"]',
				zoom: 1.35,
				padding: 60,
			},
			duration: 2.6,
		},
		{
			caption: 'Doklad se uloží jako PDF s vloženým ISDOC a QR platbou.',
			focus: null,
			duration: 3,
			chapter: 'Výsledek',
		},
		{
			card: {
				title: 'Tvoje data. Tvoje složka.',
				subtitle: 'Žádný cloud, žádný účet, žádné předplatné.',
			},
			duration: 2.2,
		},
	],
};
