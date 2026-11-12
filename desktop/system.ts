import { execFile } from 'node:child_process';
import { lstat, stat } from 'node:fs/promises';
import { basename, isAbsolute, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import { type BaseWindow, dialog, nativeTheme, Notification, shell } from 'electron';

import { errorText } from '~/utils/errors';

import { errorCode } from './util.ts';

export const OSASCRIPT = '/usr/bin/osascript';

const OPENABLE = new Set(['http:', 'https:', 'mailto:']);

const execFileAsync = promisify(execFile);

export async function run(command: string, args: string[], failed: string): Promise<string> {
	try {
		const { stdout } = await execFileAsync(command, args);
		return stdout;
	} catch (error) {
		// Číselný kód je konec programu, textový (`ENOENT`) znamená, že se vůbec nespustil.
		if (typeof errorCode(error) === 'number' && error instanceof Error && 'stderr' in error) {
			throw new Error(`${failed}: ${String(error.stderr).trim()}`, { cause: error });
		}
		throw new Error(`${basename(command)} se nepodařilo spustit: ${errorText(error)}`, { cause: error });
	}
}

// Cesta s NUL by v `fs` skončila anglickou hláškou Node; v cestě ten znak nic znamenat nemůže.
function rejectNul(value: string, what: string): void {
	if (value.includes('\0')) throw new Error(`${what} obsahuje znak NUL.`);
}

// Dialogy visí na okně jako sheet, ne jako samostatné okno, které by šlo schovat za appku.
export async function pickFolder(win: BaseWindow, { defaultPath }: { defaultPath: string }): Promise<string | null> {
	rejectNul(defaultPath, 'Výchozí složka');
	if (!isAbsolute(defaultPath)) throw new Error(`Výchozí složka ${defaultPath} není absolutní cesta.`);
	// Neexistující výchozí složku panel přejde a otevře se jinde. Přesunutá datová složka nebo nový
	// `~/Documents/Fakturian` proto dialog otevřou v nejbližší existující nadřazené složce.
	const parts = defaultPath.split(sep);
	let start: string = sep;
	for (const [i] of parts.entries()) {
		const candidate = parts.slice(0, parts.length - i).join(sep);
		const [info] = await Promise.allSettled([stat(candidate)]);
		if (info.status === 'fulfilled' && info.value.isDirectory()) {
			start = candidate;
			break;
		}
	}
	const { canceled, filePaths } = await dialog.showOpenDialog(win, {
		defaultPath: start,
		properties: ['openDirectory', 'createDirectory'],
	});
	const [folder] = filePaths;
	if (canceled || folder === undefined) return null;
	return resolve(folder);
}

export async function pickFiles(
	win: BaseWindow,
	{ filterName, extensions, multiple }: { filterName: string; extensions: string[]; multiple: boolean },
): Promise<string[]> {
	const { canceled, filePaths } = await dialog.showOpenDialog(win, {
		filters: [
			{
				name: filterName,
				extensions,
			},
		],
		properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
	});
	if (canceled) return [];
	return filePaths;
}

// Příponu i otázku na přepsání hlídá panel macOS sám podle filtru.
export async function pickSavePath(
	win: BaseWindow,
	{ defaultName, filterName, extensions }: { defaultName: string; filterName: string; extensions: string[] },
): Promise<string | null> {
	const { canceled, filePath } = await dialog.showSaveDialog(win, {
		defaultPath: defaultName,
		filters: [
			{
				name: filterName,
				extensions,
			},
		],
		properties: ['createDirectory', 'showOverwriteConfirmation'],
	});
	if (canceled || filePath === '') return null;
	return filePath;
}

// Jen odkazy, které appka sama tvoří: jiné schéma (`file:`, vlastní protokol jiné appky) by systém
// spustil jako program nebo dokument.
export async function openUrl({ url }: { url: string }): Promise<null> {
	const parsed = URL.parse(url);
	if (parsed === null || !OPENABLE.has(parsed.protocol)) {
		throw new Error(`Adresu ${url} appka neotevře, umí jen odkazy http:, https: a mailto:.`);
	}
	try {
		await shell.openExternal(parsed.href);
	} catch (error) {
		throw new Error(`Odkaz ${parsed.href} se nepodařilo otevřít: ${errorText(error)}`, { cause: error });
	}
	return null;
}

export async function revealPath({ path }: { path: string }): Promise<null> {
	rejectNul(path, 'Cesta');
	// Relativní cestu by systém vztáhl k pracovní složce procesu, ne k datům.
	if (!isAbsolute(path)) throw new Error(`Cesta ${path} není absolutní, ve Finderu ji nejde ukázat.`);
	try {
		await lstat(path);
	} catch (error) {
		if (errorCode(error) === 'ENOENT') {
			throw new Error(`${path} neexistuje, není co ukázat ve Finderu.`, { cause: error });
		}
		throw new Error(`${path} nejde ukázat ve Finderu: ${errorText(error)}`, { cause: error });
	}
	shell.showItemInFolder(path);
	return null;
}

// Povolení oznámení řeší macOS sám při prvním zobrazení; zamítnuté oznámení je rozhodnutí
// uživatele, ne chyba.
export function notify({ title, body }: { title: string; body: string }): null {
	if (!Notification.isSupported()) throw new Error('Systémová oznámení tu nejsou k dispozici.');
	new Notification({
		title,
		body,
	}).show();
	return null;
}

// Vzhled okna (vibrancy, semafory) jde za přepínačem motivu v Nastavení, ne za systémem.
export function setWindowTheme({ theme }: { theme: 'light' | 'dark' }): null {
	nativeTheme.themeSource = theme;
	return null;
}
