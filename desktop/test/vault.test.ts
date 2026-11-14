import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invoice } from './invoices.ts';
import { isDirectory, names, rejection } from './support.ts';

import { deleteInvoice } from '../invoice/delete.ts';
import { listInvoices, listUsedNumbers } from '../invoice/index.ts';
import { saveInvoice } from '../invoice/mod.ts';
import { qrPng } from '../invoice/payment.ts';
import { markInvoiceSent } from '../invoice/status.ts';
import { readDataFile, snapshotsPath, writeDataFile } from '../store.ts';
import {
	canonical,
	checkVault,
	ensureVault,
	junk,
	LOGO_FILE,
	moveFile,
	removeVaultLogo,
	requireWithin,
	readLogo,
	setVaultLogo,
	vaultLogoState,
} from '../vault.ts';

// Přejmenování, které selže tak, jak ho test nastaví; jinak projde skutečný `rename`.
const renaming = vi.hoisted((): { failure: Error | undefined } => ({ failure: undefined }));
// Kopie, která cíl založí a uprostřed selže.
const copying = vi.hoisted((): { failure: Error | undefined } => ({ failure: undefined }));

vi.mock(import('node:fs/promises'), async (importOriginal) => {
	const fs = await importOriginal();
	return {
		...fs,
		rename: (source: string, target: string) =>
			renaming.failure === undefined ? fs.rename(source, target) : Promise.reject(renaming.failure),
		copyFile: async (source: string, target: string) => {
			if (copying.failure === undefined) {
				await fs.copyFile(source, target);
				return;
			}
			await fs.writeFile(target, 'useknut');
			throw copying.failure;
		},
	};
});

class CodedError extends Error {
	constructor(
		message: string,
		readonly code: string,
	) {
		super(message);
	}
}

let base = '';

beforeEach(async () => {
	base = await mkdtemp(join(tmpdir(), 'fakturian-vault-'));
});

afterEach(async () => {
	await rm(base, { recursive: true });
});

describe('struktura vaultu', () => {
	it('ensureVault založí faktury/ a prijate/, ale .fakturian/ ne', async () => {
		const vault = join(base, 'vault');

		expect(await ensureVault({ vaultPath: vault })).toBe(null);

		expect(await names(vault)).toEqual(['faktury', 'prijate']);
		expect(await isDirectory(join(vault, 'faktury'))).toBe(true);
		expect(await isDirectory(join(vault, 'prijate'))).toBe(true);
	});

	it('soubor na místě prijate/ se ohlásí', async () => {
		await writeFile(join(base, 'prijate'), 'není složka');

		await expect(ensureVault({ vaultPath: base })).rejects.toEqual(
			new Error(
				`Složku ${join(base, 'prijate')} nejde založit: EEXIST: file already exists, mkdir '${join(base, 'prijate')}'`,
				{ cause: expect.objectContaining({ code: 'EEXIST' }) },
			),
		);
		expect(await isDirectory(join(base, 'prijate'))).toBe(false);
	});

	it('ensureVault jde volat opakovaně', async () => {
		await ensureVault({ vaultPath: base });
		await writeFile(join(base, 'faktury', '20260001.pdf'), 'x');

		await ensureVault({ vaultPath: base });

		expect(await readFile(join(base, 'faktury', '20260001.pdf'), 'utf8')).toBe('x');
		expect(await isDirectory(join(base, 'prijate'))).toBe(true);
	});

	it('ve složce bez práva zápisu se vault nezaloží', async () => {
		const parent = join(base, 'jen-cteni');
		await mkdir(parent);
		await chmod(parent, 0o500);

		try {
			await expect(ensureVault({ vaultPath: join(parent, 'vault') })).rejects.toEqual(
				new Error(
					`Složku ${join(parent, 'vault', 'faktury')} nejde založit: EACCES: permission denied, mkdir '${join(parent, 'vault')}'`,
				),
			);
		} finally {
			await chmod(parent, 0o700);
		}
	});
});

