import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentKind } from '~/constants/invoice';

import { invoice, supplier } from './invoices.ts';
import { fixture } from './isdoc.ts';
import { pdfWithIsdoc } from './pdfs.ts';
import { names } from './support.ts';

import {
	adoptDocuments,
	deriveDueDays,
	deriveOurIco,
	deriveSupplier,
	deriveTemplate,
	findFiles,
	scanVault,
} from '../adopt.ts';
import { listInvoices } from '../invoice/index.ts';
import { buildIsdoc, parseIsdoc } from '../invoice/isdoc.ts';
import { saveInvoice } from '../invoice/mod.ts';
import { ensureVault } from '../vault.ts';

import type { Invoice } from '../invoice/model.ts';
import type { AdoptScan } from '~/bindings';

// Výpis složky v obráceném pořadí: APFS vrací jména seřazená, jiný disk nemusí.
const listing = vi.hoisted((): { reversed: boolean } => ({ reversed: false }));

vi.mock(import('node:fs/promises'), async (importOriginal) => {
	const fs = await importOriginal();
	return {
		...fs,
		readdir: async (...args: Parameters<typeof fs.readdir>) => {
			const entries = await fs.readdir(...args);
			return listing.reversed ? entries.toReversed() : entries;
		},
	};
});

let base = '';

beforeEach(async () => {
	listing.reversed = false;
	base = await mkdtemp(join(tmpdir(), 'fakturian-adopt-'));
});

afterEach(async () => {
	await rm(base, { recursive: true });
});

function numbered(number: string): Invoice {
	return {
		...invoice(),
		number,
	};
}

// Volné PDF s vloženým ISDOC, jaké leží ve složce, kterou si uživatel otevřel jako datovou.
async function pdfInto(dir: string, name: string, source: Invoice): Promise<string> {
	await mkdir(dir, { recursive: true });
	const path = join(dir, `${name}.pdf`);
	await writeFile(path, await pdfWithIsdoc(buildIsdoc(source)));
	return path;
}

function scan(ourIco: string | null = null): Promise<AdoptScan> {
	return scanVault({
		vaultPath: base,
		ourIco,
	});
}

function save(vaultPath: string, source: Invoice): Promise<string> {
	return saveInvoice({
		vaultPath,
		invoice: source,
		isNew: true,
	});
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
	} catch {
		return false;
	}
	return true;
}

