import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAttachment, COMPOSE_SCRIPT, mailComposeWithAttachment } from '../mail.ts';
import { run } from '../system.ts';
import { ensureVault } from '../vault.ts';

// Záznam místo spuštění: test nesmí otevřít Mail. Spouštění samo hlídá test `system.ts`.
vi.mock(import('../system.ts'), async (importOriginal) => {
	const system = await importOriginal();
	return {
		...system,
		run: vi.fn<typeof system.run>(() => Promise.resolve('')),
	};
});

const execute = promisify(execFile);

// Překlad skriptu nic nespouští, ale ověří syntaxi i slovník cílové appky a StandardAdditions.
async function osacompile(script: string): Promise<void> {
	await execute('/usr/bin/osacompile', ['-o', join(base, 'compose.scpt'), '-e', script]);
}

const PDF_ONLY = 'Přílohou e-mailu smí být jen PDF faktury.';

let base = '';
let vault = '';

beforeEach(async () => {
	base = await mkdtemp(join(tmpdir(), 'fakturian-mail-'));
	vault = join(base, 'vault');
	await ensureVault({ vaultPath: vault });
	vi.mocked(run).mockClear();
});

afterEach(async () => {
	await rm(base, { recursive: true });
});

async function invoicePdf(name = '20260001.pdf'): Promise<string> {
	const pdf = join(vault, 'faktury', name);
	await writeFile(pdf, '%PDF-1.7\n');
	return pdf;
}

describe('příloha e-mailu', () => {
	it('existující PDF ve vaultu projde a vrátí se jeho kanonická cesta', async () => {
		const pdf = await invoicePdf();

		expect(await checkAttachment(vault, pdf)).toBe(await realpath(pdf));
	});

	it('přípona PDF velkými písmeny projde', async () => {
		const pdf = await invoicePdf('20260002.PDF');

		expect(await checkAttachment(vault, pdf)).toBe(await realpath(pdf));
	});

	it('cizí soubor neprojde, ani když existuje', async () => {
		const key = join(vault, 'id_rsa');
		await writeFile(key, '-----BEGIN OPENSSH PRIVATE KEY-----\n');

		await expect(checkAttachment(vault, key)).rejects.toThrow(new Error(PDF_ONLY));
	});

	it('prázdná cesta, cesta bez přípony a skrytý soubor `.pdf` neprojdou', async () => {
		for (const path of ['', '/etc/passwd', '/tmp', join(vault, 'faktury', '.pdf')]) {
			await expect(checkAttachment(vault, path)).rejects.toThrow(new Error(PDF_ONLY));
		}
	});

	it('chybějící PDF neprojde', async () => {
		const missing = join(vault, 'faktury', 'neexistuje.pdf');

		await expect(checkAttachment(vault, missing)).rejects.toThrow(
			new Error(`Příloha ${missing} neexistuje nebo to není soubor.`),
		);
	});

	it('složka s příponou PDF neprojde', async () => {
		const folder = join(vault, 'faktury.pdf');
		await mkdir(folder);

		await expect(checkAttachment(vault, folder)).rejects.toThrow(
			new Error(`Příloha ${folder} neexistuje nebo to není soubor.`),
		);
	});

	it('existující PDF mimo vault je cizí smlouva, kterou appka odeslat nemá', async () => {
		const contract = join(base, 'smlouva.pdf');
		await writeFile(contract, '%PDF-1.7\n');

		await expect(checkAttachment(vault, contract)).rejects.toThrow(
			new Error(`${contract} neleží v datové složce.`),
		);
	});

	it('cesta ven přes `faktury/../..` neprojde', async () => {
		await writeFile(join(base, 'uniklý.pdf'), '%PDF-1.7\n');
		const hop = `${vault}/faktury/../../uniklý.pdf`;

		await expect(checkAttachment(vault, hop)).rejects.toThrow(new Error(`${hop} neleží v datové složce.`));
	});

	it('příloha bez existujícího vaultu neprojde', async () => {
		const pdf = await invoicePdf();
		const missing = join(vault, 'neexistuje');

		await expect(checkAttachment(missing, pdf)).rejects.toThrow(new Error(`Datová složka ${missing} neexistuje.`));
	});
});

describe('zpráva v Mail.app', () => {
	it('zpráva jde do skriptu doslova a v pořadí, příloha kanonickou cestou', async () => {
		const pdf = await invoicePdf();

		expect(
			await mailComposeWithAttachment({
				vaultPath: vault,
				to: ' jana"nova@example.cz ',
				subject: 'Faktura "2026" \\ end tell',
				body: 'Dobrý\nden',
				attachment: `${vault}/faktury/../faktury/20260001.pdf`,
			}),
		).toBe(null);

		expect(vi.mocked(run).mock.calls).toEqual([
			[
				'/usr/bin/osascript',
				[
					'-e',
					COMPOSE_SCRIPT,
					'jana"nova@example.cz',
					'Faktura "2026" \\ end tell',
					'Dobrý\nden',
					await realpath(pdf),
				],
				'Mail.app zprávu nevytvořil',
			],
		]);
	});

	it('znak NUL vypadne, protože ho žádný argument procesu neunese', async () => {
		const pdf = await invoicePdf();

		await mailComposeWithAttachment({
			vaultPath: vault,
			to: '',
			subject: 'Fak\0tura',
			body: 'a\0b',
			attachment: pdf,
		});

		expect(vi.mocked(run).mock.calls).toEqual([
			[
				'/usr/bin/osascript',
				['-e', COMPOSE_SCRIPT, '', 'Faktura', 'ab', await realpath(pdf)],
				'Mail.app zprávu nevytvořil',
			],
		]);
	});

	it('neplatná příloha se odmítne dřív, než se otevře Mail.app', async () => {
		await expect(
			mailComposeWithAttachment({
				vaultPath: vault,
				to: 'odberatel@example.cz',
				subject: 'Faktura',
				body: 'Dobrý den',
				attachment: '/tmp/fakturian-not-an-invoice.txt',
			}),
		).rejects.toThrow(new Error(PDF_ONLY));
		expect(run).not.toHaveBeenCalled();
	});

	it('chyba skriptu se vrátí s hláškou osascript', async () => {
		const pdf = await invoicePdf();
		vi.mocked(run).mockRejectedValueOnce(
			new Error(
				'Mail.app zprávu nevytvořil: 231:246: execution error: Mail got an error: AppleEvent timed out. (-1712)',
			),
		);

		await expect(
			mailComposeWithAttachment({
				vaultPath: vault,
				to: 'odberatel@example.cz',
				subject: 'Faktura',
				body: 'Dobrý den',
				attachment: pdf,
			}),
		).rejects.toThrow(
			new Error(
				'Mail.app zprávu nevytvořil: 231:246: execution error: Mail got an error: AppleEvent timed out. (-1712)',
			),
		);
		expect(vi.mocked(run).mock.calls).toEqual([
			[
				'/usr/bin/osascript',
				['-e', COMPOSE_SCRIPT, 'odberatel@example.cz', 'Faktura', 'Dobrý den', await realpath(pdf)],
				'Mail.app zprávu nevytvořil',
			],
		]);
	});

	it('skript se přeloží i se slovníkem Mail.app', async () => {
		await expect(osacompile(COMPOSE_SCRIPT)).resolves.toBe(undefined);
	});
});
