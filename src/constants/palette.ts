export type StatName = 'unpaid' | 'expensesMonth';

export interface Section {
	type?: undefined;
	to: string;
	label: string;
	icon: string;
	stat?: {
		name: StatName;
		title: string;
	};
	'data-testid': string;
}

export interface MenuLabel {
	type: 'label';
	label: string;
}

// Tabulka má rovnou tvar položek `UNavigationMenu`: dvě skupiny, popisek skupiny je řádek
// `type: 'label'`. Horní skupina roluje, spodní stojí pod ní.
export const MENU: (Section | MenuLabel)[][] = [
	[
		{
			to: '/',
			label: 'Přehled',
			icon: 'i-lucide-layout-dashboard',
			'data-testid': 'menu-section/',
		},
		{
			type: 'label',
			label: 'Doklady',
		},
		{
			to: '/invoice',
			label: 'Faktury',
			icon: 'i-lucide-file-text',
			stat: {
				name: 'unpaid',
				title: 'Nezaplacené doklady',
			},
			'data-testid': 'menu-section/invoice',
		},
		{
			to: '/expense',
			label: 'Výdaje',
			icon: 'i-lucide-receipt',
			stat: {
				name: 'expensesMonth',
				title: 'Výdaje za tento měsíc',
			},
			'data-testid': 'menu-section/expense',
		},
		{
			type: 'label',
			label: 'Evidence',
		},
		{
			to: '/customers',
			label: 'Odběratelé',
			icon: 'i-lucide-users',
			'data-testid': 'menu-section/customers',
		},
		{
			to: '/pricelist',
			label: 'Ceník',
			icon: 'i-lucide-tag',
			'data-testid': 'menu-section/pricelist',
		},
	],
	[
		{
			to: '/integrations',
			label: 'Integrace',
			icon: 'i-lucide-plug',
			'data-testid': 'menu-section/integrations',
		},
		{
			to: '/settings',
			label: 'Nastavení',
			icon: 'i-lucide-settings',
			'data-testid': 'menu-section/settings',
		},
	],
];
