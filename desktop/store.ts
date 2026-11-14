import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import pLimit from 'p-limit';

import { SNAPSHOT_WEEKS } from '~/bindings';
import { type DateString, dateIn, daysBetween, parseDate, today } from '~/utils/date';
import { errorText } from '~/utils/errors';

import { compareText, conflictOriginalName, errorCode, icloudOriginalName, writeAtomic } from './util.ts';
import { canonical, junk, overVault } from './vault.ts';

export type DataFileWrite = 'written' | 'conflict';

// Jméno chodí z frontendu, takže se nikdy nesmí použít přímo — šlo by přepsat cokoli.
export const DATA_FILES = ['nastaveni.json', 'platby.json', 'vydaje.json'];

// 29. 12. 1969 je pondělí, takže dělení sedmi rozřízne kalendář na týdny od pondělí.
const FIRST_MONDAY = dateIn(1969, 12, 29);

// `klíč.datum.přípona`, čteno zprava: klíč smí mít tečky (`platby.json`, doklad `2026.1`) a úklid
// záloh dokladu `2026` nesmí smazat zálohy dokladu `2026.1`.
// Stryker disable next-line Regex: ekvivalentní mutant, hladové `(.*)` začne na začátku jména a `[^.]*` dojde na konec i bez kotev.
const SNAPSHOT_NAME = /^(.*)\.([^.]*)\.[^.]*$/s;

// Stryker disable next-line StringLiteral: neplatné kódování hodí RangeError už při importu, takže se nespustí žádný test.
const UTF8 = new TextDecoder('utf-8', { fatal: true });

// Otisk souboru, jak ho appka naposledy přečetla nebo zapsala; `null` = soubor tehdy nebyl. Klíčem je
// cesta pod kanonickým kořenem: tatáž složka přes symlink nebo `..` by jinak měla dva otisky.
const KNOWN = new Map<string, string | null>();

// Čtení a zápis datových souborů jdou po jednom: mezi kontrolou otisku a zápisem nesmí proběhnout
// jiný zápis téhož souboru, jinak by starší obsah přepsal novější.
const exclusive = pLimit(1);

export function dataDir(vault: string): string {
	return join(vault, '.fakturian');
}

export function snapshotDir(vault: string): string {
	return join(dataDir(vault), 'snapshots');
}

// Na rozdíl od zbytku `.fakturian/` nikdy není zdroj pravdy, takže celá jde smazat.
export function cacheDir(vault: string): string {
	return join(dataDir(vault), 'cache');
}

function checkName(name: string): void {
	if (!DATA_FILES.includes(name)) throw new Error(`Neznámý datový soubor: ${name}`);
}

async function checkSyncVariants(dir: string, name: string): Promise<void> {
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch (error) {
		// Chybějící `.fakturian/` je nový vault, ne chyba.
		if (errorCode(error) === 'ENOENT') return;
		throw new Error(`Datovou složku ${dir} nejde přečíst: ${errorText(error)}`, { cause: error });
	}
	const variants = entries
		.filter((file) => icloudOriginalName(file) === name || conflictOriginalName(file) === name)
		.toSorted(compareText);
	if (variants.length === 0) return;
	throw new Error(
		`Datový soubor ${name} má synchronizační zástupce nebo konfliktní kopie: ${variants.join(', ')}. ` +
			'Otevři datovou složku ve Finderu a rozhodni, která verze platí; do té doby ' +
			'Fakturian soubor nenačte ani nepřepíše.',
	);
}

// `1e400` je v JS `Infinity` a `JSON.stringify` by z něj udělal `null` — číslo by se tiše ztratilo.
export function parseJson(text: string): unknown {
	return JSON.parse(text, (key: string, value: unknown) => {
		if (typeof value === 'number' && !Number.isFinite(value)) {
			throw new SyntaxError(`číslo u klíče „${key}“ je mimo rozsah`);
		}
		return value;
	});
}

function canonicalJson(name: string, json: string): string {
	let value: unknown;
	try {
		value = parseJson(json);
	} catch (error) {
		throw new Error(`Soubor ${name} má poškozený obsah: není to platný JSON.`, { cause: error });
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`Soubor ${name} musí být JSON objekt, ne pole nebo hodnota.`);
	}
	return JSON.stringify(value, null, 2);
}

function revisionOf(content: Uint8Array): string {
	return createHash('sha256').update(content).digest('hex');
}

export function readDataFile({ vaultPath, name }: { vaultPath: string; name: string }): Promise<string> {
	return exclusive(async () => {
		checkName(name);
		// Chybějící soubor je normální stav, chybějící kořen ne: bez toho rozdílu by odpojený disk
		// vypadal jako čerstvý vault.
		const root = await overVault(vaultPath);
		const dir = dataDir(root);
		const target = join(dir, name);
		const realRoot = await canonical(root);
		const key = join(dataDir(realRoot), name);
		await checkSyncVariants(dir, name);
		let raw: Uint8Array;
		let text: string;
		try {
			raw = await readFile(target);
			text = UTF8.decode(raw);
		} catch (error) {
			if (errorCode(error) !== 'ENOENT') {
				throw new Error(`Soubor ${name} nejde přečíst: ${errorText(error)}`, { cause: error });
			}
			KNOWN.set(key, null);
			return '{}';
		}
		const json = canonicalJson(name, text);
		KNOWN.set(key, revisionOf(raw));
		return json;
	});
}

