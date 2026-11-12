import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { names, rejection } from './support.ts';

import {
	compareText,
	conflictOriginalName,
	errorCode,
	icloudOriginalName,
	readDocument,
	writeAtomic,
	writeNew,
} from '../util.ts';

// Co se s otevřeným souborem stalo (`sync`, `close`); `afterStat` soubor změní mezi dotazem na
// velikost a čtením.
const disk = vi.hoisted((): { calls: string[]; afterStat: (() => Promise<void>) | undefined } => ({
	calls: [],
	afterStat: undefined,
}));

vi.mock(import('node:fs/promises'), async (importOriginal) => {
	const fs = await importOriginal();
	const { basename: nameOf } = await import('node:path');
	return {
		...fs,
		open: async (path: string, flags: string) => {
			const file = await fs.open(path, flags);
			const { sync, close, stat } = file;
			file.sync = async () => {
				disk.calls.push(`sync ${nameOf(path)}`);
				await sync.call(file);
			};
			file.close = async () => {
				disk.calls.push(`close ${nameOf(path)}`);
				await close.call(file);
			};
			file.stat = async () => {
				const info = await stat.call(file);
				await disk.afterStat?.();
				return info;
			};
			return file;
		},
	};
});

vi.mock(import('node:crypto'), async (importOriginal) => {
	const crypto = await importOriginal();
	return {
		...crypto,
		randomBytes: vi.fn(crypto.randomBytes),
	};
});

beforeEach(() => {
	disk.calls = [];
	disk.afterStat = undefined;
});

describe('pořadí a chyby', () => {
	it('text řadí podle kódů znaků, ne podle jazyka', () => {
		expect(['b', 'Č', 'a', 'B', 'a'].toSorted(compareText)).toEqual(['B', 'a', 'a', 'b', 'Č']);
		expect(compareText('a', 'a')).toBe(0);
	});

	it('kód chyby nese jen chyba systému', async () => {
		const missing = await rejection(readFile(join(tmpdir(), 'fakturian-neexistuje')));
		expect(errorCode(missing)).toBe('ENOENT');
		expect(errorCode(new Error('bez kódu'))).toBe(undefined);
		expect(errorCode('ENOENT')).toBe(undefined);
		expect(errorCode({ code: 'ENOENT' })).toBe(undefined);
	});
});

describe('jména od synchronizace', () => {
	it('z iCloud zástupce vrátí jen původní jméno', () => {
		expect(icloudOriginalName('.20260007.pdf.icloud')).toBe('20260007.pdf');
		expect(icloudOriginalName('.platby.json.ICLOUD')).toBe('platby.json');
		expect(icloudOriginalName('20260007.pdf.icloud')).toBe(undefined);
		expect(icloudOriginalName('.icloud')).toBe(undefined);
		expect(icloudOriginalName('.soubor.pdf')).toBe(undefined);
		expect(icloudOriginalName('.')).toBe(undefined);
		expect(icloudOriginalName('.platby.json.icloud.tmp')).toBe(undefined);
	});

	it('konfliktní kopie si nechá původní příponu a obyčejná čísla nechá být', () => {
		expect(conflictOriginalName('20260007 2.pdf')).toBe('20260007.pdf');
		expect(conflictOriginalName('platby (Mac conflicted copy).json')).toBe('platby.json');
		expect(conflictOriginalName('platby (iCloud CONFLICTED COPY).json')).toBe('platby.json');
		expect(conflictOriginalName('20260007.pdf')).toBe(undefined);
		expect(conflictOriginalName('20260007 x.pdf')).toBe(undefined);
		expect(conflictOriginalName('20260007 .pdf')).toBe(undefined);
		expect(conflictOriginalName('bez-pripony 2')).toBe(undefined);
		expect(conflictOriginalName('faktura (kopie).pdf')).toBe(undefined);
	});

	it('varianty konfliktních jmen neztratí skutečné číslo dokladu', () => {
		expect(conflictOriginalName('F2026 0.pdf')).toBe('F2026.pdf');
		expect(conflictOriginalName('F2026 001.PDF')).toBe('F2026.PDF');
		expect(conflictOriginalName('faktura (Windows conflicted copy).pdf')).toBe('faktura.pdf');
		expect(conflictOriginalName('faktura (conflicted copy 2).pdf')).toBe('faktura.pdf');
		expect(conflictOriginalName('faktura (conflicted copy).pdf.bak')).toBe(undefined);
		expect(conflictOriginalName('faktura 2')).toBe(undefined);
		expect(conflictOriginalName('faktura -2.pdf')).toBe(undefined);
		expect(conflictOriginalName('faktura 2.pdfx')).toBe('faktura.pdfx');
		expect(conflictOriginalName('faktura 22')).toBe(undefined);
		expect(conflictOriginalName('faktura(conflicted copy).pdf')).toBe(undefined);
		expect(conflictOriginalName('conflicted copy (kopie).pdf')).toBe(undefined);
	});

	it('konfliktní kopie jména bez kmene vrátí holou příponu', () => {
		expect(conflictOriginalName(' 2.pdf')).toBe('.pdf');
		expect(conflictOriginalName(' (conflicted copy).pdf')).toBe('.pdf');
	});
});