describe('kořen vaultu', () => {
	it('složka na místě projde kontrolou a nic se v ní nezaloží', async () => {
		expect(await checkVault({ vaultPath: base })).toBe(null);
		expect(await names(base)).toEqual([]);
	});

	it('soubor kontrolou kořene neprojde', async () => {
		const file = join(base, 'faktury.txt');
		await writeFile(file, 'tohle není složka');

		await expect(checkVault({ vaultPath: file })).rejects.toEqual(
			new Error(`Datová složka ${file} není složka, ale soubor. Vyber v nastavení jinou.`),
		);
	});

	it('soubor není vault', async () => {
		const file = join(base, 'faktury.txt');
		await writeFile(file, 'tohle není složka');

		await expect(
			readDataFile({
				vaultPath: file,
				name: 'platby.json',
			}),
		).rejects.toEqual(new Error(`Datová složka ${file} není složka, ale soubor. Vyber v nastavení jinou.`));
	});

	it('nepřístupný kořen říká, že se k němu nejde dostat', async () => {
		const closed = join(base, 'zavrena');
		const vault = join(closed, 'vault');
		await mkdir(vault, { recursive: true });
		await chmod(closed, 0o000);

		try {
			await expect(
				readDataFile({
					vaultPath: vault,
					name: 'platby.json',
				}),
			).rejects.toEqual(
				new Error(`K datové složce ${vault} se nejde dostat: EACCES: permission denied, stat '${vault}'`, {
					cause: expect.objectContaining({ code: 'EACCES' }),
				}),
			);
		} finally {
			await chmod(closed, 0o700);
		}
	});

	it('chybějící kořen je chyba, ne prázdný vault, a nezaloží se', async () => {
		const vault = join(base, 'Faktury-prejmenovano');
		const source = join(base, 'logo.png');
		await writeFile(source, 'png');
		const missing = new Error(`Datová složka ${vault} neexistuje.`, {
			cause: expect.objectContaining({ code: 'ENOENT' }),
		});

		await expect(checkVault({ vaultPath: vault })).rejects.toEqual(missing);
		await expect(
			readDataFile({
				vaultPath: vault,
				name: 'platby.json',
			}),
		).rejects.toEqual(missing);
		await expect(
			writeDataFile({
				vaultPath: vault,
				name: 'platby.json',
				json: '{}',
			}),
		).rejects.toEqual(missing);
		await expect(snapshotsPath({ vaultPath: vault })).rejects.toEqual(missing);
		await expect(
			setVaultLogo({
				vaultPath: vault,
				source,
			}),
		).rejects.toEqual(missing);
		await expect(removeVaultLogo({ vaultPath: vault })).rejects.toEqual(missing);
		await expect(listInvoices({ vaultPath: vault })).rejects.toEqual(missing);
		await expect(listUsedNumbers({ vaultPath: vault })).rejects.toEqual(missing);
		await expect(
			markInvoiceSent({
				vaultPath: vault,
				number: '20260001',
			}),
		).rejects.toEqual(missing);
		await expect(
			deleteInvoice({
				vaultPath: vault,
				number: '20260001',
			}),
		).rejects.toEqual(missing);
		await expect(
			saveInvoice({
				vaultPath: vault,
				invoice: invoice(),
				isNew: true,
			}),
		).rejects.toEqual(missing);

		expect(await names(base)).toEqual(['logo.png']);
	});
});

