import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { previewInvoice } from '../../invoice/preview.ts';
import { customer, invoice } from '../invoices.ts';
import { names } from '../support.ts';

let base = '';

beforeEach(async () => {
	base = await mkdtemp(join(tmpdir(), `fakturian-preview-${process.pid}-`));
});

afterEach(async () => {
	await rm(base, { recursive: true });
});

function preview(document: unknown, vaultPath = base): Promise<string[]> {
	return previewInvoice({
		vaultPath,
		invoice: document,
	});
}

describe('náhled dokladu', () => {
	it('každou stranu vydá jako SVG a na disk nic nezapíše', async () => {
		const pages = await preview(invoice());

		expect(pages.map((page) => page.slice(0, page.indexOf(' xmlns=')))).toEqual([
			'<svg viewBox="0 0 595.275590551 841.88976378" width="595.275590551pt" height="841.88976378pt"',
		]);
		expect(await names(base)).toEqual([]);
	});

	it('dlouhý doklad má víc stran', async () => {
		const [line] = invoice().lines;

		const pages = await preview({
			...invoice(),
			lines: Array.from({ length: 80 }, () => line),
		});

		expect(pages.length).toBe(3);
	});

	it('náhled ukáže doklad, který dostal', async () => {
		const first = await preview({
			...invoice(),
			customer: {
				...customer(),
				name: 'První odběratel',
			},
		});
		const second = await preview({
			...invoice(),
			customer: {
				...customer(),
				name: 'Druhý odběratel',
			},
		});

		expect(first).not.toEqual(second);
	});

	it('nad chybějící datovou složkou se náhled nepovede', async () => {
		const missing = join(base, 'zmizela');

		await expect(preview(invoice(), missing)).rejects.toThrow(new Error(`Datová složka ${missing} neexistuje.`));
	});

	it('doklad bez položek ani v neplatném tvaru se nevysází', async () => {
		await expect(
			preview({
				...invoice(),
				lines: [],
			}),
		).rejects.toThrow(new Error('Doklad nemá žádnou položku — ISDOC vyžaduje aspoň jednu.'));
		await expect(
			preview({
				...invoice(),
				documentType: 4,
			}),
		).rejects.toThrow(new Error('Doklad má neplatný tvar (documentType: Neznámý typ dokladu 4.).'));
	});
});