describe('sken složky', () => {
	it('volné PDF nabídne, převezme a podruhé už nenabídne', async () => {
		const source = await pdfInto(base, 'Vydaná faktura - 20260001', invoice());

		const offer = await scan();

		expect(offer.candidates).toEqual([
			{
				path: source,
				file: 'Vydaná faktura - 20260001.pdf',
				number: '20260001',
				customer: 'Odběratel s.r.o.',
				issueDate: '2026-05-29',
				totalCents: 5_175_000,
			},
		]);
		expect(await exists(source)).toBe(true);

		const report = await adoptDocuments({
			vaultPath: base,
			paths: offer.candidates.map(({ path }) => path),
			ourIco: '12345679',
		});

		expect(report.imported.map(({ number }) => number)).toEqual(['20260001']);
		expect(await names(join(base, 'faktury'))).toEqual(['20260001.pdf']);
		expect(await exists(source)).toBe(false);
		const { items } = await listInvoices({ vaultPath: base });
		expect(items.map(({ number }) => number)).toEqual(['20260001']);

		const again = await scan();
		expect([again.candidates, again.skipped]).toEqual([[], []]);
	});

	it('doklad s datem, které by frontend odmítl, přeskočí s důvodem', async () => {
		await pdfInto(base, 'platna', invoice());
		await pdfInto(base, 'vadna', {
			...numbered('20260002'),
			dueDate: '0999-12-31',
		});

		const offer = await scan();

		expect(offer.candidates.map(({ number }) => number)).toEqual(['20260001']);
		expect(offer.skipped).toEqual([
			{
				file: 'vadna.pdf',
				reason: 'doklad má neplatné datum splatnosti „0999-12-31“ (čekám RRRR-MM-DD)',
			},
		]);
	});

	it('volnou kopii dokladu, který ve vaultu už je, ohlásí jako přeskočenou', async () => {
		await save(base, invoice());
		await pdfInto(base, 'kopie-mimo-faktury', invoice());

		const offer = await scan();

		expect([offer.candidates, offer.skipped]).toEqual([
			[],
			[
				{
					file: 'kopie-mimo-faktury.pdf',
					reason: 'faktura 20260001 už ve vaultu existuje',
				},
			],
		]);
	});

	it('nečitelnou podsložku ohlásí jako přeskočenou a sken doběhne', async () => {
		await pdfInto(base, 'faktura', invoice());
		const locked = join(base, '2025', 'zamcena');
		await pdfInto(locked, 'schovana', numbered('20250001'));
		await chmod(locked, 0o000);

		let offer: AdoptScan;
		try {
			offer = await scan();
		} finally {
			await chmod(locked, 0o700);
		}

		expect(offer.candidates.map(({ number }) => number)).toEqual(['20260001']);
		expect(offer.skipped).toEqual([
			{
				file: join('2025', 'zamcena'),
				reason: `nejde přečíst: EACCES: permission denied, scandir '${locked}'`,
			},
		]);
	});

	it('převzetí vrátí odběratele', async () => {
		const source = await pdfInto(base, 'faktura', invoice());

		const report = await adoptDocuments({
			vaultPath: base,
			paths: [source],
			ourIco: null,
		});

		expect(report.customers.map(({ ico }) => ico)).toEqual(['87654326']);
	});

	it('dodavatele odvodí z dokladu', async () => {
		await pdfInto(base, 'faktura', invoice());

		const { supplier: derived } = await scan();

		const { name, ico, address, email, registration } = supplier();
		expect(derived).toEqual({
			name,
			ico,
			address,
			email,
			registration,
			bankAccount: '2000145399',
			bankCode: '0800',
			iban: 'CZ6508000000192000145399',
			invoiceNumberFormat: '{RRRR}{NNNN}',
			defaultDueDays: 14,
		});
	});

	it('šablonu s víc než devíti místy pořadí nenabídne', async () => {
		await pdfInto(base, 'faktura', numbered('20260000000001'));

		const { supplier: derived } = await scan();

		expect(derived?.invoiceNumberFormat).toBe('');
	});

	it('dodavatele vezme z nejnovějšího dokladu', async () => {
		await pdfInto(base, 'stara', {
			...numbered('20250001'),
			issueDate: '2025-03-01',
			bankAccount: '1111111111',
		});
		await pdfInto(base, 'nova', invoice());

		const { supplier: derived } = await scan();

		expect(derived?.bankAccount).toBe('2000145399');
	});

	it('cizí doklad nepřevezme a nechá ho na místě', async () => {
		const source = await pdfInto(base, 'hosting', {
			...numbered('F2026-500'),
			supplier: {
				...supplier(),
				name: 'Dodavatel hostingu s.r.o.',
				ico: '99887766',
			},
		});
		await pdfInto(base, 'moje', invoice());

		const offer = await scan('12345679');

		expect(offer.candidates.map(({ number }) => number)).toEqual(['20260001']);
		expect(offer.skipped).toEqual([
			{
				file: 'hosting.pdf',
				reason: 'doklad vystavil Dodavatel hostingu s.r.o. (IČO 99887766), ne ty — přijaté doklady patří do Výdajů',
			},
		]);
		expect(await exists(source)).toBe(true);
		expect(await exists(join(base, 'faktury', 'F2026-500.pdf'))).toBe(false);
	});

	it('bez nastavení rozhodne většinové IČO', async () => {
		await pdfInto(base, 'moje-1', invoice());
		await pdfInto(base, 'moje-2', numbered('20260002'));
		await pdfInto(base, 'cizi', {
			...numbered('20260099'),
			supplier: {
				...supplier(),
				ico: '99887766',
			},
		});

		const offer = await scan();

		expect(offer.candidates.map(({ number }) => number)).toEqual(['20260002', '20260001']);
		expect(offer.skipped.map(({ file }) => file)).toEqual(['cizi.pdf']);
		expect(offer.supplier?.ico).toBe('12345679');
	});

	it('doklady plátce DPH o našem IČO nehlasují', async () => {
		await pdfInto(base, 'moje', invoice());
		const sample = await pdfWithIsdoc(await fixture('example1.isdoc'));
		for (const name of ['prijata-1', 'prijata-2']) await writeFile(join(base, `${name}.pdf`), sample);

		const offer = await scan();

		expect(offer.candidates.map(({ number }) => number)).toEqual(['20260001']);
		expect(offer.skipped.map(({ file }) => file)).toEqual(['prijata-1.pdf', 'prijata-2.pdf']);
		expect(offer.supplier?.ico).toBe('12345679');
	});

	it('doklad v podsložce najde a jmenuje ho cestou od kořene', async () => {
		await pdfInto(join(base, '2026', 'Q1'), 'faktura', invoice());

		const offer = await scan();

		expect(offer.candidates.map(({ file }) => file)).toEqual(['2026/Q1/faktura.pdf']);
	});

	it('vlastní složky vaultu neprochází', async () => {
		await pdfInto(join(base, 'prijate'), 'prijaty', invoice());
		await save(base, invoice());

		const offer = await scan();

		expect([offer.candidates, offer.skipped]).toEqual([[], []]);
	});

	it('skryté složky a soubory neprochází', async () => {
		await pdfInto(join(base, '.sync-cache'), 'faktura', invoice());
		await writeFile(join(base, '.poznamka.txt'), 'soukromá metadata');

		const offer = await scan();

		expect([offer.candidates, offer.skipped]).toEqual([[], []]);
	});

	it('doklady pod limitem hloubky přejde', async () => {
		const shallow = join(base, '1', '2', '3', '4', '5', '6');
		await pdfInto(shallow, 'na-limitu', invoice());
		await pdfInto(join(shallow, '7'), 'za-limitem', numbered('20260002'));

		const offer = await scan();

		expect(offer.candidates.map(({ number }) => number)).toEqual(['20260001']);
		expect(offer.truncated).toBe(false);
	});

	it('sken přes limit souborů je označený jako neúplný', async () => {
		for (let index = 0; index < 1001; index += 1) {
			await writeFile(join(base, `soubor-${String(index).padStart(4, '0')}.pdf`), 'není doklad');
		}

		const offer = await scan();

		expect(offer.truncated).toBe(true);
		expect(offer.skipped.length).toBe(1000);
		expect(offer.skipped[0]).toEqual({
			file: 'soubor-0000.pdf',
			reason: 'soubor není PDF s vloženým ISDOC',
		});
	});

	it('otevře jen soubory s příponou PDF', async () => {
		const pdf = await pdfInto(base, 'faktura', invoice());
		await rename(pdf, join(base, 'FAKTURA.PDF'));
		for (const name of ['smlouva.docx', 'dovolena.mp4', 'bez-pripony', 'export.isdoc', 'export.xml']) {
			await writeFile(join(base, name), 'není doklad');
		}

		const offer = await scan();

		expect(offer.candidates.map(({ file }) => file)).toEqual(['FAKTURA.PDF']);
		expect(offer.skipped).toEqual([]);
	});

	it('soubor bez ISDOC ohlásí i s důvodem', async () => {
		await writeFile(join(base, 'smlouva.pdf'), '%PDF-1.4 tohle není faktura');

		const offer = await scan();

		expect(offer.candidates).toEqual([]);
		expect(offer.skipped).toEqual([
			{
				file: 'smlouva.pdf',
				reason: 'PDF neobsahuje přílohu ISDOC',
			},
		]);
	});

	it('dobropis nabídne jen spolu s jeho fakturou', async () => {
		const credit = {
			...numbered('20260002'),
			documentType: DocumentKind.CreditNote,
			originalInvoice: '20260001',
			lines: invoice().lines.map((line) => ({
				...line,
				unitPriceCents: -line.unitPriceCents,
			})),
		};
		const folder = join(base, 'doklady');
		await pdfInto(folder, 'a-dobropis', credit);
		await pdfInto(folder, 'b-faktura', invoice());
		await pdfInto(folder, 'c-sirotek', {
			...credit,
			number: '20260003',
			originalInvoice: '20269999',
		});

		const offer = await scan();

		expect(offer.candidates.map(({ number }) => number)).toEqual(['20260002', '20260001']);
		expect(offer.skipped).toEqual([
			{
				file: 'doklady/c-sirotek.pdf',
				reason: 'dobropis opravuje fakturu 20269999, která není ve vaultu ani v tomtéž importu',
			},
		]);
	});

	it('chybějící vault se neskenuje', async () => {
		const vault = join(base, 'neni');

		await expect(
			scanVault({
				vaultPath: vault,
				ourIco: null,
			}),
		).rejects.toEqual(new Error(`Datová složka ${vault} neexistuje.`));
	});
});

