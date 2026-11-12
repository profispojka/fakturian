import { describe, expect, it, vi } from 'vitest';

import { applicationMenu } from '../menu.ts';

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