describe('logo', () => {
	it('vybrané logo se zkopíruje do vaultu', async () => {
		const vault = join(base, 'vault');
		await ensureVault({ vaultPath: vault });
		const source = join(base, 'moje-logo.png');
		await writeFile(source, qrPng('logo'));
		expect(await vaultLogoState({ vaultPath: vault })).toBe('missing');
		expect(await readLogo(vault)).toBe('missing');

		const result = await setVaultLogo({
			vaultPath: vault,
			source,
		});

		expect(result).toBe(null);
		expect(new Uint8Array(await readFile(join(vault, LOGO_FILE)))).toEqual(qrPng('logo'));
		expect(await vaultLogoState({ vaultPath: vault })).toBe('ready');
		expect(new Uint8Array(await readLogo(vault))).toEqual(qrPng('logo'));
	});

	it('nové logo nahradí staré a nenechá po sobě dočasný soubor', async () => {
		await writeFile(join(base, LOGO_FILE), qrPng('staré'));
		const source = join(base, 'nove-logo.png');
		await writeFile(source, qrPng('nové'));

		await setVaultLogo({
			vaultPath: base,
			source,
		});

		expect(new Uint8Array(await readFile(join(base, LOGO_FILE)))).toEqual(qrPng('nové'));
		expect(await names(base)).toEqual([LOGO_FILE, 'nove-logo.png']);
	});

	it('chybějící vault se nehlásí jako vault bez loga', async () => {
		const vault = join(base, 'odpojeny');

		await expect(vaultLogoState({ vaultPath: vault })).rejects.toEqual(
			new Error(`Datová složka ${vault} neexistuje.`),
		);
	});

	it('logo, které není PNG, je prázdné nebo je to složka, se hlásí jako nečitelné', async () => {
		for (const content of ['tohle rozhodne neni PNG', '']) {
			await writeFile(join(base, LOGO_FILE), content);

			expect(await vaultLogoState({ vaultPath: base })).toBe('unreadable');
			expect(await readLogo(base)).toBe('unreadable');
		}
		await rm(join(base, LOGO_FILE));
		await mkdir(join(base, LOGO_FILE));

		expect(await vaultLogoState({ vaultPath: base })).toBe('unreadable');
	});

	it('logo, které iCloud na tenhle Mac nestáhl, se hlásí jako nečitelné, dokud ho nenahradí nové', async () => {
		await writeFile(join(base, '.logo.png.icloud'), 'zástupce');

		expect(await vaultLogoState({ vaultPath: base })).toBe('unreadable');

		await writeFile(join(base, LOGO_FILE), qrPng('logo'));

		expect(await vaultLogoState({ vaultPath: base })).toBe('ready');
	});

	it('jiný soubor než PNG se jako logo nepřijme a staré logo zůstane', async () => {
		await writeFile(join(base, LOGO_FILE), qrPng('staré'));
		const source = join(base, 'logo.jpg');
		await writeFile(source, 'tohle rozhodně není PNG');

		await expect(
			setVaultLogo({
				vaultPath: base,
				source,
			}),
		).rejects.toEqual(new Error('Logo musí být obrázek PNG.', { cause: expect.any(Error) }));
		expect(new Uint8Array(await readFile(join(base, LOGO_FILE)))).toEqual(qrPng('staré'));
	});

	it('logo do 2 MB se přijme, větší soubor se odmítne dřív, než se načte', async () => {
		const source = join(base, 'velke.png');
		const logo = qrPng('logo');
		await writeFile(source, logo);
		await truncate(source, 2 * 1024 * 1024 + 1);

		await expect(
			setVaultLogo({
				vaultPath: base,
				source,
			}),
		).rejects.toEqual(new Error(`${source}: soubor má víc než 2 MB`, { cause: expect.any(Error) }));
		expect(await names(base)).toEqual(['velke.png']);

		const padded = new Uint8Array(2 * 1024 * 1024);
		padded.set(logo);
		await writeFile(source, padded);
		await setVaultLogo({
			vaultPath: base,
			source,
		});
		expect(await names(base)).toEqual([LOGO_FILE, 'velke.png']);
	});

	it('chybějící zdroj loga se ohlásí se svou cestou', async () => {
		const source = join(base, 'zmizele.png');

		await expect(
			setVaultLogo({
				vaultPath: base,
				source,
			}),
		).rejects.toEqual(
			new Error(`${source}: ENOENT: no such file or directory, stat '${source}'`, {
				cause: expect.objectContaining({ code: 'ENOENT' }),
			}),
		);
		expect(await names(base)).toEqual([]);
	});

	it('logo, které nejde zapsat, se ohlásí s cílovou cestou', async () => {
		const target = join(base, LOGO_FILE);
		await mkdir(join(target, 'uvnitr'), { recursive: true });
		const source = join(base, 'logo-zdroj.png');
		await writeFile(source, qrPng('logo'));

		const error = await rejection(
			setVaultLogo({
				vaultPath: base,
				source,
			}),
		);

		expect(String(error)).toMatch(
			new RegExp(
				`^Error: ${target}: Zápis selhal: EISDIR: illegal operation on a directory, rename '${target}[0-9a-f]{6}\\.tmp' -> '${target}'$`,
			),
		);
		expect(error).toHaveProperty('cause.cause.code', 'EISDIR');
		expect(await names(base)).toEqual(['logo-zdroj.png', LOGO_FILE]);
	});

	it('odebrání loga ho smaže a chybějící logo není chyba', async () => {
		await writeFile(join(base, LOGO_FILE), 'png');

		expect(await removeVaultLogo({ vaultPath: base })).toBe(null);
		expect(await names(base)).toEqual([]);

		expect(await removeVaultLogo({ vaultPath: base })).toBe(null);
	});

	it('logo, které nejde smazat, se ohlásí se svou cestou', async () => {
		const logo = join(base, LOGO_FILE);
		await mkdir(join(logo, 'uvnitr'), { recursive: true });

		await expect(removeVaultLogo({ vaultPath: base })).rejects.toEqual(
			new Error(`${logo}: Path is a directory: rm returned EISDIR (is a directory) ${logo}`, {
				cause: expect.objectContaining({ code: 'ERR_FS_EISDIR' }),
			}),
		);
		expect(await isDirectory(logo)).toBe(true);
	});
});

