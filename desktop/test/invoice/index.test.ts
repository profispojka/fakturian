import {
	chmod,
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	stat,
	symlink,
	utimes,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DocumentKind } from '~/constants/invoice';

import { listInvoices, listUsedNumbers } from '../../invoice/index.ts';
import { saveInvoice } from '../../invoice/mod.ts';
import { savePdf } from '../../pdf.ts';
import { cacheDir, dataDir } from '../../store.ts';
import { numbered } from '../invoices.ts';
import { invoicePdf, rewriteIsdoc, samplePdf } from '../pdfs.ts';
import { names } from '../support.ts';

import type { Invoice } from '../../invoice/model.ts';

let base = '';

beforeEach(async () => {
	base = await mkdtemp(join(tmpdir(), `fakturian-list-${process.pid}-`));
});

afterEach(async () => {
	await rm(base, { recursive: true });
});

function saveNew(document: Invoice): Promise<string> {
	return saveInvoice({
		vaultPath: base,
		invoice: document,
		isNew: true,
	});
}

function invoices(...parts: string[]): string {
	return join(base, 'faktury', ...parts);
}

async function listedNumbers(): Promise<string[]> {
	const { items } = await listInvoices({ vaultPath: base });
	return items.map(({ number }) => number);
}

function cacheFile(): string {
	return join(cacheDir(base), 'index.json');
}

// Cache, jak leží na disku: testy do ní sahají jako cizí program.
async function cache() {
	const text = await readFile(cacheFile(), 'utf8');
	return JSON.parse(text);
}

async function cachedNames(): Promise<string[]> {
	const { entries } = await cache();
	return Object.keys(entries).toSorted();
}

describe('výpis faktur', () => {
	it('doklady jdou od nejvyššího čísla i se souhrnem', async () => {
		const path = await saveNew(numbered('20260001', 'Alfa', 10_000));
		await saveNew(numbered('20260002', 'Beta', 25_000));

		const listed = await listInvoices({ vaultPath: base });

		expect(listed).toEqual({
			items: [
				{
					number: '20260002',
					customer: 'Beta',
					issueDate: '2026-05-29',
					dueDate: '2026-06-12',
					totalCents: 50_000,
					variableSymbol: '20260002',
					documentType: DocumentKind.Invoice,
					originalInvoice: '',
					sentAt: null,
					usageLines: [],
					path: invoices('20260002.pdf'),
				},
				{
					number: '20260001',
					customer: 'Alfa',
					issueDate: '2026-05-29',
					dueDate: '2026-06-12',
					totalCents: 20_000,
					variableSymbol: '20260001',
					documentType: DocumentKind.Invoice,
					originalInvoice: '',
					sentAt: null,
					usageLines: [],
					path,
				},
			],
			broken: [],
		});
	});

	it('vlastní řadu řadí podle čísla uvnitř', async () => {
		for (const number of ['F2026-9', 'F2026-10', 'F2026-8']) {
			await saveNew(numbered(number, 'Alfa', 10_000));
		}

		expect(await listedNumbers()).toEqual(['F2026-10', 'F2026-9', 'F2026-8']);
	});

	it('řádky s vazbou na ceník nese souhrn i s rokem čerpání', async () => {
		const document = numbered('20260001', 'Alfa', 10_000);
		await saveNew({
			...document,
			lines: [
				...document.lines,
				{
					description: 'Konzultace',
					quantity: 4,
					unit: 'hod',
					unitPriceCents: 120_000,
					itemId: 'p1',
					usageYear: 2025,
				},
				{
					description: 'Školení',
					quantity: 1,
					unit: 'den',
					unitPriceCents: 500_000,
					itemId: 'p2',
				},
			],
		});

		const { items } = await listInvoices({ vaultPath: base });

		expect(items[0]?.usageLines).toEqual([
			{
				itemId: 'p1',
				quantity: 4,
				usageYear: 2025,
			},
			{
				itemId: 'p2',
				quantity: 1,
			},
		]);
	});

	it('dobropis nese fakturu, kterou opravuje', async () => {
		const [line] = numbered('20260002', 'Alfa', -10_000).lines;
		await saveNew({
			...numbered('20260002', 'Alfa', -10_000),
			documentType: DocumentKind.CreditNote,
			originalInvoice: '20260001',
			note: 'Oprava ceny.',
			lines: [line!],
		});

		const { items } = await listInvoices({ vaultPath: base });

		expect(items.map((item) => [item.documentType, item.originalInvoice, item.totalCents])).toEqual([
			[DocumentKind.CreditNote, '20260001', -20_000],
		]);
	});

	it('chybějící faktury/ je prázdný vault', async () => {
		expect(await listInvoices({ vaultPath: base })).toEqual({
			items: [],
			broken: [],
		});
		expect(await listUsedNumbers({ vaultPath: base })).toEqual([]);
	});

	it('nečitelná faktury/ je chyba, ne prázdná řada', async () => {
		await saveNew(numbered('20260007', 'Alfa', 10_000));
		await chmod(invoices(), 0o000);
		const expected = new Error(
			`Složku ${invoices()} nejde přečíst: EACCES: permission denied, scandir '${invoices()}'`,
			{ cause: expect.objectContaining({ code: 'EACCES' }) },
		);

		try {
			await expect(listUsedNumbers({ vaultPath: base })).rejects.toThrow(expected);
			await expect(listInvoices({ vaultPath: base })).rejects.toThrow(expected);
		} finally {
			await chmod(invoices(), 0o700);
		}
	});
});

