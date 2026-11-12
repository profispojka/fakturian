import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dialog, nativeTheme, Notification, shell } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rejection } from './support.ts';

import { notify, openUrl, pickFiles, pickFolder, pickSavePath, revealPath, run, setWindowTheme } from '../system.ts';

// Záznam místo skutečných dialogů, Finderu, prohlížeče a oznámení: test nesmí nic otevřít.
vi.mock('electron', () => {
	const shown: { title: string; body: string }[] = [];
	return {
		dialog: {
			showOpenDialog: vi.fn(),
			showSaveDialog: vi.fn(),
		},
		shell: {
			openExternal: vi.fn(),
			showItemInFolder: vi.fn(),
		},
		nativeTheme: {
			themeSource: 'system',
		},
		Notification: class {
			static isSupported = vi.fn(() => true);
			static shown = shown;
			#options: { title: string; body: string };
			constructor(options: { title: string; body: string }) {
				this.#options = options;
			}
			show() {
				shown.push(this.#options);
			}
		},
	};
});

const win = { id: 'okno' };

let base = '';

beforeEach(async () => {
	base = await realpath(await mkdtemp(join(tmpdir(), 'fakturian-system-')));
	vi.clearAllMocks();
});

afterEach(async () => {
	await rm(base, { recursive: true });
});

describe('spuštění programu', () => {
	it('vrátí, co program vypsal', async () => {
		expect(await run('/bin/echo', ['ahoj'], 'Nešlo to')).toBe('ahoj\n');
	});

	it('nenulový konec nese chybový výstup programu', async () => {
		const error = await rejection(run('/bin/sh', ['-c', 'echo "chyba skriptu " >&2; exit 3'], 'Skript selhal'));

		expect(error).toEqual(
			new Error('Skript selhal: chyba skriptu', { cause: expect.objectContaining({ code: 3 }) }),
		);
	});

	it('program, který nejde spustit, se pojmenuje', async () => {
		const error = await rejection(run('/nikde/nic', [], 'Skript selhal'));

		expect(error).toEqual(
			new Error('nic se nepodařilo spustit: spawn /nikde/nic ENOENT', {
				cause: expect.objectContaining({ code: 'ENOENT' }),
			}),
		);
	});
});

describe('výběr složky', () => {
	it('dialog visí na okně a otevře se ve výchozí složce', async () => {
		vi.mocked(dialog.showOpenDialog).mockResolvedValue({
			canceled: false,
			filePaths: [`${base}/data/`],
		});

		expect(await pickFolder(win, { defaultPath: base })).toBe(join(base, 'data'));
		expect(dialog.showOpenDialog).toHaveBeenCalledWith(win, {
			defaultPath: base,
			properties: ['openDirectory', 'createDirectory'],
		});
	});

	it('neexistující výchozí složka otevře nejbližší existující nadřazenou', async () => {
		await mkdir(join(base, 'Documents'));
		await writeFile(join(base, 'soubor'), '');
		vi.mocked(dialog.showOpenDialog).mockResolvedValue({
			canceled: true,
			filePaths: [],
		});

		await pickFolder(win, { defaultPath: join(base, 'Documents', 'Fakturian', 'stará') });
		await pickFolder(win, { defaultPath: join(base, 'soubor') });
		await pickFolder(win, { defaultPath: '/nikde/fakturian' });

		expect(vi.mocked(dialog.showOpenDialog).mock.calls.map(([, options]) => options.defaultPath)).toEqual([
			join(base, 'Documents'),
			base,
			'/',
		]);
	});

	it('zavřený dialog nic nevybral', async () => {
		vi.mocked(dialog.showOpenDialog).mockResolvedValue({
			canceled: true,
			filePaths: [],
		});
		expect(await pickFolder(win, { defaultPath: base })).toBe(null);

		vi.mocked(dialog.showOpenDialog).mockResolvedValue({
			canceled: false,
			filePaths: [],
		});
		expect(await pickFolder(win, { defaultPath: base })).toBe(null);
	});

	it('relativní výchozí složka ani znak NUL dialog neotevřou', async () => {
		await expect(pickFolder(win, { defaultPath: 'Documents' })).rejects.toThrow(
			new Error('Výchozí složka Documents není absolutní cesta.'),
		);
		await expect(pickFolder(win, { defaultPath: '/Users/\0' })).rejects.toThrow(
			new Error('Výchozí složka obsahuje znak NUL.'),
		);
		expect(dialog.showOpenDialog).not.toHaveBeenCalled();
	});
});

describe('výběr souborů', () => {
	it('filtr a vícenásobný výběr jdou do dialogu', async () => {
		vi.mocked(dialog.showOpenDialog).mockResolvedValue({
			canceled: false,
			filePaths: ['/a.pdf', '/b.pdf'],
		});

		expect(
			await pickFiles(win, {
				filterName: 'Faktury',
				extensions: ['pdf'],
				multiple: true,
			}),
		).toEqual(['/a.pdf', '/b.pdf']);
		await pickFiles(win, {
			filterName: 'Logo',
			extensions: ['png', 'jpg'],
			multiple: false,
		});

		expect(vi.mocked(dialog.showOpenDialog).mock.calls).toEqual([
			[
				win,
				{
					filters: [
						{
							name: 'Faktury',
							extensions: ['pdf'],
						},
					],
					properties: ['openFile', 'multiSelections'],
				},
			],
			[
				win,
				{
					filters: [
						{
							name: 'Logo',
							extensions: ['png', 'jpg'],
						},
					],
					properties: ['openFile'],
				},
			],
		]);
	});

	it('zavřený dialog vrátí prázdný seznam', async () => {
		vi.mocked(dialog.showOpenDialog).mockResolvedValue({
			canceled: true,
			filePaths: ['/a.pdf'],
		});

		expect(
			await pickFiles(win, {
				filterName: 'Faktury',
				extensions: ['pdf'],
				multiple: true,
			}),
		).toEqual([]);
	});
});

describe('uložení souboru', () => {
	it('dialog hlídá příponu i přepsání a vrátí cestu', async () => {
		vi.mocked(dialog.showSaveDialog).mockResolvedValue({
			canceled: false,
			filePath: '/Users/jana/kopie.pdf',
		});

		expect(
			await pickSavePath(win, {
				defaultName: '20260001.pdf',
				filterName: 'PDF',
				extensions: ['pdf'],
			}),
		).toBe('/Users/jana/kopie.pdf');
		expect(dialog.showSaveDialog).toHaveBeenCalledWith(win, {
			defaultPath: '20260001.pdf',
			filters: [
				{
					name: 'PDF',
					extensions: ['pdf'],
				},
			],
			properties: ['createDirectory', 'showOverwriteConfirmation'],
		});
	});

	it('zavřený dialog nic neuloží', async () => {
		vi.mocked(dialog.showSaveDialog).mockResolvedValue({
			canceled: true,
			filePath: '',
		});
		expect(
			await pickSavePath(win, {
				defaultName: 'a.pdf',
				filterName: 'PDF',
				extensions: ['pdf'],
			}),
		).toBe(null);

		vi.mocked(dialog.showSaveDialog).mockResolvedValue({
			canceled: false,
			filePath: '',
		});
		expect(
			await pickSavePath(win, {
				defaultName: 'a.pdf',
				filterName: 'PDF',
				extensions: ['pdf'],
			}),
		).toBe(null);
	});
});

describe('otevření odkazu', () => {
	it('http, https a mailto otevře systém', async () => {
		vi.mocked(shell.openExternal).mockResolvedValue();

		for (const url of ['https://ares.gov.cz/', 'http://binaro.cz', 'mailto:jana@example.com?subject=Faktura']) {
			expect(await openUrl({ url })).toBe(null);
		}

		expect(vi.mocked(shell.openExternal).mock.calls).toEqual([
			['https://ares.gov.cz/'],
			['http://binaro.cz/'],
			['mailto:jana@example.com?subject=Faktura'],
		]);
	});

	it('jiné schéma ani nečitelnou adresu appka neotevře', async () => {
		for (const url of ['file:///etc/passwd', 'fakturian://x', 'není adresa']) {
			await expect(openUrl({ url })).rejects.toThrow(
				new Error(`Adresu ${url} appka neotevře, umí jen odkazy http:, https: a mailto:.`),
			);
		}
		expect(shell.openExternal).not.toHaveBeenCalled();
	});

	it('selhání systému se ohlásí s odkazem', async () => {
		vi.mocked(shell.openExternal).mockRejectedValue(new Error('No application'));

		await expect(openUrl({ url: 'https://binaro.cz' })).rejects.toThrow(
			new Error('Odkaz https://binaro.cz/ se nepodařilo otevřít: No application', {
				cause: new Error('No application'),
			}),
		);
	});
});

describe('ukázání ve Finderu', () => {
	it('existující cesta se ukáže', async () => {
		expect(await revealPath({ path: base })).toBe(null);
		expect(shell.showItemInFolder).toHaveBeenCalledWith(base);
	});

	it('neexistující, nedostupná, relativní nebo NUL cesta se ohlásí', async () => {
		await writeFile(join(base, 'soubor'), '');
		const missing = join(base, 'chybi');
		const blocked = join(base, 'soubor', 'uvnitř');

		await expect(revealPath({ path: missing })).rejects.toThrow(
			new Error(`${missing} neexistuje, není co ukázat ve Finderu.`, {
				cause: expect.objectContaining({ code: 'ENOENT' }),
			}),
		);
		await expect(revealPath({ path: blocked })).rejects.toThrow(
			new Error(`${blocked} nejde ukázat ve Finderu: ENOTDIR: not a directory, lstat '${blocked}'`, {
				cause: expect.objectContaining({ code: 'ENOTDIR' }),
			}),
		);
		await expect(revealPath({ path: 'faktury' })).rejects.toThrow(
			new Error('Cesta faktury není absolutní, ve Finderu ji nejde ukázat.'),
		);
		await expect(revealPath({ path: `${base}\0` })).rejects.toThrow(new Error('Cesta obsahuje znak NUL.'));
		expect(shell.showItemInFolder).not.toHaveBeenCalled();
	});
});

describe('oznámení a vzhled okna', () => {
	it('oznámení se ukáže s titulkem a textem', () => {
		expect(
			notify({
				title: 'Fakturian',
				body: 'Faktura odeslána',
			}),
		).toBe(null);

		expect(Reflect.get(Notification, 'shown')).toEqual([
			{
				title: 'Fakturian',
				body: 'Faktura odeslána',
			},
		]);
	});

	it('bez podpory oznámení se ohlásí chyba', () => {
		vi.mocked(Notification.isSupported).mockReturnValueOnce(false);

		expect(() =>
			notify({
				title: 'Fakturian',
				body: 'Faktura odeslána',
			}),
		).toThrow(new Error('Systémová oznámení tu nejsou k dispozici.'));
	});

	it('motiv okna jde za volbou v Nastavení', () => {
		expect(setWindowTheme({ theme: 'dark' })).toBe(null);
		expect(nativeTheme.themeSource).toBe('dark');

		setWindowTheme({ theme: 'light' });
		expect(nativeTheme.themeSource).toBe('light');
	});
});
