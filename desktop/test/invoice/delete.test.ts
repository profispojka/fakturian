import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentKind } from '~/constants/invoice';

import { deleteInvoice, moveToTrash } from '../../invoice/delete.ts';
import { listInvoices, listUsedNumbers } from '../../invoice/index.ts';
import { saveInvoice } from '../../invoice/mod.ts';
import { invoice } from '../invoices.ts';
import { loggedLines, names } from '../support.ts';

import type { Invoice } from '../../invoice/model.ts';

// Skutečný nástroj běží, dokud test neřekne jinak; podvržený odpoví jako `execFile`.
vi.mock(import('node:child_process'), async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		execFile: vi.fn<typeof actual.execFile>(actual.execFile),
	};
});

function answer(error: Error | null, stderr: string) {
	return (_file: string, _args: string[], respond: (error: Error | null, stdout: string, stderr: string) => void) => {
		respond(error, '', stderr);
	};
}

let base = '';

beforeEach(async () => {
	base = await mkdtemp(join(tmpdir(), `fakturian-delete-${process.pid}-`));
});

afterEach(async () => {
	await rm(base, { recursive: true });
});

function saveNumbered(number: string, document: Invoice = invoice()): Promise<string> {
	return saveInvoice({
		vaultPath: base,
		invoice: {
			...document,
			number,
		},
		isNew: true,
	});
}

function creditNoteFor(original: string): Invoice {
	return {
		...invoice(),
		documentType: DocumentKind.CreditNote,
		originalInvoice: original,
		lines: invoice().lines.map((line) => ({
			...line,
			unitPriceCents: -line.unitPriceCents,
		})),
	};
}

describe('smazání dokladu', () => {
	it('smazaný doklad zmizí ze složky, z výpisu i z řady čísel', async () => {
		const path = await saveNumbered('20260021');
		await saveNumbered('20260022');
		const discard = vi.fn<(path: string) => Promise<void>>(rm);

		expect(
			await deleteInvoice(
				{
					vaultPath: base,
					number: '20260021',
				},
				(file) => discard(file),
			),
		).toBe(null);

		expect(discard).toHaveBeenCalledWith(path);
		const listed = await listInvoices({ vaultPath: base });
		expect([listed.items.map(({ number }) => number), listed.broken]).toEqual([['20260022'], []]);
		expect(await listUsedNumbers({ vaultPath: base })).toEqual(['20260022']);
	});

	it('nepovedené odklizení doklad nechá a vrátí svou chybu', async () => {
		const path = await saveNumbered('20260023');
		const before = await readFile(path);

		await expect(
			deleteInvoice(
				{
					vaultPath: base,
					number: '20260023',
				},
				() => Promise.reject(new Error('Koš je plný')),
			),
		).rejects.toThrow(new Error('Koš je plný'));

		expect(await readFile(path)).toEqual(before);
		const { items } = await listInvoices({ vaultPath: base });
		expect(items.map(({ number }) => number)).toEqual(['20260023']);
	});

	it('chybějící doklad ani číslo, které je cesta, se nesmaže', async () => {
		await saveNumbered('20260024');
		const discard = vi.fn<(path: string) => Promise<void>>(rm);

		await expect(
			deleteInvoice(
				{
					vaultPath: base,
					number: '20269999',
				},
				(file) => discard(file),
			),
		).rejects.toThrow(new Error('Doklad 20269999 se nepodařilo najít.'));
		await expect(
			deleteInvoice(
				{
					vaultPath: join(base, 'neni'),
					number: '../cizi',
				},
				(file) => discard(file),
			),
		).rejects.toThrow(
			new Error(
				'Číslo dokladu může mít nejvýš 64 znaků: písmena bez diakritiky, číslice, mezery, tečky, pomlčky a podtržítka, a musí začínat i končit písmenem nebo číslicí.',
			),
		);
		expect(discard).not.toHaveBeenCalled();
		expect(await names(base)).toEqual(['faktury']);
	});

	it('číslo, které je ve složce víckrát, se nesmaže jako jeden doklad', async () => {
		const canonical = await saveNumbered('20260028');
		await copyFile(canonical, join(base, 'faktury', '20260028 2.pdf'));
		const discard = vi.fn<(path: string) => Promise<void>>(rm);

		await expect(
			deleteInvoice(
				{
					vaultPath: base,
					number: '20260028',
				},
				(file) => discard(file),
			),
		).rejects.toThrow(
			new Error('Číslo dokladu 20260028 je ve složce faktury/ víckrát. Nejdřív rozhodni konflikt ve Finderu.'),
		);
		expect(discard).not.toHaveBeenCalled();
	});

	it('fakturu s dobropisem smaže až po dobropisu', async () => {
		await saveNumbered('20260029');
		await saveNumbered('20260030', creditNoteFor('20260029'));

		await expect(
			deleteInvoice(
				{
					vaultPath: base,
					number: '20260029',
				},
				rm,
			),
		).rejects.toThrow(new Error('Faktura 20260029 má dobropis 20260030, smazat ji nejde. Nejdřív smaž dobropis.'));

		await deleteInvoice(
			{
				vaultPath: base,
				number: '20260030',
			},
			rm,
		);
		await deleteInvoice(
			{
				vaultPath: base,
				number: '20260029',
			},
			rm,
		);
		const { items } = await listInvoices({ vaultPath: base });
		expect(items).toEqual([]);
	});

	it('hláška vyjmenuje každý dobropis faktury', async () => {
		await saveNumbered('20260034');
		await saveNumbered('20260035', creditNoteFor('20260034'));
		await saveNumbered('20260036', creditNoteFor('20260034'));

		await expect(
			deleteInvoice(
				{
					vaultPath: base,
					number: '20260034',
				},
				rm,
			),
		).rejects.toThrow(
			new Error('Faktura 20260034 má dobropis 20260036, 20260035, smazat ji nejde. Nejdřív smaž dobropis.'),
		);
	});

	it('faktura, na kterou jiná faktura jen odkazuje, se smazat dá', async () => {
		await saveNumbered('20260032');
		await saveNumbered('20260033', {
			...invoice(),
			originalInvoice: '20260032',
		});

		expect(
			await deleteInvoice(
				{
					vaultPath: base,
					number: '20260032',
				},
				rm,
			),
		).toBe(null);
	});
});

