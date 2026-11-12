// Pevný krátký výběr, ne volné pole pro název ikonky: uživatel nemá jak vědět, jaké názvy Lucide
// zná, a překlep by vykreslil prázdné místo.
export interface IconChoice {
	key: string;
	label: string;
}

export const PRICE_ICONS: IconChoice[] = [
	{
		key: 'i-lucide-tag',
		label: 'Štítek',
	},
	{
		key: 'i-lucide-clock',
		label: 'Hodiny',
	},
	{
		key: 'i-lucide-calendar',
		label: 'Paušál',
	},
	{
		key: 'i-lucide-tree-palm',
		label: 'Dovolená',
	},
	{
		key: 'i-lucide-laptop',
		label: 'Práce u počítače',
	},
	{
		key: 'i-lucide-code',
		label: 'Vývoj',
	},
	{
		key: 'i-lucide-server',
		label: 'Provoz',
	},
	{
		key: 'i-lucide-cloud',
		label: 'Cloud',
	},
	{
		key: 'i-lucide-paintbrush',
		label: 'Grafika',
	},
	{
		key: 'i-lucide-pencil',
		label: 'Psaní',
	},
	{
		key: 'i-lucide-camera',
		label: 'Foto',
	},
	{
		key: 'i-lucide-video',
		label: 'Video',
	},
	{
		key: 'i-lucide-mic',
		label: 'Zvuk',
	},
	{
		key: 'i-lucide-megaphone',
		label: 'Marketing',
	},
	{
		key: 'i-lucide-graduation-cap',
		label: 'Školení',
	},
	{
		key: 'i-lucide-users',
		label: 'Konzultace',
	},
	{
		key: 'i-lucide-wrench',
		label: 'Údržba',
	},
	{
		key: 'i-lucide-hammer',
		label: 'Řemeslo',
	},
	{
		key: 'i-lucide-car',
		label: 'Doprava',
	},
	{
		key: 'i-lucide-plane',
		label: 'Cestování',
	},
	{
		key: 'i-lucide-package',
		label: 'Zboží',
	},
	{
		key: 'i-lucide-file-text',
		label: 'Dokumenty',
	},
];