describe('vadné doklady ve výpisu', () => {
	it('nečitelný doklad se ohlásí vedle čitelných', async () => {
		await saveNew(numbered('20260001', 'Alfa', 10_000));
		await writeFile(invoices('20260002.pdf'), 'rozsypane');

		const listed = await listInvoices({ vaultPath: base });

		expect(listed.items.map(({ number }) => number)).toEqual(['20260001']);
		expect(listed.broken).toEqual([
			{
				fileName: '20260002.pdf',
				path: invoices('20260002.pdf'),
				reason: 'PDF nejde přečíst: Failed to parse PDF document (line:0 col:18 offset=9): No PDF header found',
			},
		]);
	});

	it('PDF bez přílohy ISDOC má vlastní důvod', async () => {
		await mkdir(invoices());
		await writeFile(invoices('20260001.pdf'), await savePdf(await samplePdf()));

		const listed = await listInvoices({ vaultPath: base });

		expect(listed).toEqual({
			items: [],
			broken: [
				{
					fileName: '20260001.pdf',
					path: invoices('20260001.pdf'),
					reason: 'PDF neobsahuje přílohu ISDOC',
				},
			],
		});
	});

	it('doklad, který by import nevzal, skončí mezi vadnými s důvodem kontroly', async () => {
		const path = await saveNew(numbered('20260001', 'Alfa', 10_000));
		await rewriteIsdoc(path, (xml) =>
			xml.replaceAll('<VATApplicable>false</VATApplicable>', '<VATApplicable>true</VATApplicable>'),
		);

		const { broken } = await listInvoices({ vaultPath: base });

		expect(broken.map(({ reason }) => reason)).toEqual(['doklad je od plátce DPH; Fakturian umí jen neplátce']);
	});

	it('jméno souboru, které nesedí s číslem dokladu, se ohlásí', async () => {
		const path = await saveNew(numbered('20260001', 'Alfa', 10_000));
		await rename(path, invoices('faktura.pdf'));

		const listed = await listInvoices({ vaultPath: base });

		expect(listed).toEqual({
			items: [],
			broken: [
				{
					fileName: 'faktura.pdf',
					path: invoices('faktura.pdf'),
					reason: 'Jméno souboru neodpovídá číslu dokladu 20260001. Přejmenuj ho na 20260001.pdf.',
				},
			],
		});
	});

	it('přejmenovaný doklad drží dál číslo, které nese, a další faktura ho nedostane', async () => {
		const path = await saveNew(numbered('20260001', 'Alfa', 10_000));
		await rename(path, invoices('faktura.pdf'));

		expect(await listUsedNumbers({ vaultPath: base })).toEqual(['20260001', 'faktura']);
		await expect(saveNew(numbered('20260001', 'Beta', 10_000))).rejects.toThrow(
			new Error('Faktura 20260001 už existuje. Zvol jiné číslo.'),
		);
	});

	it('jméno lišící se od čísla jen velikostí písmen číslo nezdvojí', async () => {
		const path = await saveNew(numbered('F2026-1', 'Alfa', 10_000));
		await rename(path, invoices('f2026-1.pdf'));

		expect(await listUsedNumbers({ vaultPath: base })).toEqual(['f2026-1']);
		await expect(
			saveInvoice({
				vaultPath: base,
				invoice: numbered('F2026-1', 'Beta', 10_000),
				isNew: false,
			}),
		).resolves.toBe(invoices('f2026-1.pdf'));
	});

	it('iCloud zástupce se ohlásí a své číslo drží', async () => {
		await mkdir(invoices());
		await writeFile(invoices('.20260007.pdf.icloud'), new Uint8Array());

		expect(await listInvoices({ vaultPath: base })).toEqual({
			items: [],
			broken: [
				{
					fileName: '.20260007.pdf.icloud',
					path: invoices('.20260007.pdf.icloud'),
					reason: 'Doklad je na tomto Macu dostupný jen jako iCloud zástupce. Nech ho ve Finderu stáhnout a potom přehled obnov.',
				},
			],
		});
		expect(await listUsedNumbers({ vaultPath: base })).toEqual(['20260007']);
	});

	it('konfliktní kopie udělá vadnými oba soubory a součet nezdvojí', async () => {
		const canonical = await saveNew(numbered('20260001', 'Alfa', 10_000));
		await copyFile(canonical, invoices('20260001 2.pdf'));

		const listed = await listInvoices({ vaultPath: base });

		expect(listed).toEqual({
			items: [],
			broken: [
				{
					fileName: '20260001 2.pdf',
					path: invoices('20260001 2.pdf'),
					reason: 'Číslo dokladu 20260001 je v několika souborech. Rozhodni konflikt ve Finderu.',
				},
				{
					fileName: '20260001.pdf',
					path: canonical,
					reason: 'Číslo dokladu 20260001 je v několika souborech. Rozhodni konflikt ve Finderu.',
				},
			],
		});
		expect(await listUsedNumbers({ vaultPath: base })).toEqual(['20260001', '20260001 2']);
	});

	it('čísla lišící se jen velikostí písmen jsou jeden doklad', async () => {
		const upper = await saveNew(numbered('F2026-1', 'Alfa', 10_000));
		await mkdir(join(base, 'jinde'));
		const lower = await saveInvoice({
			vaultPath: join(base, 'jinde'),
			invoice: numbered('f2026-1', 'Beta', 10_000),
			isNew: true,
		});
		await rename(lower, invoices('f2026-1 2.pdf'));

		const { items, broken } = await listInvoices({ vaultPath: base });

		expect([items, broken]).toEqual([
			[],
			[
				{
					fileName: 'F2026-1.pdf',
					path: upper,
					reason: 'Číslo dokladu F2026-1 je v několika souborech. Rozhodni konflikt ve Finderu.',
				},
				{
					fileName: 'f2026-1 2.pdf',
					path: invoices('f2026-1 2.pdf'),
					reason: 'Číslo dokladu f2026-1 je v několika souborech. Rozhodni konflikt ve Finderu.',
				},
			],
		]);
	});

	it('osamělá konfliktní kopie čeká na rozhodnutí a číslo drží', async () => {
		const canonical = await saveNew(numbered('20260001', 'Alfa', 10_000));
		const conflict = invoices('20260001 (conflicted copy).pdf');
		await rename(canonical, conflict);

		expect(await listInvoices({ vaultPath: base })).toEqual({
			items: [],
			broken: [
				{
					fileName: '20260001 (conflicted copy).pdf',
					path: conflict,
					reason: 'Soubor vypadá jako konfliktní kopie dokladu 20260001. Ve Finderu rozhodni, která verze platí, a přejmenuj ji na 20260001.pdf.',
				},
			],
		});
		expect(await listUsedNumbers({ vaultPath: base })).toEqual(['20260001', '20260001 (conflicted copy)']);
	});

	it('nečitelná konfliktní kopie i její iCloud zástupce drží obě možná čísla', async () => {
		await mkdir(invoices());
		await writeFile(invoices('F2026 2.pdf'), 'broken file');
		await writeFile(invoices('.F2027 2.pdf.icloud'), new Uint8Array());

		expect(await listUsedNumbers({ vaultPath: base })).toEqual(['F2026', 'F2026 2', 'F2027', 'F2027 2']);
	});

	it('iCloud zástupce konfliktní kopie se nečte, ani když v něm leží PDF', async () => {
		await mkdir(invoices());
		await writeFile(invoices('.F2027 2.pdf.icloud'), invoicePdf(numbered('F2099', 'Alfa', 10_000)));

		expect(await listUsedNumbers({ vaultPath: base })).toEqual(['F2027', 'F2027 2']);
	});

	it('vadné doklady jdou podle jména souboru', async () => {
		const canonical = await saveNew(numbered('20260001', 'Alfa', 10_000));
		await copyFile(canonical, invoices('20260001 2.pdf'));
		await writeFile(invoices('aaa.pdf'), 'rozbité');
		await writeFile(invoices('zz.pdf'), 'rozbité');

		const { broken } = await listInvoices({ vaultPath: base });

		expect(broken.map(({ fileName }) => fileName)).toEqual(['20260001 2.pdf', '20260001.pdf', 'aaa.pdf', 'zz.pdf']);
	});

	it('složka ani nefunkční odkaz jménem dokladu nejsou doklad a číslo nedrží', async () => {
		await mkdir(invoices('20260001.pdf'), { recursive: true });
		await mkdir(invoices('.20260002.pdf.icloud'));
		await symlink(join(base, 'nikde.pdf'), invoices('20260003.pdf'));
		await writeFile(invoices('poznamky.txt'), 'x');

		expect(await listInvoices({ vaultPath: base })).toEqual({
			items: [],
			broken: [],
		});
		expect(await listUsedNumbers({ vaultPath: base })).toEqual([]);
	});

	it('číslo končící mezerou a číslicí není falešný konflikt', async () => {
		await saveNew(numbered('F2026 2', 'Alfa', 10_000));

		const listed = await listInvoices({ vaultPath: base });

		expect([listed.items.map(({ number }) => number), listed.broken]).toEqual([['F2026 2'], []]);
		expect(await listUsedNumbers({ vaultPath: base })).toEqual(['F2026 2']);
		await expect(
			saveInvoice({
				vaultPath: base,
				invoice: numbered('F2026 2', 'Beta', 10_000),
				isNew: false,
			}),
		).resolves.toBe(invoices('F2026 2.pdf'));
	});

	it('přípona .PDF i .Pdf je doklad', async () => {
		await mkdir(invoices());
		for (const name of ['20260001.pdf', '20260002.PDF', '20260003.Pdf', 'poznamky.txt', '20260004.pdf.bak']) {
			await writeFile(invoices(name), 'x');
		}

		expect(await listUsedNumbers({ vaultPath: base })).toEqual(['20260001', '20260002', '20260003']);
	});
});

