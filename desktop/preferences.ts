import { mkdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

import { errorText, issuesText } from '~/utils/errors';
import { z } from '~/utils/zod';

import { parseJson } from './store.ts';
import { errorCode, writeAtomic } from './util.ts';

// Stryker disable next-line StringLiteral: neplatné kódování hodí RangeError už při importu, takže se nespustí žádný test.
const UTF8 = new TextDecoder('utf-8', { fatal: true });

const REPAIR = 'Oprav ho, nebo ho smaž a datovou složku vyber znovu.';

const preferencesSchema = z.strictObject({
	vaultPath: z.string().refine(isAbsolute, 'Cesta musí být absolutní.'),
});

export function homeDir(): string {
	const home = process.env.HOME;
	if (home === undefined || !isAbsolute(home)) {
		throw new Error('Domovská složka není známá: proměnná prostředí HOME chybí nebo není absolutní cesta.');
	}
	return home;
}

export function defaultVaultPath(): string {
	return join(homeDir(), 'Documents', 'Fakturian');
}

// `userData` Electronu, `main.ts` ho sem přesměruje. Se změnou identifikátoru appky by appka
// zapomněla vybranou datovou složku i stav okna.
export function appSupportDir(): string {
	return join(homeDir(), 'Library', 'Application Support', 'com.fakturian.desktop');
}

// Se změnou jména souboru by appka zapomněla vybranou datovou složku.
function preferencesFile(): string {
	return join(appSupportDir(), 'fakturian.json');
}

export async function loadVaultPath(): Promise<string | null> {
	const file = preferencesFile();
	let raw: Uint8Array;
	try {
		raw = await readFile(file);
	} catch (error) {
		// Chybějící soubor je první spuštění: datovou složku ještě nikdo nevybral.
		if (errorCode(error) === 'ENOENT') return null;
		throw new Error(`Nastavení appky ${file} nejde přečíst: ${errorText(error)}`, { cause: error });
	}
	let json: unknown;
	try {
		json = parseJson(UTF8.decode(raw));
	} catch (error) {
		throw new Error(`Nastavení appky ${file} je poškozené (${errorText(error)}). ${REPAIR}`, { cause: error });
	}
	const preferences = preferencesSchema.safeParse(json);
	if (!preferences.success) {
		throw new Error(`Nastavení appky ${file} je poškozené (${issuesText(preferences.error)}). ${REPAIR}`);
	}
	return preferences.data.vaultPath;
}

export async function saveVaultPath({ vaultPath }: { vaultPath: string }): Promise<null> {
	const preferences = preferencesSchema.safeParse({ vaultPath });
	if (!preferences.success) throw new Error(`Cestu k datové složce nejde uložit (${issuesText(preferences.error)}).`);
	const file = preferencesFile();
	try {
		await mkdir(dirname(file), { recursive: true });
		await writeAtomic(file, new TextEncoder().encode(JSON.stringify(preferences.data, null, 2)));
	} catch (error) {
		throw new Error(`Nastavení appky ${file} nejde uložit: ${errorText(error)}`, { cause: error });
	}
	return null;
}
