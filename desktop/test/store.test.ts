import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dateIn, today } from '~/utils/date';

import { isDirectory, names } from './support.ts';

import {
	cacheDir,
	DATA_FILES,
	dataDir,
	readDataFile,
	saveSnapshot,
	snapshotDir,
	snapshotsPath,
	weekOf,
	writeDataFile,
} from '../store.ts';

// Výpis složky v obráceném pořadí: APFS vrací jména seřazená, jiný disk nemusí.
const listing = vi.hoisted((): { reversed: boolean } => ({ reversed: false }));
// Složka, do které přejmenování selže: zápis dočasného souboru projde, dokončení ne.
const renames = vi.hoisted((): { blocked: string } => ({ blocked: '' }));

vi.mock(import('node:fs/promises'), async (importOriginal) => {
	const fs = await importOriginal();
	return {
		...fs,
		rename: async (...args: Parameters<typeof fs.rename>) => {
			if (renames.blocked && String(args[1]).startsWith(renames.blocked)) throw new Error('disk je plný');
			await fs.rename(...args);
		},
		readdir: async (...args: Parameters<typeof fs.readdir>) => {
			const entries = await fs.readdir(...args);
			return listing.reversed ? entries.toReversed() : entries;
		},
	};
});

let base = '';

beforeEach(async () => {
	listing.reversed = false;
	renames.blocked = '';
	base = await mkdtemp(join(tmpdir(), 'fakturian-store-'));
});

afterEach(async () => {
	await rm(base, { recursive: true });
});

async function data(vault: string): Promise<string> {
	await mkdir(dataDir(vault), { recursive: true });
	return dataDir(vault);
}

async function snapshots(vault: string, name: string): Promise<string[]> {
	const all = await names(snapshotDir(vault));
	const mine = all.filter((file) => file.startsWith(`${name}.`));
	return Promise.all(mine.map((file) => readFile(join(snapshotDir(vault), file), 'utf8')));
}

async function temporaryFiles(vault: string): Promise<string[]> {
	const all = await names(dataDir(vault));
	return all.filter((file) => file.includes('tmp') || file.startsWith('~'));
}

async function contents(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = entries.filter((entry) => entry.isFile());
	const texts = await Promise.all(files.map((entry) => readFile(join(dir, entry.name), 'utf8')));
	return texts.toSorted((a, b) => a.localeCompare(b));
}

