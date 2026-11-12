import { copyFile, mkdtemp, readdir, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import contract from '~/utils/fixtures/adopt-folder.json' with { type: 'json' };

import { names } from './support.ts';

import { adoptDocuments, scanVault } from '../adopt.ts';
import { listInvoices, listUsedNumbers } from '../invoice/index.ts';
import { parseIsdoc } from '../invoice/isdoc.ts';
import { ISSUING_SYSTEM } from '../isdoc/mod.ts';
import { loadPdf, readIsdoc } from '../pdf.ts';

import type { AdoptScan } from '~/bindings';

// Tři smyšlené faktury z cizího fakturačního systému; původ popisuje `fixtures/README.md`.
const SAMPLES = fileURLToPath(new URL('fixtures/adopt/', import.meta.url));

let base = '';

beforeEach(async () => {
	base = await mkdtemp(join(tmpdir(), 'fakturian-adopt-folder-'));
	for (const name of await readdir(SAMPLES)) await copyFile(join(SAMPLES, name), join(base, name));
	const copied = await names(base);
	if (copied.join('|') !== 'Vydaná faktura - 2026017.pdf|Vydaná faktura - 2026018.pdf|Vydaná faktura - 2026022.pdf') {
		throw new Error(`Vzorky převzetí chybí: ${copied.join(', ')}`);
	}
});

afterEach(async () => {
	await rm(base, { recursive: true });
});

function scan(): Promise<AdoptScan> {
	return scanVault({
		vaultPath: base,
		ourIco: null,
	});
}

describe('převzetí složky s exportem z cizího systému', () => {
	it('obří soubor ve složce přeskočí, aniž by ho četl', async () => {
		const huge = join(base, 'sken-sanonu.pdf');
		await writeFile(huge, new Uint8Array());
		await truncate(huge, 8 * 1024 * 1024 * 1024);

		const offer = await scan();

		expect(offer.candidates.length).toBe(3);
		expect(offer.skipped).toEqual([
			{
				file: 'sken-sanonu.pdf',
				reason: 'nejde přečíst: soubor má víc než 64 MB — takhle doklad nevypadá',
			},
		]);
	});

	it('převezme celou složku přesně podle kontraktu', async () => {
		const offer = await scan();

		expect([offer.candidates.length, offer.skipped, offer.truncated]).toEqual([3, [], false]);
		expect(offer.candidates.map(({ file }) => file)).toEqual([
			'Vydaná faktura - 2026022.pdf',
			'Vydaná faktura - 2026018.pdf',
			'Vydaná faktura - 2026017.pdf',
		]);
		expect(offer.supplier).toEqual(contract.supplier);

		const report = await adoptDocuments({
			vaultPath: base,
			paths: offer.candidates.map(({ path }) => path),
			ourIco: contract.supplier.ico,
		});

		expect([report.imported.length, report.skipped]).toEqual([3, []]);
		expect(report.customers).toEqual(contract.customers);
		// Kopie by nechala tentýž doklad ve složce dvakrát.
		const left = await names(base);
		expect(left.filter((name) => name.endsWith('.pdf'))).toEqual([]);
		expect(await names(join(base, 'faktury'))).toEqual(['2026017.pdf', '2026018.pdf', '2026022.pdf']);

		const { items } = await listInvoices({ vaultPath: base });
		expect(items).toEqual(
			contract.invoices.map((summary) => ({
				...summary,
				path: join(base, 'faktury', `${summary.number}.pdf`),
			})),
		);

		const again = await scan();
		expect([again.candidates, again.skipped]).toEqual([[], []]);
	});

	it('vzorky jsou cizí a smyšlené', async () => {
		for (const name of await names(SAMPLES)) {
			const pdf = await loadPdf(await readFile(join(SAMPLES, name)));
			const { xml } = await readIsdoc(pdf);

			expect(xml.includes(`<IssuingSystem>${ISSUING_SYSTEM}</IssuingSystem>`)).toBe(false);
			expect(xml.includes(`<IssuingSystem>${contract.issuingSystem}</IssuingSystem>`)).toBe(true);
			const { supplier } = await parseIsdoc(xml);
			expect(supplier.ico).toBe(contract.supplier.ico);
		}
	});

	it('převzetí odvodí cizí řadu a zabere její čísla', async () => {
		const offer = await scan();
		await adoptDocuments({
			vaultPath: base,
			paths: offer.candidates.map(({ path }) => path),
			ourIco: contract.supplier.ico,
		});

		expect(offer.supplier).toEqual({
			...contract.supplier,
			invoiceNumberFormat: '{RRRR}{NNN}',
		});
		expect(await listUsedNumbers({ vaultPath: base })).toEqual(['2026017', '2026018', '2026022']);
	});
});