describe('převzetí jen z datové složky', () => {
	it('soubor mimo vault nepřevezme ani nepřesune', async () => {
		const vault = join(base, 'vault');
		await ensureVault({ vaultPath: vault });
		const source = await pdfInto(join(base, 'venku'), 'faktura', invoice());

		await expect(
			adoptDocuments({
				vaultPath: vault,
				paths: [source],
				ourIco: null,
			}),
		).rejects.toEqual(new Error(`${source} neleží v datové složce.`));
		expect(await exists(source)).toBe(true);
	});

	it('cestu ven přes `..` odmítne', async () => {
		const vault = join(base, 'vault');
		await ensureVault({ vaultPath: vault });
		const outside = await pdfInto(join(base, 'cizi', 'faktury'), 'F2025-800', numbered('F2025-800'));
		const bypass = `${vault}/../cizi/faktury/F2025-800.pdf`;

		await expect(
			adoptDocuments({
				vaultPath: vault,
				paths: [bypass],
				ourIco: null,
			}),
		).rejects.toEqual(new Error(`${bypass} neleží v datové složce.`));
		expect(await exists(outside)).toBe(true);
	});

	it('odkaz ve vaultu mířící ven odmítne', async () => {
		const vault = join(base, 'vault');
		await ensureVault({ vaultPath: vault });
		const outside = await pdfInto(join(base, 'cizi'), 'F2025-801', numbered('F2025-801'));
		const link = join(vault, 'zvenku.pdf');
		await symlink(outside, link);

		await expect(
			adoptDocuments({
				vaultPath: vault,
				paths: [link],
				ourIco: null,
			}),
		).rejects.toEqual(new Error(`${link} neleží v datové složce.`));
		expect(await exists(outside)).toBe(true);
		expect(await names(join(vault, 'faktury'))).toEqual([]);
	});

	it('odkaz uvnitř vaultu přesune ověřený soubor, ne odkaz, a hlásí se jménem odkazu', async () => {
		const target = await pdfInto(join(base, 'archiv'), 'Vydaná faktura - 20260001', invoice());
		const link = join(base, 'odkaz.pdf');
		await symlink(target, link);
		const broken = join(base, 'archiv', 'poskozena.pdf');
		await writeFile(broken, 'není PDF');
		const brokenLink = join(base, 'rozbity-odkaz.pdf');
		await symlink(broken, brokenLink);

		const report = await adoptDocuments({
			vaultPath: base,
			paths: [link, brokenLink],
			ourIco: null,
		});

		expect(report.imported.map(({ number }) => number)).toEqual(['20260001']);
		expect(report.skipped).toEqual([
			{
				file: 'rozbity-odkaz.pdf',
				reason: 'soubor není PDF s vloženým ISDOC',
			},
		]);
		const moved = await lstat(join(base, 'faktury', '20260001.pdf'));
		expect([moved.isFile(), moved.isSymbolicLink()]).toEqual([true, false]);
		expect(await exists(target)).toBe(false);
		const left = await lstat(link);
		expect(left.isSymbolicLink()).toBe(true);
	});

	it('číslo lišící se jen velikostí písmen nepřepíše ani zdroj nepřesune', async () => {
		const stored = await save(base, numbered('F2025-841'));
		const before = await readFile(stored);
		const source = await pdfInto(join(base, 'stare'), 'f2025-841', numbered('f2025-841'));

		const report = await adoptDocuments({
			vaultPath: base,
			paths: [source],
			ourIco: null,
		});

		expect(report.imported).toEqual([]);
		expect(report.skipped).toEqual([
			{
				file: 'f2025-841.pdf',
				reason: 'faktura f2025-841 už ve vaultu existuje',
			},
		]);
		expect(await readFile(stored)).toEqual(before);
		expect(await exists(source)).toBe(true);
	});
});