describe('datové soubory', () => {
	it('každá doména má vlastní soubor v .fakturian/', async () => {
		expect(
			await writeDataFile({
				vaultPath: base,
				name: 'platby.json',
				json: '{"20260001":{"paid":true}}',
			}),
		).toBe('written');
		expect(
			await writeDataFile({
				vaultPath: base,
				name: 'vydaje.json',
				json: '{"expenses":[]}',
			}),
		).toBe('written');

		expect(await names(base)).toEqual(['.fakturian']);
		expect(await names(dataDir(base))).toEqual(['platby.json', 'vydaje.json']);
		expect(
			await readDataFile({
				vaultPath: base,
				name: 'platby.json',
			}),
		).toBe('{\n  "20260001": {\n    "paid": true\n  }\n}');
		expect(
			await readDataFile({
				vaultPath: base,
				name: 'vydaje.json',
			}),
		).toBe('{\n  "expenses": []\n}');
	});

	it('chybějící soubor vrátí prázdný objekt a složku nezaloží', async () => {
		for (const name of DATA_FILES) {
			expect(
				await readDataFile({
					vaultPath: base,
					name,
				}),
			).toBe('{}');
		}
		expect(await names(base)).toEqual([]);

		await data(base);
		expect(
			await readDataFile({
				vaultPath: base,
				name: 'platby.json',
			}),
		).toBe('{}');
	});

	it('soubor se zapíše čitelně a s pořadím klíčů', async () => {
		await writeDataFile({
			vaultPath: base,
			name: 'nastaveni.json',
			json: '{\n  "supplier": null,\n  "contacts": [],\n  "pricelist": []\n}',
		});

		expect(await readFile(join(dataDir(base), 'nastaveni.json'), 'utf8')).toBe(
			'{\n  "supplier": null,\n  "contacts": [],\n  "pricelist": []\n}',
		);
	});

	it('celé desetinné číslo se zapíše bez .0', async () => {
		await writeDataFile({
			vaultPath: base,
			name: 'platby.json',
			json: '{"a":1.0,"b":1e2,"c":0.5}',
		});

		expect(await readFile(join(dataDir(base), 'platby.json'), 'utf8')).toBe(
			'{\n  "a": 1,\n  "b": 100,\n  "c": 0.5\n}',
		);
	});

	it('zápis je atomický a nenechá dočasný soubor', async () => {
		await writeDataFile({
			vaultPath: base,
			name: 'platby.json',
			json: '{"payments":{}}',
		});

		expect(await temporaryFiles(base)).toEqual([]);
	});

	it('cizí jméno souboru se odmítne', async () => {
		for (const bad of ['../tajne.json', '../../etc/passwd', 'faktury/20260001.pdf', 'cokoli.json', '/etc/passwd']) {
			const expected = new Error(`Neznámý datový soubor: ${bad}`);
			await expect(
				readDataFile({
					vaultPath: base,
					name: bad,
				}),
			).rejects.toEqual(expected);
			await expect(
				writeDataFile({
					vaultPath: base,
					name: bad,
					json: '{}',
				}),
			).rejects.toEqual(expected);
		}
		expect(await names(base)).toEqual([]);
	});

	it('nevalidní JSON se odmítne se jménem souboru', async () => {
		await expect(
			writeDataFile({
				vaultPath: base,
				name: 'vydaje.json',
				json: '{tohle není JSON',
			}),
		).rejects.toEqual(
			new Error('Soubor vydaje.json má poškozený obsah: není to platný JSON.', {
				cause: expect.any(SyntaxError),
			}),
		);
	});

	it('pole, holá hodnota ani null místo objektu neprojdou', async () => {
		const expected = new Error('Soubor vydaje.json musí být JSON objekt, ne pole nebo hodnota.');

		await expect(
			writeDataFile({
				vaultPath: base,
				name: 'vydaje.json',
				json: '[1,2,3]',
			}),
		).rejects.toEqual(expected);
		await expect(
			writeDataFile({
				vaultPath: base,
				name: 'vydaje.json',
				json: '42',
			}),
		).rejects.toEqual(expected);
		await expect(
			writeDataFile({
				vaultPath: base,
				name: 'vydaje.json',
				json: 'null',
			}),
		).rejects.toEqual(expected);
	});

	it('číslo mimo rozsah se odmítne, místo aby z něj zbyl null', async () => {
		await expect(
			writeDataFile({
				vaultPath: base,
				name: 'platby.json',
				json: '{"payments":{"a":1e400}}',
			}),
		).rejects.toEqual(
			new Error('Soubor platby.json má poškozený obsah: není to platný JSON.', {
				cause: new SyntaxError('číslo u klíče „a“ je mimo rozsah'),
			}),
		);
	});

	it('čtení rozbitého souboru selže nahlas', async () => {
		await writeFile(join(await data(base), 'vydaje.json'), '{rozbito');

		await expect(
			readDataFile({
				vaultPath: base,
				name: 'vydaje.json',
			}),
		).rejects.toEqual(
			new Error('Soubor vydaje.json má poškozený obsah: není to platný JSON.', {
				cause: expect.any(SyntaxError),
			}),
		);
	});

	it('soubor, který není UTF-8, se nenačte', async () => {
		await writeFile(join(await data(base), 'platby.json'), new Uint8Array([0x7b, 0xff, 0x7d]));

		await expect(
			readDataFile({
				vaultPath: base,
				name: 'platby.json',
			}),
		).rejects.toEqual(
			new Error('Soubor platby.json nejde přečíst: The encoded data was not valid for encoding utf-8', {
				cause: expect.objectContaining({ code: 'ERR_ENCODING_INVALID_ENCODED_DATA' }),
			}),
		);
	});

	it('soubor s BOM se načte jako kanonický JSON a zápis ho přepíše bez BOM', async () => {
		const target = join(await data(base), 'platby.json');
		await writeFile(target, '\uFEFF{"a":1}');

		expect(
			await readDataFile({
				vaultPath: base,
				name: 'platby.json',
			}),
		).toBe('{\n  "a": 1\n}');
		expect(
			await writeDataFile({
				vaultPath: base,
				name: 'platby.json',
				json: '{"a":2}',
			}),
		).toBe('written');

		expect(await readFile(target, 'utf8')).toBe('{\n  "a": 2\n}');
	});

	it('složka místo datového souboru není chybějící soubor', async () => {
		const target = join(await data(base), 'platby.json');
		await mkdir(target);

		await expect(
			readDataFile({
				vaultPath: base,
				name: 'platby.json',
			}),
		).rejects.toEqual(
			new Error(`Soubor platby.json nejde přečíst: EISDIR: illegal operation on a directory, read`, {
				cause: expect.objectContaining({ code: 'EISDIR' }),
			}),
		);
	});

	it('zápis přes složku místo datového souboru ji nechá beze změny', async () => {
		const target = join(await data(base), 'platby.json');
		await mkdir(target);

		await expect(
			writeDataFile({
				vaultPath: base,
				name: 'platby.json',
				json: '{"payments":{}}',
			}),
		).rejects.toEqual(
			new Error(`Soubor platby.json nejde přečíst: EISDIR: illegal operation on a directory, read`, {
				cause: expect.objectContaining({ code: 'EISDIR' }),
			}),
		);
		expect(await isDirectory(target)).toBe(true);
		expect(await temporaryFiles(base)).toEqual([]);
	});

	it('soubor místo skryté složky blokuje čtení i zápis', async () => {
		const dir = dataDir(base);
		await writeFile(dir, 'není složka');

		await expect(
			readDataFile({
				vaultPath: base,
				name: 'platby.json',
			}),
		).rejects.toEqual(
			new Error(`Datovou složku ${dir} nejde přečíst: ENOTDIR: not a directory, scandir '${dir}'`, {
				cause: expect.objectContaining({ code: 'ENOTDIR' }),
			}),
		);
		await expect(
			writeDataFile({
				vaultPath: base,
				name: 'platby.json',
				json: '{"payments":{}}',
			}),
		).rejects.toEqual(
			new Error(`Složku ${dir} nejde založit: EEXIST: file already exists, mkdir '${dir}'`, {
				cause: expect.objectContaining({ code: 'EEXIST' }),
			}),
		);
		expect(await isDirectory(dir)).toBe(false);
	});

	it('nečitelný datový soubor se nepřepíše', async () => {
		const target = join(await data(base), 'platby.json');
		const original = '{"20260001":{"paid":true}}';
		await writeFile(target, original);
		await chmod(target, 0o200);

		try {
			await expect(
				writeDataFile({
					vaultPath: base,
					name: 'platby.json',
					json: '{}',
				}),
			).rejects.toEqual(
				new Error(`Soubor platby.json nejde přečíst: EACCES: permission denied, open '${target}'`, {
					cause: expect.objectContaining({ code: 'EACCES' }),
				}),
			);
		} finally {
			await chmod(target, 0o600);
		}
		expect(await readFile(target, 'utf8')).toBe(original);
	});

	it('smazáním cache a záloh se nic neztratí', async () => {
		await writeDataFile({
			vaultPath: base,
			name: 'platby.json',
			json: '{"a":1}',
		});
		await writeDataFile({
			vaultPath: base,
			name: 'platby.json',
			json: '{"20260001":{"paid":true}}',
		});
		expect(await isDirectory(snapshotDir(base))).toBe(true);
		await mkdir(cacheDir(base), { recursive: true });

		await rm(snapshotDir(base), { recursive: true });
		await rm(cacheDir(base), { recursive: true });

		expect(
			await readDataFile({
				vaultPath: base,
				name: 'platby.json',
			}),
		).toBe('{\n  "20260001": {\n    "paid": true\n  }\n}');
	});
});