describe('atomický zápis', () => {
	let dir = '';

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'fakturian-atomic-'));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true });
	});

	it('nový obsah nahradí starý a vedle cíle nic nezůstane', async () => {
		const target = join(dir, 'platby.json');
		await writeFile(target, 'staré');

		vi.mocked(randomBytes).mockReturnValueOnce(Buffer.from('abcdef', 'hex'));

		await writeAtomic(target, new TextEncoder().encode('nové'));

		expect(await readFile(target, 'utf8')).toBe('nové');
		expect(await names(dir)).toEqual(['platby.json']);
		expect(disk.calls).toEqual([
			'sync platby.jsonabcdef.tmp',
			'close platby.jsonabcdef.tmp',
			`sync ${basename(dir)}`,
			`close ${basename(dir)}`,
		]);
	});

	it('dočasné jméno, které už někdo zabral, se nepřepíše ani přes symlink', async () => {
		const target = join(dir, 'platby.json');
		const outside = join(dir, 'cizi.txt');
		await writeFile(outside, 'cizí');
		await symlink(outside, `${target}abcdef.tmp`);
		vi.mocked(randomBytes).mockReturnValueOnce(Buffer.from('abcdef', 'hex'));

		await expect(writeAtomic(target, new TextEncoder().encode('nové'))).rejects.toThrow(
			new Error(`Zápis selhal: EEXIST: file already exists, open '${target}abcdef.tmp'`, {
				cause: expect.objectContaining({ code: 'EEXIST' }),
			}),
		);
		expect(await readFile(outside, 'utf8')).toBe('cizí');
		expect(await names(dir)).toEqual(['cizi.txt']);
	});

	it('zápis pod soubor místo složky ohlásí chybu', async () => {
		const parent = join(dir, 'neni-adresar');
		await writeFile(parent, 'soubor');
		const target = join(parent, 'faktura.json');

		vi.mocked(randomBytes).mockReturnValueOnce(Buffer.from('abcdef', 'hex'));

		await expect(writeAtomic(target, new TextEncoder().encode('obsah'))).rejects.toThrow(
			new Error(`Zápis selhal: ENOTDIR: not a directory, open '${target}abcdef.tmp'`, {
				cause: expect.objectContaining({ code: 'ENOTDIR' }),
			}),
		);
	});

	it('zápis potřebuje jméno souboru', async () => {
		await expect(writeAtomic('/', new TextEncoder().encode('obsah'))).rejects.toEqual(
			new Error('Zápis selhal: / není soubor.'),
		);
	});

	it('zápis přes složku nenechá dočasný soubor', async () => {
		const target = join(dir, 'faktura.json');
		await mkdir(target);
		await writeFile(join(target, 'uvnitr'), 'obsah');

		await expect(writeAtomic(target, new TextEncoder().encode('obsah'))).rejects.toThrow(
			/^Zápis selhal: EISDIR: illegal operation on a directory, rename '.*faktura\.json[0-9a-f]{6}\.tmp' -> '.*faktura\.json'$/,
		);
		expect(await names(dir)).toEqual(['faktura.json']);
	});

	it('nový soubor nikdy nepřepíše existující', async () => {
		const target = join(dir, '20260001.pdf');
		await writeFile(target, 'cizí doklad');

		expect(await writeNew(target, new TextEncoder().encode('nový'))).toBe('taken');
		expect(await readFile(target, 'utf8')).toBe('cizí doklad');

		const fresh = join(dir, '20260002.pdf');
		expect(await writeNew(fresh, new TextEncoder().encode('nový'))).toBe('written');
		expect(await readFile(fresh, 'utf8')).toBe('nový');
	});

	it('nepovedený zápis nového souboru uvolní rezervaci', async () => {
		// Dočasné jméno je o šest náhodných znaků a `.tmp` delší než cíl, takže přesáhne limit 255 bajtů.
		const target = join(dir, `${'x'.repeat(245)}.pdf`);

		await expect(writeNew(target, new TextEncoder().encode('obsah'))).rejects.toThrow(
			/^Zápis selhal: ENAMETOOLONG: name too long, open '.*x\.pdf[0-9a-f]{6}\.tmp'$/,
		);
		expect(await names(dir)).toEqual([]);

		const missing = join(dir, 'chybi', 'x.pdf');
		await expect(writeNew(missing, new TextEncoder().encode('obsah'))).rejects.toEqual(
			new Error(`Zápis selhal: ENOENT: no such file or directory, open '${missing}'`, {
				cause: expect.objectContaining({ code: 'ENOENT' }),
			}),
		);
	});
});

