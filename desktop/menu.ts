import type { MenuItemConstructorOptions } from 'electron';

// Ukončit je vlastní položka, ne role: role by appku ukončila bez otázky na rozepsaný doklad.
// Zavřít okno smí být role, protože `close` okna hlídá `startShell`.
export function applicationMenu({
	name,
	requestClose,
	devTools,
}: {
	name: string;
	requestClose: () => void;
	devTools: boolean;
}): MenuItemConstructorOptions[] {
	const close: MenuItemConstructorOptions = {
		role: 'close',
		label: 'Zavřít okno',
	};
	const view: MenuItemConstructorOptions[] = [
		{
			role: 'togglefullscreen',
			label: 'Celá obrazovka',
		},
	];
	if (devTools)
		view.push({
			role: 'toggleDevTools',
			label: 'Vývojářské nástroje',
		});
	return [
		{
			label: name,
			submenu: [
				{
					role: 'about',
					label: `O aplikaci ${name}`,
				},
				{ type: 'separator' },
				{
					role: 'services',
					label: 'Služby',
				},
				{ type: 'separator' },
				{
					role: 'hide',
					label: `Skrýt ${name}`,
				},
				{
					role: 'hideOthers',
					label: 'Skrýt ostatní',
				},
				{
					role: 'unhide',
					label: 'Zobrazit vše',
				},
				{ type: 'separator' },
				{
					label: `Ukončit ${name}`,
					accelerator: 'CmdOrCtrl+Q',
					click: requestClose,
				},
			],
		},
		{
			label: 'Soubor',
			submenu: [close],
		},
		{
			label: 'Úpravy',
			submenu: [
				{
					role: 'undo',
					label: 'Zpět',
				},
				{
					role: 'redo',
					label: 'Znovu',
				},
				{ type: 'separator' },
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
				{
					role: 'selectAll',
					label: 'Vybrat vše',
				},
			],
		},
		{
			label: 'Zobrazení',
			submenu: view,
		},
		{
			label: 'Okno',
			submenu: [
				{
					role: 'minimize',
					label: 'Minimalizovat',
				},
				{
					role: 'zoom',
					label: 'Zvětšit',
				},
				{ type: 'separator' },
				close,
			],
		},
	];
}