describe('synchronizační kopie', () => {
	it('iCloud zástupce není prázdná doména', async () => {
		await writeFile(join(await data(base), '.platby.json.icloud'), '');
		const expected = new Error(
			'Datový soubor platby.json má synchronizační zástupce nebo konfliktní kopie: .platby.json.icloud. ' +
				'Otevři datovou složku ve Finderu a rozhodni, která verze platí; do té doby ' +
				'Fakturian soubor nenačte ani nepřepíše.',
		);

		await expect(
			readDataFile({
				vaultPath: base,
				name: 'platby.json',
			}),
		).rejects.toEqual(expected);
		await expect(
			writeDataFile({
				vaultPath: base,
				name: 'platby.json',
				json: '{"payments":{}}',
			}),
		).rejects.toEqual(expected);
		expect(await names(dataDir(base))).toEqual(['.platby.json.icloud']);
	});

	it('konfliktní kopie blokují čtení i zápis domény', async () => {
		const dir = await data(base);
		await writeFile(join(dir, 'platby.json'), '{"payments":{"a":1}}');
		await writeFile(join(dir, 'platby 2.json'), '{"payments":{"a":2}}');
		await writeFile(join(dir, 'platby (Mac conflicted copy).json'), '{"payments":{"a":3}}');
		await writeFile(join(dir, 'vydaje 2.json'), '{}');
		const expected = new Error(
			'Datový soubor platby.json má synchronizační zástupce nebo konfliktní kopie: ' +
				'platby (Mac conflicted copy).json, platby 2.json. ' +
				'Otevři datovou složku ve Finderu a rozhodni, která verze platí; do té doby ' +
				'Fakturian soubor nenačte ani nepřepíše.',
		);

		await expect(
			readDataFile({
				vaultPath: base,
				name: 'platby.json',
			}),
		).rejects.toEqual(expected);
		await expect(
			writeDataFile({
				vaultPath: base,
				name: 'platby.json',
				json: '{"payments":{}}',
			}),
		).rejects.toEqual(expected);
		expect(await readFile(join(dir, 'platby.json'), 'utf8')).toBe('{"payments":{"a":1}}');
		expect(await readFile(join(dir, 'platby 2.json'), 'utf8')).toBe('{"payments":{"a":2}}');
		expect(await readFile(join(dir, 'platby (Mac conflicted copy).json'), 'utf8')).toBe('{"payments":{"a":3}}');
	});
});

