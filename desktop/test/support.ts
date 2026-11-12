import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

// Řádky logu bez časového razítka; chybějící log je prázdný.
export async function loggedLines(home: string): Promise<string[]> {
	const [log] = await Promise.allSettled([
		readFile(join(home, 'Library', 'Logs', 'com.fakturian.desktop', 'Fakturian.log'), 'utf8'),
	]);
	if (log.status === 'rejected') return [];
	return log.value
		.split('\n')
		.slice(0, -1)
		.map((line) => line.slice(line.indexOf(' ') + 1));
}

// `rejects.toThrow` porovná jen hlášku; webview ale dostane chybu převedenou na text.
export async function rejection(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	return undefined;
}

export async function names(dir: string): Promise<string[]> {
	const entries = await readdir(dir);
	return entries.toSorted((a, b) => a.localeCompare(b));
}

// `toThrow` porovná jen kus hlášky; `toEqual` nad chybou porovná celou.
export function thrownBy(action: () => unknown): unknown {
	try {
		action();
	} catch (error) {
		return error;
	}
	return undefined;
}

export async function isDirectory(path: string): Promise<boolean> {
	const info = await stat(path);
	return info.isDirectory();
}