describe('čtení dokladu', () => {
	const limit = 64 * 1024 * 1024;
	let dir = '';

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'fakturian-document-'));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true });
	});

	// Řídký soubor: velikost bez zapsaných dat.
	async function sparse(name: string, size: number): Promise<string> {
		const path = join(dir, name);
		await writeFile(path, new Uint8Array());
		await truncate(path, size);
		return path;
	}

	it('doklad na hranici velikosti se přečte celý', async () => {
		const path = await sparse('hranice.pdf', limit);

		const content = await readDocument(path);

		expect(content.byteLength).toBe(limit);
	});

	it('soubor, který po dotazu na velikost naroste, se přečte jen po hranici', async () => {
		const path = await sparse('roste.pdf', limit);
		disk.afterStat = () => truncate(path, limit + 10);

		const content = await readDocument(path);

		expect(content.byteLength).toBe(limit);
	});

	it('soubor přes hranici se odmítne bez čtení', async () => {
		const path = await sparse('video.mp4', limit + 1);

		await expect(readDocument(path)).rejects.toEqual(new Error('soubor má víc než 64 MB — takhle doklad nevypadá'));
		expect(disk.calls).toEqual(['close video.mp4']);
	});

	it('malý doklad přečte tak, jak leží', async () => {
		const path = join(dir, 'doklad.pdf');
		await writeFile(path, '%PDF-1.7 obsah');

		expect(new TextDecoder().decode(await readDocument(path))).toBe('%PDF-1.7 obsah');
	});

	it('chybějící soubor ani složka se nepřečtou', async () => {
		const missing = join(dir, 'chybi.pdf');

		await expect(readDocument(missing)).rejects.toMatchObject({
			message: `ENOENT: no such file or directory, open '${missing}'`,
		});
		await expect(readDocument(dir)).rejects.toMatchObject({
			message: 'EISDIR: illegal operation on a directory, read',
		});
	});
});