describe('konflikty zápisu', () => {
	it('tatáž složka přes symlink nebo .. je tentýž soubor', async () => {
		const link = join(base, 'odkaz');
		await mkdir(join(base, 'vault'));
		await symlink(join(base, 'vault'), link);
		const target = join(await data(join(base, 'vault')), 'platby.json');
		await writeFile(target, '{"a":1}');
		await readDataFile({
			vaultPath: join(base, 'vault'),
			name: 'platby.json',
		});

		expect(
			await writeDataFile({
				vaultPath: link,
				name: 'platby.json',
				json: '{"a":2}',
			}),
		).toBe('written');
		expect(
			await writeDataFile({
				vaultPath: join(base, 'vault', '..', 'vault'),
				name: 'platby.json',
				json: '{"a":3}',
			}),
		).toBe('written');
		await writeFile(target, '{"a":"z jiného Macu"}');
		expect(
			await writeDataFile({
				vaultPath: link,
				name: 'platby.json',
				json: '{"a":4}',
			}),
		).toBe('conflict');
	});

	it('cizí změna od přečtení se nepřepíše', async () => {
		const target = join(await data(base), 'platby.json');
		await writeFile(target, '{"a":1}');
		await readDataFile({
			vaultPath: base,
			name: 'platby.json',
		});
		await writeFile(target, '{"a":"z jiného Macu"}');

		expect(
			await writeDataFile({
				vaultPath: base,
				name: 'platby.json',
				json: '{"a":2}',
			}),
		).toBe('conflict');

		expect(await readFile(target, 'utf8')).toBe('{"a":"z jiného Macu"}');
		expect(await names(dataDir(base))).toEqual(['platby.json']);
	});

	it('soubor založený jinde po přečtení prázdného vaultu se nepřepíše', async () => {
		await readDataFile({
			vaultPath: base,
			name: 'platby.json',
		});
		const target = join(await data(base), 'platby.json');
		await writeFile(target, '{"a":"z jiného Macu"}');

		expect(
			await writeDataFile({
				vaultPath: base,
				name: 'platby.json',
				json: '{"a":2}',
			}),
		).toBe('conflict');

		expect(await readFile(target, 'utf8')).toBe('{"a":"z jiného Macu"}');
	});

	it('existující soubor, který appka nečetla, se nepřepíše', async () => {
		const old = join(base, 'stara');
		const fresh = join(base, 'nova');
		await writeFile(join(await data(old), 'platby.json'), '{"a":"stará"}');
		await readDataFile({
			vaultPath: old,
			name: 'platby.json',
		});
		const target = join(await data(fresh), 'platby.json');
		await writeFile(target, '{"a":"nová"}');

		expect(
			await writeDataFile({
				vaultPath: fresh,
				name: 'platby.json',
				json: '{"a":"stará"}',
			}),
		).toBe('conflict');

		expect(await readFile(target, 'utf8')).toBe('{"a":"nová"}');
		await readDataFile({
			vaultPath: fresh,
			name: 'platby.json',
		});
		expect(
			await writeDataFile({
				vaultPath: fresh,
				name: 'platby.json',
				json: '{"a":2}',
			}),
		).toBe('written');
	});

	it('soubor smazaný jinde se z paměti znovu nezaloží', async () => {
		await writeDataFile({
			vaultPath: base,
			name: 'platby.json',
			json: '{"a":1}',
		});
		await rm(join(dataDir(base), 'platby.json'));

		expect(
			await writeDataFile({
				vaultPath: base,
				name: 'platby.json',
				json: '{"a":2}',
			}),
		).toBe('conflict');

		expect(await names(dataDir(base))).toEqual([]);
	});

	it('soubor smazaný jinde jde po novém načtení zase zapsat', async () => {
		await writeDataFile({
			vaultPath: base,
			name: 'platby.json',
			json: '{"a":1}',
		});
		await rm(join(dataDir(base), 'platby.json'));

		expect(
			await readDataFile({
				vaultPath: base,
				name: 'platby.json',
			}),
		).toBe('{}');
		expect(
			await writeDataFile({
				vaultPath: base,
				name: 'platby.json',
				json: '{"a":2}',
			}),
		).toBe('written');
	});

	it('vlastní zápisy po sobě konflikt nehlásí', async () => {
		await data(base);
		await readDataFile({
			vaultPath: base,
			name: 'platby.json',
		});

		expect(
			await writeDataFile({
				vaultPath: base,
				name: 'platby.json',
				json: '{"a":1}',
			}),
		).toBe('written');
		expect(
			await writeDataFile({
				vaultPath: base,
				name: 'platby.json',
				json: '{"a":2}',
			}),
		).toBe('written');

		expect(
			await readDataFile({
				vaultPath: base,
				name: 'platby.json',
			}),
		).toBe('{\n  "a": 2\n}');
	});

	it('souběžné zápisy téhož souboru proběhnou po sobě', async () => {
		const outcomes = await Promise.all([
			writeDataFile({
				vaultPath: base,
				name: 'platby.json',
				json: '{"a":1}',
			}),
			writeDataFile({
				vaultPath: base,
				name: 'platby.json',
				json: '{"a":2}',
			}),
		]);

		expect(outcomes).toEqual(['written', 'written']);
		expect(
			await readDataFile({
				vaultPath: base,
				name: 'platby.json',
			}),
		).toBe('{\n  "a": 2\n}');
		expect(await snapshots(base, 'platby.json')).toEqual(['{\n  "a": 1\n}']);
	});
});