describe('cesty uvnitř vaultu', () => {
	it('chybějící cesta nemá kanonický tvar a hláška ji jmenuje', async () => {
		const missing = join(base, 'missing.pdf');

		await expect(canonical(missing)).rejects.toEqual(
			new Error(`${missing} nejde ověřit: ENOENT: no such file or directory, realpath '${missing}'`, {
				cause: expect.objectContaining({ code: 'ENOENT' }),
			}),
		);
	});

	it('soubor ve vaultu projde a vrátí se jeho kanonická cesta', async () => {
		const vault = join(base, 'vault');
		await ensureVault({ vaultPath: vault });
		const inside = join(vault, 'faktury', 'doklad.pdf');
		await writeFile(inside, 'pdf');

		expect(await requireWithin(vault, inside)).toBe(await realpath(inside));
		expect(await requireWithin(vault, `${vault}/faktury/../faktury/doklad.pdf`)).toBe(await realpath(inside));
		expect(await requireWithin(vault, vault)).toBe(await realpath(vault));
	});

	it('cesta přes .. ani symlink ven z vaultu neprojde', async () => {
		const vault = join(base, 'vault');
		await ensureVault({ vaultPath: vault });
		const outside = join(base, 'venku.pdf');
		await writeFile(outside, 'pdf');
		const climbing = `${vault}/faktury/../../venku.pdf`;
		const link = join(vault, 'odkaz.pdf');
		await symlink(outside, link);

		await expect(requireWithin(vault, climbing)).rejects.toEqual(new Error(`${climbing} neleží v datové složce.`));
		await expect(requireWithin(vault, link)).rejects.toEqual(new Error(`${link} neleží v datové složce.`));
	});

	it('sousední složka se stejným začátkem jména ve vaultu neleží', async () => {
		const vault = join(base, 'Faktury');
		await mkdir(vault);
		const neighbour = join(base, 'Faktury 2', 'doklad.pdf');
		await mkdir(join(base, 'Faktury 2'));
		await writeFile(neighbour, 'pdf');

		await expect(requireWithin(vault, neighbour)).rejects.toEqual(
			new Error(`${neighbour} neleží v datové složce.`),
		);
	});

	it('systémové smetí o obsahu složky nic neříká', () => {
		expect(junk('.DS_Store')).toBe(true);
		expect(junk('Icon\r')).toBe(true);
		expect(junk('.fseventsd')).toBe(true);
		for (const name of ['.localized', '.Spotlight-V100', '.Trashes', '.TemporaryItems', '.apdisk']) {
			expect([name, junk(name)]).toEqual([name, true]);
		}
		expect(junk('._platby.json')).toBe(true);
		expect(junk('platby.json.2026-09-14.json')).toBe(false);
		expect(junk('faktury')).toBe(false);
	});
});

