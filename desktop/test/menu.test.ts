import { describe, expect, it, vi } from 'vitest';

import { applicationMenu, contextMenu } from '../menu.ts';

// Menu jako text: popisek, role a zkratka každé položky po sekcích.
function outline(menu: ReturnType<typeof applicationMenu>): string[][] {
	return menu.map((section) => [
		section.label,
		...section.submenu.map((item) =>
			[item.type === 'separator' ? '—' : item.label, item.role, item.accelerator].filter(Boolean).join(' · '),
		),
	]);
}

describe('menu appky', () => {
	it('české menu jako v macOS, bez vývojářských nástrojů v balíčku', () => {
		const menu = applicationMenu({
			name: 'Fakturian',
			requestClose: () => undefined,
			devTools: false,
		});

		expect(outline(menu)).toEqual([
			[
				'Fakturian',
				'O aplikaci Fakturian · about',
				'—',
				'Služby · services',
				'—',
				'Skrýt Fakturian · hide',
				'Skrýt ostatní · hideOthers',
				'Zobrazit vše · unhide',
				'—',
				'Ukončit Fakturian · CmdOrCtrl+Q',
			],
			['Soubor', 'Zavřít okno · close'],
			[
				'Úpravy',
				'Zpět · undo',
				'Znovu · redo',
				'—',
				'Vyjmout · cut',
				'Kopírovat · copy',
				'Vložit · paste',
				'Vybrat vše · selectAll',
			],
			['Zobrazení', 'Celá obrazovka · togglefullscreen'],
			['Okno', 'Minimalizovat · minimize', 'Zvětšit · zoom', '—', 'Zavřít okno · close'],
		]);
	});

	it('Ukončit jde přes hlídku rozepsaného dokladu, ne rovnou z appky', () => {
		const requestClose = vi.fn();
		const [app] = applicationMenu({
			name: 'Fakturian',
			requestClose,
			devTools: false,
		});

		const quit = app.submenu.find((item) => item.label === 'Ukončit Fakturian');
		expect(quit.role).toBe(undefined);
		quit.click();

		expect(requestClose).toHaveBeenCalledOnce();
	});

	it('při vývoji přibudou vývojářské nástroje', () => {
		const menu = applicationMenu({
			name: 'Fakturian',
			requestClose: () => undefined,
			devTools: true,
		});

		expect(outline(menu)[3]).toEqual([
			'Zobrazení',
			'Celá obrazovka · togglefullscreen',
			'Vývojářské nástroje · toggleDevTools',
		]);
	});
});

describe('nabídka pravého tlačítka', () => {
	it('v poli nabídne úpravy textu, i když je v něm text označený', () => {
		const fields = [
			contextMenu({
				isEditable: true,
				selectionText: '',
			}),
			contextMenu({
				isEditable: true,
				selectionText: 'Acme',
			}),
		];

		for (const menu of fields) {
			expect(menu).toEqual([
				{
					role: 'cut',
					label: 'Vyjmout',
				},
				{
					role: 'copy',
					label: 'Kopírovat',
				},
				{
					role: 'paste',
					label: 'Vložit',
				},
				{ type: 'separator' },
				{
					role: 'selectAll',
					label: 'Vybrat vše',
				},
			]);
		}
	});

	it('nad označeným textem mimo pole nabídne jen kopírování', () => {
		expect(
			contextMenu({
				isEditable: false,
				selectionText: 'CZ6508000000192000145399',
			}),
		).toEqual([
			{
				role: 'copy',
				label: 'Kopírovat',
			},
		]);
	});

	it('jinde nenabídne nic', () => {
		expect(
			contextMenu({
				isEditable: false,
				selectionText: '',
			}),
		).toEqual([]);
	});
});