describe('zálohy datových souborů', () => {
	it('záloha vznikne před přepsáním a drží předchozí obsah', async () => {
		await writeDataFile({
			vaultPath: base,
			name: 'platby.json',
			json: '{"a":1}',
		});
		expect(await names(dataDir(base))).toEqual(['platby.json']);

		await writeDataFile({
			vaultPath: base,
			name: 'platby.json',
			json: '{"a":2}',
		});

		expect(await snapshots(base, 'platby.json')).toEqual(['{\n  "a": 1\n}']);
	});

	it('zálohy se uklízejí po doménách', async () => {
		await writeDataFile({
			vaultPath: base,
			name: 'vydaje.json',
			json: '{"a":0}',
		});
		await writeDataFile({
			vaultPath: base,
			name: 'vydaje.json',
			json: '{"a":1}',
		});
		for (let i = 0; i < 15; i++) {
			await writeDataFile({
				vaultPath: base,
				name: 'platby.json',
				json: `{"a":${i}}`,
			});
		}

		expect(await snapshots(base, 'vydaje.json')).toEqual(['{\n  "a": 0\n}']);
	});

	it('zablokovaná složka záloh nezablokuje zápis dat', async () => {
		await writeDataFile({
			vaultPath: base,
			name: 'platby.json',
			json: '{"a":1}',
		});
		await writeFile(snapshotDir(base), 'není složka');

		expect(
			await writeDataFile({
				vaultPath: base,
				name: 'platby.json',
				json: '{"a":2}',
			}),
		).toBe('written');

		expect(await readFile(join(dataDir(base), 'platby.json'), 'utf8')).toBe('{\n  "a": 2\n}');
	});

	it('záloha, kterou nejde dopsat, po sobě nenechá nic a zápis dat projde', async () => {
		await writeDataFile({
			vaultPath: base,
			name: 'platby.json',
			json: '{"a":1}',
		});
		renames.blocked = snapshotDir(base);

		expect(
			await writeDataFile({
				vaultPath: base,
				name: 'platby.json',
				json: '{"a":2}',
			}),
		).toBe('written');

		expect(await names(snapshotDir(base))).toEqual([]);
		expect(await readFile(join(dataDir(base), 'platby.json'), 'utf8')).toBe('{\n  "a": 2\n}');
	});

	it('rozbitý soubor se nepřepíše a jeho kopie zůstane v zálohách', async () => {
		const target = join(await data(base), 'platby.json');
		const broken = '{"payments":{"20260001"';
		await writeFile(target, broken);

		await expect(
			writeDataFile({
				vaultPath: base,
				name: 'platby.json',
				json: '{"payments":{}}',
			}),
		).rejects.toEqual(
			new Error(
				'Soubor platby.json ve vaultu není platný JSON, takže nejde poznat, co v něm bylo — přepsat ho by ' +
					`ta data zahodilo. Kopie je v ${snapshotDir(base)}. Oprav soubor, nebo ho odsud smaž.`,
				{ cause: expect.any(SyntaxError) },
			),
		);
		expect(await readFile(target, 'utf8')).toBe(broken);
		expect(await names(snapshotDir(base))).toEqual([`platby.json.${today()}.json`]);
		expect(await snapshots(base, 'platby.json')).toEqual([broken]);
	});

	it('cesta k zálohám je jen tehdy, když nějaká záloha existuje', async () => {
		expect(await snapshotsPath({ vaultPath: base })).toBe(null);

		await mkdir(snapshotDir(base), { recursive: true });
		await writeFile(join(snapshotDir(base), '.DS_Store'), 'smetí');
		expect(await snapshotsPath({ vaultPath: base })).toBe(null);

		await writeFile(join(snapshotDir(base), 'platby.json.2026-09-14.json'), '{}');
		expect(await snapshotsPath({ vaultPath: base })).toBe(snapshotDir(base));
	});
});

