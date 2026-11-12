import { randomBytes } from 'node:crypto';
import { open, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import { errorText } from '~/utils/errors';

import { VERSION } from './version.ts';

const ICLOUD_PLACEHOLDER = /^\.(.*)\.icloud$/is;

export const MIB = 1024 * 1024;

// Identifikace appky v každém dotazu ven (PRIVACY.md).
export const USER_AGENT = `Fakturian/${VERSION}`;

// Doklad větší než tohle není faktura, ale video nebo archiv, který leží ve stejné složce.
export const MAX_DOCUMENT_BYTES = 64 * MIB;

// Pevné pořadí podle kódů znaků, ne podle jazyka: `localeCompare` se řídí nastavením systému.
export function compareText(a: string, b: string): number {
	return Number(a > b) - Number(a < b);
}

export function icloudOriginalName(fileName: string): string | undefined {
	return ICLOUD_PLACEHOLDER.exec(fileName)?.[1];
}

export function conflictOriginalName(fileName: string): string | undefined {
	const dot = fileName.lastIndexOf('.');
	// Stryker disable next-line EqualityOperator: ekvivalentní mutant, jméno s jedinou tečkou na začátku nemá kmen a vyjde `undefined` i bez návratu.
	if (dot < 0) return undefined;
	const stem = fileName.slice(0, dot);
	const extension = fileName.slice(dot);
	const space = stem.lastIndexOf(' ');
	if (space >= 0 && /^\d+$/.test(stem.slice(space + 1))) return `${stem.slice(0, space)}${extension}`;
	const paren = stem.lastIndexOf(' (');
	if (paren < 0 || !stem.endsWith(')')) return undefined;
	const description = stem.slice(paren + 2, -1).toLowerCase();
	if (!description.includes('conflicted copy')) return undefined;
	return `${stem.slice(0, paren)}${extension}`;
}

export type NewFile = 'written' | 'taken';

export function errorCode(error: unknown): unknown {
	return error instanceof Error && 'code' in error ? error.code : undefined;
}

async function syncPath(path: string): Promise<void> {
	const file = await open(path, 'r');
	try {
		await file.sync();
	} finally {
		await file.close();
	}
}

// `sync()` před přejmenováním dělá z „dočasný soubor + rename" skutečnou ochranu: bez něj drží obsah
// jen page cache, kdežto rename se do žurnálu dostane hned. Nepovedený zápis dočasný soubor smaže.
export async function writeAtomic(target: string, content: Uint8Array): Promise<void> {
	if (basename(target) === '') throw new Error(`Zápis selhal: ${target} není soubor.`);
	const temporary = `${target}${randomBytes(3).toString('hex')}.tmp`;
	try {
		await writeFile(temporary, content, { flag: 'wx' });
		await syncPath(temporary);
		await rename(temporary, target);
	} catch (error) {
		await Promise.allSettled([rm(temporary)]);
		throw new Error(`Zápis selhal: ${errorText(error)}`, { cause: error });
	}
	await Promise.allSettled([syncPath(dirname(target))]);
}

// `rename` na Unixu cíl mlčky přepíše, takže se jméno nejdřív atomicky zabere přes `wx` a obsah se
// přejmenuje přes vlastní prázdnou rezervaci.
export async function writeNew(target: string, content: Uint8Array): Promise<NewFile> {
	try {
		await writeFile(target, new Uint8Array(), { flag: 'wx' });
	} catch (error) {
		if (errorCode(error) === 'EEXIST') return 'taken';
		throw new Error(`Zápis selhal: ${errorText(error)}`, { cause: error });
	}
	try {
		await writeAtomic(target, content);
	} catch (error) {
		await Promise.allSettled([rm(target)]);
		throw error;
	}
	return 'written';
}

// Velikost se ptá dřív než čtení: sken Dokumentů narazí na video o 8 GB a celé v paměti by appku
// shodilo. Čtení se zastaví na stropu i tehdy, když soubor mezi dotazem a čtením naroste.
export async function readDocument(path: string): Promise<Uint8Array> {
	const file = await open(path, 'r');
	try {
		const { size } = await file.stat();
		// Stryker disable next-line BlockStatement,ConditionalExpression: test pak vypisuje 64 MB obsahu déle než limit.
		if (size > MAX_DOCUMENT_BYTES) {
			throw new Error(`soubor má víc než ${MAX_DOCUMENT_BYTES / MIB} MB — takhle doklad nevypadá`);
		}
		const chunks: Buffer[] = [];
		const stream = file.createReadStream({ end: MAX_DOCUMENT_BYTES - 1 });
		for await (const chunk of stream) {
			chunks.push(chunk);
		}
		const content = Buffer.concat(chunks);
		return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
	} finally {
		await file.close();
	}
}
