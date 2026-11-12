import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { exportInvoicePdf, saveInvoice } from '../../invoice/mod.ts';
import { invoice } from '../invoices.ts';
import { names } from '../support.ts';

let base = '';
let vault = '';
let downloads = '';

beforeEach(async () => {
	base = await mkdtemp(join(tmpdir(), `fakturian-export-${process.pid}-`));
	vault = join(base, 'vault');
	downloads = join(base, 'stazene');
	await mkdir(vault);
	await mkdir(downloads);
});

afterEach(async () => {
	await rm(base, { recursive: true });
});

function saved(): Promise<string> {
	return saveInvoice({
		vaultPath: vault,
		invoice: invoice(),
		isNew: true,
	});
}

function exported(target: string, number = '20260001', vaultPath = vault): Promise<null> {
	return exportInvoicePdf({
		vaultPath,
		number,
		target,
	});
}

describe('export PDF', () => {
	it('doklad se zkopíruje ven z vaultu bajt po bajtu', async () => {
		const source = await saved();
		const target = join(downloads, 'kopie.pdf');

		expect(await exported(target)).toBe(null);

		expect(await readFile(target)).toEqual(await readFile(source));
	});

	it('existující cíl se přepíše', async () => {
		const source = await saved();
		const target = join(downloads, 'faktura.pdf');
		await writeFile(target, 'starý obsah');

		await exported(target);

		expect(await readFile(target)).toEqual(await readFile(source));
		expect(await names(downloads)).toEqual(['faktura.pdf']);
	});

	it('export na doklad sám doklad nepoškodí', async () => {
		const source = await saved();
		const before = await readFile(source);

		expect(await exported(source)).toBe(null);

		expect(await readFile(source)).toEqual(before);
	});

	it('chybějící doklad se ohlásí svým číslem a nic nevznikne', async () => {
		await saved();
		const target = join(downloads, 'nic.pdf');

		await expect(exported(target, '20269999')).rejects.toThrow(
			new Error('Doklad 20269999 ve složce faktury/ není.'),
		);
		expect(await names(downloads)).toEqual([]);
	});

	it('cíl, kam nejde zapsat, se ohlásí se svou cestou', async () => {
		await saved();
		const target = join(downloads, 'neexistuje', 'faktura.pdf');

		await expect(exported(target)).rejects.toThrow(
			new Error(`PDF se nepodařilo uložit do ${target}.`, {
				cause: expect.objectContaining({ cause: expect.objectContaining({ code: 'ENOENT' }) }),
			}),
		);
	});

	it('složka, která není vault, se odmítne', async () => {
		const missing = join(base, 'neni-vault');
		const target = join(downloads, 'faktura.pdf');

		await expect(exported(target, '20260001', missing)).rejects.toThrow(
			new Error(`Datová složka ${missing} neexistuje.`),
		);
		expect(await names(downloads)).toEqual([]);
	});
});