describe('hledání souborů', () => {
	it('chybějící kořen ohlásí i se jménem složky', async () => {
		const root = join(base, 'missing');

		await expect(findFiles(root, 1000)).rejects.toEqual(
			new Error(`Složku ${root} nejde přečíst: ENOENT: no such file or directory, scandir '${root}'`, {
				cause: expect.objectContaining({ code: 'ENOENT' }),
			}),
		);
	});

	it('vlastní složky vaultu přeskočí jen v kořeni', async () => {
		const own = join(base, 'faktury', 'own.pdf');
		const nested = join(base, '2026', 'faktury', 'invoice.pdf');
		await mkdir(join(base, 'faktury'));
		await mkdir(join(base, '2026', 'faktury'), { recursive: true });
		await writeFile(own, 'own');
		await writeFile(nested, 'nested');

		expect(await findFiles(base, 1000)).toEqual({
			files: [nested],
			skipped: [],
			truncated: false,
		});
	});

	it('odkazy neprochází ani nenabízí', async () => {
		const outside = await mkdtemp(join(tmpdir(), 'fakturian-adopt-outside-'));
		try {
			const document = join(base, 'faktura.pdf');
			await writeFile(document, 'pdf');
			await writeFile(join(outside, 'cizi.pdf'), 'pdf');
			await symlink(base, join(base, 'cyklus'));
			await symlink(join(outside, 'cizi.pdf'), join(base, 'odkaz.pdf'));

			expect(await findFiles(base, 1000)).toEqual({
				files: [document],
				skipped: [],
				truncated: false,
			});
		} finally {
			await rm(outside, { recursive: true });
		}
	});

	it('na limitu vybere pokaždé tytéž soubory', async () => {
		for (const name of ['z.pdf', 'a.pdf', 'm.pdf']) await writeFile(join(base, name), name);

		expect(await findFiles(base, 2)).toEqual({
			files: [join(base, 'a.pdf'), join(base, 'm.pdf')],
			skipped: [],
			truncated: true,
		});
		listing.reversed = true;
		const reversed = await findFiles(base, 2);
		expect(reversed.files).toEqual([join(base, 'a.pdf'), join(base, 'm.pdf')]);
	});

	it('nečitelnou podsložku přeskočí s důvodem', async () => {
		const closed = join(base, 'zamcena');
		await mkdir(closed);
		await writeFile(join(closed, 'faktura.pdf'), 'pdf');
		await writeFile(join(base, 'volna.pdf'), 'pdf');
		await chmod(closed, 0o000);

		try {
			expect(await findFiles(base, 1000)).toEqual({
				files: [join(base, 'volna.pdf')],
				skipped: [
					{
						file: 'zamcena',
						reason: `nejde přečíst: EACCES: permission denied, scandir '${closed}'`,
					},
				],
				truncated: false,
			});
		} finally {
			await chmod(closed, 0o700);
		}
	});

	it('limit dosažený v podsložce zastaví celý sken', async () => {
		await mkdir(join(base, 'a'));
		await writeFile(join(base, 'a', '1.pdf'), 'pdf');
		await writeFile(join(base, 'a', '2.pdf'), 'pdf');
		const closed = join(base, 'z');
		await mkdir(closed);
		await chmod(closed, 0o000);

		try {
			expect(await findFiles(base, 1)).toEqual({
				files: [join(base, 'a', '1.pdf')],
				skipped: [],
				truncated: true,
			});
		} finally {
			await chmod(closed, 0o700);
		}
	});

	it('řadí po složkách, ne po znacích', async () => {
		await mkdir(join(base, 'a'));
		await writeFile(join(base, 'a', 'b.pdf'), 'pdf');
		await writeFile(join(base, 'a b.pdf'), 'pdf');

		expect(await findFiles(base, 1000)).toEqual({
			files: [join(base, 'a', 'b.pdf'), join(base, 'a b.pdf')],
			skipped: [],
			truncated: false,
		});
	});
});