describe('přesun souboru', () => {
	it('přesun v rámci svazku soubor přejmenuje', async () => {
		const source = join(base, 'doklad.pdf');
		const target = join(base, 'presunuty.pdf');
		await writeFile(source, 'obsah');

		await moveFile(source, target);

		expect(await names(base)).toEqual(['presunuty.pdf']);
		expect(await readFile(target, 'utf8')).toBe('obsah');
	});

	it('nepovedený přesun do chybějící složky nechá zdroj na místě', async () => {
		const source = join(base, 'doklad.pdf');
		const target = join(base, 'neexistuje', 'doklad.pdf');
		await writeFile(source, 'obsah');

		await expect(moveFile(source, target)).rejects.toEqual(
			new Error(`${source}: ENOENT: no such file or directory, rename '${source}' -> '${target}'`),
		);
		expect(await names(base)).toEqual(['doklad.pdf']);
	});

	describe('přes hranici svazku', () => {
		beforeEach(() => {
			renaming.failure = new CodedError('EXDEV: cross-device link not permitted, rename', 'EXDEV');
		});

		afterEach(() => {
			renaming.failure = undefined;
		});

		it('přesun zkopíruje soubor přes hranici svazku a zdroj smaže', async () => {
			const source = join(base, 'doklad.pdf');
			const target = join(base, 'presunuty.pdf');
			await writeFile(source, 'obsah');

			await moveFile(source, target);

			expect(await names(base)).toEqual(['presunuty.pdf']);
			expect(await readFile(target, 'utf8')).toBe('obsah');
		});

		it('nepovedená kopie přes hranici svazku ohlásí zdroj a cíl nenechá', async () => {
			const source = join(base, 'zmizely.pdf');
			const target = join(base, 'presunuty.pdf');

			await expect(moveFile(source, target)).rejects.toEqual(
				new Error(`${source}: ENOENT: no such file or directory, copyfile '${source}' -> '${target}'`, {
					cause: expect.objectContaining({ code: 'ENOENT' }),
				}),
			);
			expect(await names(base)).toEqual([]);
		});

		it('kopie useknutá uprostřed po sobě cíl nenechá', async () => {
			const source = join(base, 'doklad.pdf');
			const target = join(base, 'presunuty.pdf');
			await writeFile(source, 'obsah');
			copying.failure = new CodedError('EIO: i/o error, copyfile', 'EIO');

			try {
				await expect(moveFile(source, target)).rejects.toEqual(
					new Error(`${source}: EIO: i/o error, copyfile`, { cause: copying.failure }),
				);
			} finally {
				copying.failure = undefined;
			}
			expect(await names(base)).toEqual(['doklad.pdf']);
		});

		it('zdroj, který po kopii nejde smazat, se ohlásí', async () => {
			const locked = join(base, 'zamcena');
			await mkdir(locked);
			const source = join(locked, 'doklad.pdf');
			const target = join(base, 'presunuty.pdf');
			await writeFile(source, 'obsah');
			await chmod(locked, 0o500);

			try {
				await expect(moveFile(source, target)).rejects.toEqual(
					new Error(`${source}: EACCES: permission denied, unlink '${source}'`, {
						cause: expect.objectContaining({ code: 'EACCES' }),
					}),
				);
			} finally {
				await chmod(locked, 0o700);
			}
			expect(await readFile(source, 'utf8')).toBe('obsah');
			expect(await readFile(target, 'utf8')).toBe('obsah');
		});
	});

	it('přejmenování, které selže z jiného důvodu, nic nekopíruje', async () => {
		const source = join(base, 'doklad.pdf');
		const target = join(base, 'presunuty.pdf');
		await writeFile(source, 'obsah');
		renaming.failure = new CodedError('EACCES: permission denied, rename', 'EACCES');

		try {
			await expect(moveFile(source, target)).rejects.toEqual(
				new Error(`${source}: EACCES: permission denied, rename`, { cause: renaming.failure }),
			);
		} finally {
			renaming.failure = undefined;
		}
		expect(await names(base)).toEqual(['doklad.pdf']);
	});
});