describe('týdenní zálohy', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime('2026-09-14T12:00');
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('týdny začínají pondělím', () => {
		expect(weekOf(dateIn(2026, 9, 14))).toBe(weekOf(dateIn(2026, 9, 20)));
		expect(weekOf(dateIn(2026, 9, 21)) - weekOf(dateIn(2026, 9, 14))).toBe(1);
	});

	it('zápisy jednoho týdne drží zálohu z doby před první změnou', async () => {
		for (let i = 0; i < 15; i++) {
			await writeDataFile({
				vaultPath: base,
				name: 'platby.json',
				json: `{"a":${i}}`,
			});
		}

		expect(await names(snapshotDir(base))).toEqual(['platby.json.2026-09-14.json']);
		expect(await snapshots(base, 'platby.json')).toEqual(['{\n  "a": 0\n}']);
	});

	it('druhá záloha v témže týdnu nechá první', async () => {
		await saveSnapshot(base, 'platby.json', 'json', new TextEncoder().encode('první'));
		await saveSnapshot(base, 'platby.json', 'json', new TextEncoder().encode('druhá'));

		expect(await names(base)).toEqual(['platby.json.2026-09-14.json']);
		expect(await contents(base)).toEqual(['první']);
	});

	it('úklid nechá první zálohu každého týdne', async () => {
		vi.setSystemTime('2026-09-17T12:00');
		await writeFile(join(base, 'platby.json.2026-09-14.json'), 'pondělí');
		await writeFile(join(base, 'platby.json.2026-09-17.json'), 'čtvrtek');
		await writeFile(join(base, 'platby.json.2026-09-08.json'), 'minulý týden');

		await saveSnapshot(base, 'platby.json', 'json', new TextEncoder().encode('nová'));

		expect(await contents(base)).toEqual(['minulý týden', 'pondělí']);
	});

	it('záloha z minulého týdne novou zálohu nezastoupí', async () => {
		await writeFile(join(base, 'platby.json.2026-09-08.json'), 'minulý týden');

		await saveSnapshot(base, 'platby.json', 'json', new TextEncoder().encode('nová'));

		expect(await contents(base)).toEqual(['minulý týden', 'nová']);
	});

	it('úklid nezávisí na pořadí, v jakém systém složku vypíše', async () => {
		vi.setSystemTime('2026-09-17T12:00');
		await writeFile(join(base, 'platby.json.2026-09-14.json'), 'pondělí');
		await writeFile(join(base, 'platby.json.2026-09-17.json'), 'čtvrtek');
		listing.reversed = true;

		await saveSnapshot(base, 'platby.json', 'json', new TextEncoder().encode('nová'));

		expect(await contents(base)).toEqual(['pondělí']);
	});

	it('zálohy starší pěti týdnů zmizí a zálohy jiného dokladu zůstanou', async () => {
		for (const monday of [
			'2026-08-03',
			'2026-08-10',
			'2026-08-17',
			'2026-08-24',
			'2026-08-31',
			'2026-09-07',
			'2026-09-14',
		]) {
			await writeFile(join(base, `2026.1.${monday}.pdf`), monday);
		}
		await writeFile(join(base, '2026.2026-08-03.pdf'), 'jiný doklad');

		await saveSnapshot(base, '2026.1', 'pdf', new TextEncoder().encode('nová'));

		expect(await contents(base)).toEqual([
			'2026-08-17',
			'2026-08-24',
			'2026-08-31',
			'2026-09-07',
			'2026-09-14',
			'jiný doklad',
		]);
	});

	it('jméno zálohy se čte zprava a cizí položky složky zůstanou', async () => {
		await mkdir(join(base, 'faktury'));
		await writeFile(join(base, 'platby.json'), 'bez razítka');
		await writeFile(join(base, 'platby.json.2026-02-30.json'), 'neplatné datum');

		await saveSnapshot(base, 'platby.json', 'json', new TextEncoder().encode('nová'));

		expect(await names(base)).toEqual([
			'faktury',
			'platby.json',
			'platby.json.2026-02-30.json',
			'platby.json.2026-09-14.json',
		]);
		expect(await readFile(join(base, 'platby.json.2026-09-14.json'), 'utf8')).toBe('nová');
	});

	it('do složky záloh, kterou nejde vypsat, se záloha přesto zapíše', async () => {
		await chmod(base, 0o300);

		try {
			await saveSnapshot(base, 'platby.json', 'json', new TextEncoder().encode('nová'));
		} finally {
			await chmod(base, 0o700);
		}

		expect(await contents(base)).toEqual(['nová']);
	});
});