export function writeDataFile({
	vaultPath,
	name,
	json,
}: {
	vaultPath: string;
	name: string;
	json: string;
}): Promise<DataFileWrite> {
	return exclusive(async () => {
		checkName(name);
		const root = await overVault(vaultPath);
		const dir = dataDir(root);
		try {
			await mkdir(dir, { recursive: true });
		} catch (error) {
			throw new Error(`Složku ${dir} nejde založit: ${errorText(error)}`, { cause: error });
		}
		await checkSyncVariants(dir, name);

		const target = join(dir, name);
		const realRoot = await canonical(root);
		const key = join(dataDir(realRoot), name);
		// Jen chybějící soubor je „nic tam není". Nečitelný (práva, nestažený z iCloudu) by jinak prošel
		// bez kontroly konfliktu a zápis by ho přepsal.
		let existing: Uint8Array | undefined;
		try {
			existing = await readFile(target);
		} catch (error) {
			if (errorCode(error) !== 'ENOENT') {
				throw new Error(`Soubor ${name} nejde přečíst: ${errorText(error)}`, { cause: error });
			}
		}

		let current: string | null = null;
		if (existing) {
			// Rozsypaný JSON je nejčastěji půlka souboru po pádu nebo sloučení v cloudu — originál je
			// to jediné, z čeho se dají data zachránit, takže nesmí zmizet pod rukama.
			try {
				parseJson(UTF8.decode(existing));
			} catch (error) {
				await saveSnapshot(snapshotDir(root), name, 'json', existing);
				throw new Error(
					`Soubor ${name} ve vaultu není platný JSON, takže nejde poznat, ` +
						`co v něm bylo — přepsat ho by ta data zahodilo. Kopie je v ${snapshotDir(root)}. ` +
						'Oprav soubor, nebo ho odsud smaž.',
					{ cause: error },
				);
			}
			current = revisionOf(existing);
		}

		// Soubor mezitím změnil jiný Mac nebo druhá instance appky. Existující soubor, který appka
		// nečetla, je konflikt taky — v paměti je pak obsah jiné složky.
		const seen = KNOWN.get(key);
		const unchanged = seen === undefined ? current === null : seen === current;
		if (!unchanged) return 'conflict';

		const content = new TextEncoder().encode(canonicalJson(name, json));
		if (existing) await saveSnapshot(snapshotDir(root), name, 'json', existing);
		await writeAtomic(target, content);
		KNOWN.set(key, revisionOf(content));
		return 'written';
	});
}

// `null` znamená, že se ještě žádná záloha neuložila. Obnova je ruční — uživatel kopii přetáhne
// zpátky —, takže appka potřebuje složku jen ukázat.
export async function snapshotsPath({ vaultPath }: { vaultPath: string }): Promise<string | null> {
	const root = await overVault(vaultPath);
	const dir = snapshotDir(root);
	const [listed] = await Promise.allSettled([readdir(dir)]);
	if (listed.status === 'fulfilled' && listed.value.some((name) => !junk(name))) return dir;
	return null;
}

export function weekOf(date: DateString): number {
	return Math.floor(daysBetween(FIRST_MONDAY, date) / 7);
}

// Záloha je best-effort: její selhání nesmí shodit zápis dat. Uklízí se po souborech, jinak by hodně
// zapisované platby vytlačily zálohy výdajů.
export async function saveSnapshot(dir: string, key: string, extension: string, content: Uint8Array): Promise<void> {
	await Promise.allSettled([mkdir(dir, { recursive: true })]);
	const [listed] = await Promise.allSettled([readdir(dir)]);
	// Stryker disable next-line ArrayDeclaration: ekvivalentní mutant, položka bez tří částí jména žádné záloze nepatří.
	const entries = listed.status === 'fulfilled' ? listed.value : [];
	const mine = entries
		.flatMap((name) => {
			// Stryker disable next-line ArrayDeclaration: ekvivalentní mutant, bez shody zůstane vlastník `undefined` tak jako tak.
			const [, owner, stamp] = SNAPSHOT_NAME.exec(name) ?? [];
			const taken = parseDate(stamp);
			if (owner !== key || !taken) return [];
			return [
				{
					taken,
					path: join(dir, name),
				},
			];
		})
		.toSorted((a, b) => daysBetween(b.taken, a.taken));

	const day = today();
	if (!mine.some(({ taken }) => weekOf(taken) === weekOf(day))) {
		// Atomicky: useknutá záloha by se tvářila jako bod obnovy.
		await Promise.allSettled([writeAtomic(join(dir, `${key}.${day}.${extension}`), content)]);
	}
	// Z každého týdne zůstane první záloha: drží stav z konce minulého týdne, pozdější by nesla mezistav.
	const kept = new Set<number>();
	for (const { taken, path } of mine) {
		const week = weekOf(taken);
		if (weekOf(day) - week < SNAPSHOT_WEEKS && !kept.has(week)) kept.add(week);
		else await Promise.allSettled([rm(path)]);
	}
}
