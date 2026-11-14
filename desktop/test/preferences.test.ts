import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { thrownBy } from './support.ts';

import { appSupportDir, defaultVaultPath, homeDir, loadVaultPath, saveVaultPath } from '../preferences.ts';

const HOME_MISSING = 'Domovská složka není známá: proměnná prostředí HOME chybí nebo není absolutní cesta.';
const REPAIR = 'Oprav ho, nebo ho smaž a datovou složku vyber znovu.';

let home = '';
let file = '';

// Domov jde do dočasné složky, aby test nesahal na skutečné `~/Library/Application Support`.
beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), 'fakturian-preferences-'));
	file = join(home, 'Library', 'Application Support', 'com.fakturian.desktop', 'fakturian.json');
	vi.stubEnv('HOME', home);
});

afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(home, { recursive: true });
});

describe('domovská složka', () => {
	it('domov, výchozí datová složka v Dokumentech a složka appky', () => {
		expect(homeDir()).toBe(home);
		expect(defaultVaultPath()).toBe(join(home, 'Documents', 'Fakturian'));
		expect(appSupportDir()).toBe(join(home, 'Library', 'Application Support', 'com.fakturian.desktop'));
	});

	it('chybějící nebo relativní HOME se ohlásí', () => {
		vi.stubEnv('HOME', undefined);
		expect(thrownBy(homeDir)).toEqual(new Error(HOME_MISSING));

		vi.stubEnv('HOME', 'Users/jana');
		expect(thrownBy(defaultVaultPath)).toEqual(new Error(HOME_MISSING));
	});
});

describe('zapamatovaná datová složka', () => {
	it('první spuštění nemá žádnou', async () => {
		expect(await loadVaultPath()).toBe(null);
	});

	it('uložená cesta se přečte zpátky', async () => {
		expect(await saveVaultPath({ vaultPath: '/Users/jana/Documents/Fakturian' })).toBe(null);
		expect(await readFile(file, 'utf8')).toBe('{\n  "vaultPath": "/Users/jana/Documents/Fakturian"\n}');
		expect(await loadVaultPath()).toBe('/Users/jana/Documents/Fakturian');

		await saveVaultPath({ vaultPath: '/Volumes/Data/Fakturian' });
		expect(await loadVaultPath()).toBe('/Volumes/Data/Fakturian');
	});

	it('relativní cesta ani jiná hodnota než text se neuloží', async () => {
		await expect(saveVaultPath({ vaultPath: 'Documents/Fakturian' })).rejects.toThrow(
			new Error('Cestu k datové složce nejde uložit (vaultPath: Cesta musí být absolutní.).'),
		);
		await expect(saveVaultPath(JSON.parse('{"vaultPath":42}'))).rejects.toThrow(
			new Error(
				'Cestu k datové složce nejde uložit (vaultPath: Neplatný vstup: očekáváno řetězec, obdrženo číslo).',
			),
		);
		expect(await loadVaultPath()).toBe(null);
	});

	it('nepovedený zápis se ohlásí s cestou k souboru', async () => {
		await writeFile(join(home, 'Library'), '');

		await expect(saveVaultPath({ vaultPath: '/Users/jana/Fakturian' })).rejects.toThrow(
			new Error(
				`Nastavení appky ${file} nejde uložit: ENOTDIR: not a directory, mkdir '${join(home, 'Library', 'Application Support', 'com.fakturian.desktop')}'`,
				{ cause: expect.objectContaining({ code: 'ENOTDIR' }) },
			),
		);
	});

	it('nečitelný soubor se ohlásí', async () => {
		await mkdir(file, { recursive: true });

		await expect(loadVaultPath()).rejects.toThrow(
			new Error(`Nastavení appky ${file} nejde přečíst: EISDIR: illegal operation on a directory, read`, {
				cause: expect.objectContaining({ code: 'EISDIR' }),
			}),
		);
	});

	it('poškozený soubor se ohlásí, ne tiše zahodí', async () => {
		await mkdir(join(file, '..'), { recursive: true });
		for (const [content, problem, cause] of [
			['{"vaultPath":', 'je poškozené.', expect.any(SyntaxError)],
			[
				new Uint8Array([0x7b, 0xff, 0x7d]),
				'je poškozené.',
				expect.objectContaining({ code: 'ERR_ENCODING_INVALID_ENCODED_DATA' }),
			],
			['{}', 'je poškozené (vaultPath: Neplatný vstup: očekáváno řetězec, obdrženo undefined).'],
			['{"vaultPath":"Fakturian"}', 'je poškozené (vaultPath: Cesta musí být absolutní.).'],
			['{"vaultPath":"/Users/jana/Fakturian","theme":"dark"}', 'je poškozené (Neznámé klíče: "theme").'],
			['["/Users/jana/Fakturian"]', 'je poškozené (Neplatný vstup: očekáváno object, obdrženo pole).'],
		] as const) {
			await writeFile(file, content);

			await expect(loadVaultPath()).rejects.toThrow(
				new Error(`Nastavení appky ${file} ${problem} ${REPAIR}`, { cause }),
			);
		}
	});
});