describe('přesun do Koše', () => {
	// Výstup nástroje jde do logu v domovské složce, test proto nesmí psát do skutečné.
	beforeEach(() => {
		vi.stubEnv('HOME', base);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it(
		'chybějící soubor do Koše nejde, hláška ho jmenuje a výpis nástroje jde do logu',
		{ timeout: 2000 },
		async () => {
			await expect(moveToTrash('/nonexistent-fakturian/20260001.pdf')).rejects.toThrow(
				new Error('Doklad /nonexistent-fakturian/20260001.pdf se nepodařilo přesunout do Koše.'),
			);
			// Výpis nese text nástroje, pevně ho ověřuje test s podvrženým nástrojem.
			const lines = await loggedLines(base);
			expect(lines.length).toBe(1);
		},
	);

	it('přesun zavolá systémový nástroj s cestou dokladu a nic nevrací', { timeout: 2000 }, async () => {
		const path = join(base, '20260001.pdf');
		vi.mocked(execFile).mockImplementationOnce(answer(null, ''));

		await expect(moveToTrash(path)).resolves.toBe(undefined);

		expect(await loggedLines(base)).toEqual([]);
		expect(execFile).toHaveBeenLastCalledWith('/usr/bin/trash', [path], expect.any(Function));
	});

	it('nespustitelný nástroj se ohlásí stejně jako nepovedený přesun', async () => {
		const path = join(base, '20260001.pdf');
		vi.mocked(execFile).mockImplementationOnce(answer(new Error('spawn /usr/bin/trash ENOENT'), ''));

		await expect(moveToTrash(path)).rejects.toThrow(
			new Error(`Doklad ${path} se nepodařilo přesunout do Koše.`, {
				cause: new Error('spawn /usr/bin/trash ENOENT'),
			}),
		);

		expect(await loggedLines(base)).toEqual([
			`Doklad ${path} se nepodařilo přesunout do Koše. spawn /usr/bin/trash ENOENT`,
		]);
	});

	it('smazání bez vlastního úklidu posílá doklad do Koše', async () => {
		const path = await saveNumbered('20260031');
		vi.mocked(execFile).mockImplementationOnce(answer(new Error('Command failed'), 'Koš nejde otevřít\n'));

		await expect(
			deleteInvoice({
				vaultPath: base,
				number: '20260031',
			}),
		).rejects.toThrow(new Error(`Doklad ${path} se nepodařilo přesunout do Koše.`));

		expect(await names(join(base, 'faktury'))).toEqual(['20260031.pdf']);
		expect(await loggedLines(base)).toEqual([`Doklad ${path} se nepodařilo přesunout do Koše. Koš nejde otevřít`]);
	});
});