describe('odvození z dokladů', () => {
	it('šablonu odvodí z čísla a roku vystavení', () => {
		expect(deriveTemplate('2026017', '2026-07-31')).toBe('{RRRR}{NNN}');
		expect(deriveTemplate('20260001', '2026-01-05')).toBe('{RRRR}{NNNN}');
		expect(deriveTemplate('2026123456789', '2026-01-05')).toBe('{RRRR}{NNNNNNNNN}');
	});

	it('cizí tvar čísla šablonu nedá', () => {
		expect(deriveTemplate('F2026-007', '2026-03-01')).toBe(undefined);
		expect(deriveTemplate('2026', '2026-03-01')).toBe(undefined);
		expect(deriveTemplate('2026A', '2026-03-01')).toBe(undefined);
		expect(deriveTemplate('2025017', '2026-03-01')).toBe(undefined);
		expect(deriveTemplate('20260123456789', '2026-03-01')).toBe(undefined);
		expect(deriveTemplate('20261', '202')).toBe(undefined);
	});

	it('zadané IČO vyhraje nad prázdným skenem a splatnost zůstane uvěřitelná', async () => {
		expect(deriveOurIco([], '12345679')).toBe('12345679');
		expect(deriveOurIco([], '')).toBe('');
		const fromIco = (ico: string) => ({
			...invoice(),
			supplier: {
				...supplier(),
				ico,
			},
		});
		expect(deriveOurIco([fromIco(''), fromIco(''), fromIco('12345679')], '')).toBe('12345679');
		const withoutIco = await parseIsdoc(await fixture('foreign-document.isdoc'));
		expect(
			deriveOurIco(
				[
					{
						...withoutIco,
						supplier: {
							...withoutIco.supplier,
							ico: '',
						},
					},
				],
				'',
			),
		).toBe('');

		expect(deriveDueDays('2026-05-01', '2026-05-31')).toBe(30);
		expect(deriveDueDays('2026-05-01', '2026-05-01')).toBe(0);
		expect(deriveDueDays('2026-05-01', '2027-05-01')).toBe(365);
		expect(deriveDueDays('2026-05-31', '2026-05-01')).toBe(null);
		expect(deriveDueDays('2026-05-01', '2027-05-02')).toBe(null);
		expect(deriveDueDays('ne-datum', '2026-05-01')).toBe(null);
		expect(deriveDueDays('2026-05-01', 'ne-datum')).toBe(null);
		expect(deriveSupplier([])).toBe(null);
	});

	it('většinové IČO a dodavatel z nejnovějšího dokladu vyjdou pokaždé stejně', async () => {
		const read = await parseIsdoc(await fixture('foreign-document.isdoc'));
		const older = {
			...read,
			number: '20260001',
			issueDate: '2026-04-01',
			dueDate: '2026-04-15',
			supplier: {
				...read.supplier,
				ico: '00000002',
				name: 'Původní dodavatel',
			},
		};
		const newer = {
			...older,
			number: '20260002',
			issueDate: '2026-05-01',
			dueDate: '2026-05-31',
			supplier: {
				...older.supplier,
				ico: '00000001',
				name: 'Aktuální dodavatel',
			},
			bankAccount: '123456',
		};

		expect(deriveOurIco([older, newer], '')).toBe('1');
		expect(
			deriveOurIco(
				[
					older,
					newer,
					{
						...older,
						number: '20260003',
					},
				],
				'',
			),
		).toBe('2');

		expect(deriveSupplier([newer, older])).toEqual({
			name: 'Aktuální dodavatel',
			ico: '00000001',
			address: read.supplier.address,
			email: read.supplier.email,
			registration: read.supplier.registration,
			bankAccount: '123456',
			bankCode: read.bankCode,
			iban: read.iban,
			invoiceNumberFormat: '{RRRR}{NNNN}',
			defaultDueDays: 30,
		});
	});

	it('ve stejný den vezme dodavatele z vyššího čísla čteného jako číslo', async () => {
		const read = await parseIsdoc(await fixture('foreign-document.isdoc'));
		const ninth = {
			...read,
			number: 'F2026-9',
			issueDate: '2026-05-01',
			supplier: {
				...read.supplier,
				name: 'Dodavatel z devítky',
			},
		};
		const tenth = {
			...ninth,
			number: 'F2026-10',
			supplier: {
				...ninth.supplier,
				name: 'Dodavatel z desítky',
			},
		};

		expect(deriveSupplier([tenth, ninth])?.name).toBe('Dodavatel z desítky');
	});
});