describe('cache výpisu', () => {
	it('je na jedno použití: po smazání dá výpis totéž', async () => {
		await saveNew(numbered('20260001', 'Alfa', 10_000));
		await saveNew(numbered('20260002', 'Beta', 25_000));

		const before = await listInvoices({ vaultPath: base });
		expect(await cachedNames()).toEqual(['20260001.pdf', '20260002.pdf']);
		await rm(cacheDir(base), { recursive: true });

		expect(await listInvoices({ vaultPath: base })).toEqual(before);
	});

	it('uložení dokladu jeho souhrn z cache vyhodí', async () => {
		await saveNew(numbered('20260001', 'Alfa', 10_000));
		await saveNew(numbered('20260002', 'Beta', 25_000));
		await listInvoices({ vaultPath: base });

		await saveInvoice({
			vaultPath: base,
			invoice: numbered('20260001', 'Změněná Alfa', 10_000),
			isNew: false,
		});

		expect(await cachedNames()).toEqual(['20260002.pdf']);
		const { items } = await listInvoices({ vaultPath: base });
		expect(items.map(({ customer }) => customer)).toEqual(['Beta', 'Změněná Alfa']);
	});

	it('změněné vadné PDF z cache zmizí a ohlásí se', async () => {
		const path = await saveNew(numbered('20260001', 'Alfa', 10_000));
		await listInvoices({ vaultPath: base });
		expect(await cachedNames()).toEqual(['20260001.pdf']);

		await writeFile(path, '%PDF-1.7 poskozeny obsah');
		const listed = await listInvoices({ vaultPath: base });

		expect([listed.items, listed.broken.map(({ path: broken }) => broken)]).toEqual([[], [path]]);
		expect(await cachedNames()).toEqual([]);
	});

	it('neshoda velikosti nebo času změny vynutí nové čtení místo důvěry v cache', async () => {
		const path = await saveNew(numbered('20260001', 'Alfa', 10_000));
		await listInvoices({ vaultPath: base });
		const poisoned = await cache();
		poisoned.entries['20260001.pdf'].summary.customer = 'Otrávená mezipaměť';
		await writeFile(cacheFile(), JSON.stringify(poisoned));

		await utimes(path, 1_000_000, 1_000_000);
		const byTime = await listInvoices({ vaultPath: base });
		const stale = await cache();
		stale.entries['20260001.pdf'].summary.customer = 'Otrávená mezipaměť';
		stale.entries['20260001.pdf'].size = 1;
		await writeFile(cacheFile(), JSON.stringify(stale));
		const bySize = await listInvoices({ vaultPath: base });

		expect([byTime.items[0]?.customer, bySize.items[0]?.customer]).toEqual(['Alfa', 'Alfa']);
	});

	it('obsazená čísla věří cache jen u souboru, který se nezměnil', async () => {
		const path = await saveNew(numbered('20260001', 'Alfa', 10_000));
		await listInvoices({ vaultPath: base });
		const poisoned = await cache();
		poisoned.entries['20260001.pdf'].summary.number = '20269999';
		await writeFile(cacheFile(), JSON.stringify(poisoned));

		const trusted = await listUsedNumbers({ vaultPath: base });
		const resized = structuredClone(poisoned);
		resized.entries['20260001.pdf'].size = 1;
		await writeFile(cacheFile(), JSON.stringify(resized));
		const bySize = await listUsedNumbers({ vaultPath: base });
		await writeFile(cacheFile(), JSON.stringify(poisoned));
		await utimes(path, 1_000_000, 1_000_000);
		const byTime = await listUsedNumbers({ vaultPath: base });

		expect([trusted, bySize, byTime]).toEqual([['20260001', '20269999'], ['20260001'], ['20260001']]);
	});

	it('kontrola čísla si přečtený souhrn zapíše stejně jako výpis a starší záznamy nechá', async () => {
		await saveNew(numbered('20260001', 'Alfa', 10_000));
		await saveNew(numbered('20260002', 'Beta', 25_000));
		expect(await cachedNames()).toEqual(['20260001.pdf']);
		await saveNew(numbered('20260003', 'Gama', 5_000));
		const written = await cache();
		expect(await cachedNames()).toEqual(['20260001.pdf', '20260002.pdf']);

		await rm(cacheFile());
		await listInvoices({ vaultPath: base });
		const listed = await cache();

		expect([written.entries['20260001.pdf'], written.entries['20260002.pdf']]).toEqual([
			listed.entries['20260001.pdf'],
			listed.entries['20260002.pdf'],
		]);
	});

	it('obsazená čísla nad nezměněnou složkou cache nepřepisují', async () => {
		await saveNew(numbered('20260001', 'Alfa', 10_000));
		await listInvoices({ vaultPath: base });
		const before = await stat(cacheFile());

		await listUsedNumbers({ vaultPath: base });
		const after = await stat(cacheFile());

		expect(after.ino).toBe(before.ino);
	});

	it('nezměněný vault cache nepřepisuje', async () => {
		await saveNew(numbered('20260001', 'Alfa', 10_000));
		await listInvoices({ vaultPath: base });
		const before = await stat(cacheFile());

		await listInvoices({ vaultPath: base });
		const after = await stat(cacheFile());

		expect(after.ino).toBe(before.ino);
	});

	it('smazaný doklad z cache vypadne jako sirotek', async () => {
		await saveNew(numbered('20260001', 'Alfa', 10_000));
		await saveNew(numbered('20260002', 'Beta', 25_000));
		await listInvoices({ vaultPath: base });

		await rm(invoices('20260001.pdf'));

		expect(await listedNumbers()).toEqual(['20260002']);
		expect(await cachedNames()).toEqual(['20260002.pdf']);
	});

	it('po přesunu vaultu vezme souhrn z cache, jen s novou cestou', async () => {
		const from = join(base, 'puvodni');
		await mkdir(from);
		await saveInvoice({
			vaultPath: from,
			invoice: numbered('20260001', 'Alfa', 10_000),
			isNew: true,
		});
		await listInvoices({ vaultPath: from });
		const cached = JSON.parse(await readFile(join(cacheDir(from), 'index.json')));
		cached.entries['20260001.pdf'].summary.customer = 'Z cache';
		await writeFile(join(cacheDir(from), 'index.json'), JSON.stringify(cached));

		const to = join(base, 'presunuty');
		await rename(from, to);
		const { items } = await listInvoices({ vaultPath: to });

		expect(items.map(({ customer, path }) => [customer, path])).toEqual([
			['Z cache', join(to, 'faktury', '20260001.pdf')],
		]);
	});

	it('podvržený souhrn, který by frontend odmítl, se v cache nepoužije', async () => {
		const document = numbered('20260001', 'Alfa', 10_000);
		const [line] = document.lines;
		await saveNew({
			...document,
			lines: [
				{
					...line!,
					itemId: 'p1',
					usageYear: 2025,
				},
			],
		});
		await listInvoices({ vaultPath: base });
		const valid = await listInvoices({ vaultPath: base });

		for (const patch of [
			{
				issueDate: 'včera',
			},
			{
				dueDate: '12. 6. 2026',
			},
			{
				usageLines: [
					{
						itemId: 'p1',
						quantity: 2,
						usageYear: 5,
					},
				],
			},
		]) {
			const tampered = await cache();
			const entry = tampered.entries['20260001.pdf'];
			entry.summary = {
				...entry.summary,
				...patch,
			};
			await writeFile(cacheFile(), JSON.stringify(tampered));

			expect(await listInvoices({ vaultPath: base })).toEqual(valid);
		}
		expect(valid.items.map(({ usageLines }) => usageLines)).toEqual([
			[
				{
					itemId: 'p1',
					quantity: 2,
					usageYear: 2025,
				},
			],
		]);
		for (const dueDate of ['', '  ']) {
			const blankDue = await cache();
			blankDue.entries['20260001.pdf'].summary.dueDate = dueDate;
			await writeFile(cacheFile(), JSON.stringify(blankDue));
			const { items } = await listInvoices({ vaultPath: base });
			expect(items.map((item) => item.dueDate)).toEqual([dueDate]);
		}
	});

	it('nečitelnou nebo cizí cache přehled postaví znovu', async () => {
		await saveNew(numbered('20260001', 'Alfa', 10_000));
		await mkdir(cacheDir(base), { recursive: true });

		for (const content of ['{rozbito', '{"entries":{"20260001.pdf":{"size":"velká"}}}']) {
			await writeFile(cacheFile(), content);

			expect(await listedNumbers()).toEqual(['20260001']);
			expect(await cachedNames()).toEqual(['20260001.pdf']);
		}
	});

	it('soubor na místě cache výpis ani uložení nezablokuje', async () => {
		await mkdir(dataDir(base), { recursive: true });
		await writeFile(cacheDir(base), 'není složka');

		await saveNew(numbered('20260001', 'Alfa', 10_000));

		expect(await listedNumbers()).toEqual(['20260001']);
		expect(await readFile(cacheDir(base), 'utf8')).toBe('není složka');
		expect(await names(dataDir(base))).toEqual(['cache']);
	});
});
