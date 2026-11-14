import { copyFile, mkdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';

import { decode } from 'fast-png';

import { errorText } from '~/utils/errors';

import { errorCode, MIB, writeAtomic } from './util.ts';

import type { Stats } from 'node:fs';

// `.fakturian/` založí až první zápis dat nebo cache.
export async function ensureVault({ vaultPath }: { vaultPath: string }): Promise<null> {
	for (const name of ['faktury', 'prijate']) {
		const dir = join(vaultPath, name);
		try {
			await mkdir(dir, { recursive: true });
		} catch (error) {
			throw new Error(`Složku ${dir} nejde založit: ${errorText(error)}`, { cause: error });
		}
	}
	return null;
}

// Kořen jen ověřuje, nezakládá: to smí jedině `ensureVault` při volbě složky.
export async function overVault(vaultPath: string): Promise<string> {
	let info: Stats;
	try {
		info = await stat(vaultPath);
	} catch (error) {
		if (errorCode(error) === 'ENOENT') throw new Error(`Datová složka ${vaultPath} neexistuje.`, { cause: error });
		throw new Error(`K datové složce ${vaultPath} se nejde dostat: ${errorText(error)}`, { cause: error });
	}
	if (!info.isDirectory()) {
		throw new Error(`Datová složka ${vaultPath} není složka, ale soubor. Vyber v nastavení jinou.`);
	}
	return vaultPath;
}

// Start appky jím odliší složku, která není na místě, od souboru v ní, který nejde přečíst.
export async function checkVault({ vaultPath }: { vaultPath: string }): Promise<null> {
	await overVault(vaultPath);
	return null;
}

// Rozbalí symlinky a `..`, aby se cesta dala porovnat s kořenem vaultu. Bez toho projde
// `faktury/../../.ssh/id_rsa` i symlink mířící ven.
export async function canonical(path: string): Promise<string> {
	try {
		const resolved = await realpath(path);
		return resolved;
	} catch (error) {
		throw new Error(`${path} nejde ověřit: ${errorText(error)}`, { cause: error });
	}
}

// Import dokladu nebo příloha e-mailu by jinak mohly sáhnout mimo vault přes `..` nebo symlink.
// Vrací ověřenou kanonickou cestu: původní by mohl mezitím vyměněný symlink odklonit ven.
export async function requireWithin(vaultPath: string, path: string): Promise<string> {
	const vault = await overVault(vaultPath);
	const root = await canonical(vault);
	const resolved = await canonical(path);
	// Po složkách, ne po znacích: `/Faktury 2/doklad.pdf` ve složce `/Faktury` neleží.
	if (!`${resolved}${sep}`.startsWith(join(root, sep))) {
		throw new Error(`${path} neleží v datové složce.`);
	}
	return resolved;
}

export const LOGO_FILE = 'logo.png';
const MAX_LOGO_BYTES = 2 * MIB;

// Logo obsluhuje backend, webview k souborům přístup nemá.
export async function vaultHasLogo({ vaultPath }: { vaultPath: string }): Promise<boolean> {
	const root = await overVault(vaultPath);
	const [logo] = await Promise.allSettled([stat(join(root, LOGO_FILE))]);
	return logo.status === 'fulfilled' && logo.value.isFile();
}

export async function setVaultLogo({ vaultPath, source }: { vaultPath: string; source: string }): Promise<null> {
	const root = await overVault(vaultPath);
	let content: Uint8Array;
	try {
		const info = await stat(source);
		// Cesta přichází ze stránky; bez stropu by se do paměti načetl jakkoli velký soubor.
		if (info.size > MAX_LOGO_BYTES) throw new Error(`soubor má víc než ${MAX_LOGO_BYTES / MIB} MB`);
		content = await readFile(source);
	} catch (error) {
		throw new Error(`${source}: ${errorText(error)}`, { cause: error });
	}
	// Typst vysází jen obrázek, který umí přečíst; jiné logo by shodilo každý doklad.
	try {
		decode(content);
	} catch (error) {
		throw new Error('Logo musí být obrázek PNG.', { cause: error });
	}
	// Render čte logo při každém náhledu; přímá kopie do cíle by souběžný náhled vysázela bez loga.
	const target = join(root, LOGO_FILE);
	try {
		await writeAtomic(target, content);
	} catch (error) {
		throw new Error(`${target}: ${errorText(error)}`, { cause: error });
	}
	return null;
}

export async function removeVaultLogo({ vaultPath }: { vaultPath: string }): Promise<null> {
	const root = await overVault(vaultPath);
	const logo = join(root, LOGO_FILE);
	try {
		await rm(logo);
	} catch (error) {
		if (errorCode(error) !== 'ENOENT') throw new Error(`${logo}: ${errorText(error)}`, { cause: error });
	}
	return null;
}

const SYSTEM_JUNK = new Set([
	'.DS_Store',
	'Icon\r',
	'.localized',
	'.Spotlight-V100',
	'.Trashes',
	'.fseventsd',
	'.TemporaryItems',
	'.apdisk',
]);

// Smetí od systému, které o obsahu složky nic neříká. Finder zapíše `.DS_Store` už tím, že složku
// někdo otevře — složka, do které se uživatel jen podíval, proto platí za prázdnou.
export function junk(name: string): boolean {
	return SYSTEM_JUNK.has(name) || name.startsWith('._');
}

// Kopie jen tehdy, když `rename` neumí přes hranici svazku. Po jiné chybě (práva, zamčený soubor)
// by kopie prošla a smazání zdroje ne — doklad by zůstal na obou místech.
export async function moveFile(source: string, target: string): Promise<void> {
	try {
		await rename(source, target);
		return;
	} catch (error) {
		if (errorCode(error) !== 'EXDEV') throw new Error(`${source}: ${errorText(error)}`, { cause: error });
	}
	try {
		await copyFile(source, target);
	} catch (error) {
		// Kopie po chybě uprostřed nechá na cíli useknutý soubor, který by se tvářil jako obsazené místo.
		await Promise.allSettled([rm(target)]);
		throw new Error(`${source}: ${errorText(error)}`, { cause: error });
	}
	try {
		await rm(source);
	} catch (error) {
		throw new Error(`${source}: ${errorText(error)}`, { cause: error });
	}
}
