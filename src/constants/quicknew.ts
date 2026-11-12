export interface QuickNewItem {
	label: string;
	icon: string;
	to: string;
	kbds?: string[];
	'data-testid': string;
}

export const QUICK_NEW_ITEMS: QuickNewItem[] = [
	{
		label: 'Faktura',
		icon: 'i-lucide-file-text',
		to: '/invoice/new',
		kbds: ['meta', 'n'],
		'data-testid': 'menu-new-invoice',
	},
	{
		label: 'Odběratel',
		icon: 'i-lucide-user-plus',
		to: '/customers/new',
		'data-testid': 'menu-new-contact',
	},
	{
		label: 'Položka ceníku',
		icon: 'i-lucide-tag',
		to: '/pricelist/new',
		'data-testid': 'menu-new-price',
	},
	{
		label: 'Výdaj',
		icon: 'i-lucide-receipt',
		to: '/expense/new',
		'data-testid': 'menu-new-expense',
	},
];
