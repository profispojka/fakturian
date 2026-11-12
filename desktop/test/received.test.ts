import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { customer, invoice, MINIMAL_ISDOC, supplier } from './invoices.ts';
import { invoicePdf, pdfWithIsdoc, samplePdf } from './pdfs.ts';
import { names, rejection } from './support.ts';

import { invoiceUuid } from '../invoice/isdoc.ts';
import { savePdf } from '../pdf.ts';
import { importReceived, listBrokenReceived, receivedPath, removeReceived } from '../received.ts';
import { ensureVault } from '../vault.ts';

import type { ReceivedDocument } from '~/bindings';

const SUFFIX = ' — Fakturian přijímá jen doklady s ISDOC, ze kterých přečte údaje i částku.';

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
	base = await mkdtemp(join(tmpdir(), 'fakturian-received-'));
});

afterEach(async () => {
	await rm(base, { recursive: true });
});

function received(...parts: string[]): string {
	return join(base, 'prijate', ...parts);
}

async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);
	} catch {
		return false;
	}
	return true;
}

function importFrom(sourcePath: string): Promise<ReceivedDocument> {
	return importReceived({
		vaultPath: base,
		sourcePath,
	});
}

// Přijatelný doklad; různá čísla dají různý obsah souboru.
function receivedPdf(number: string): Promise<Uint8Array> {
	return pdfWithIsdoc(MINIMAL_ISDOC.replace('<ID>20260001</ID>', `<ID>${number}</ID>`));
}

async function source(name: string, content: Uint8Array | Promise<Uint8Array>): Promise<string> {
	const path = join(base, name);
	await writeFile(path, await content);
	return path;
}

// Doklad, který vystavil subdodavatel: dodavatel a odběratel jsou prohozené.
function subcontractors(): Promise<Uint8Array> {
	return invoicePdf({
		...invoice(),
		number: 'F2026007',
		supplier: customer(),
		customer: supplier(),
	});
}

describe('import přijatého dokladu', () => {
	it('doklad s ISDOC se vyplní sám', async () => {
		const path = await source('F2026007.pdf', subcontractors());

		const document = await importFrom(path);

		expect(document).toEqual({
			file: 'F2026007.pdf',
			supplier: 'Odběratel s.r.o.',
			supplierIco: '87654326',
			number: 'F2026007',
			uuid: invoiceUuid({
				...invoice(),
				number: 'F2026007',
				supplier: customer(),
			}),
			description: 'Faktura F2026007',
			amountCents: 5_175_000,
			date: '2026-05-29',
			recipientIco: '12345679',
		});
		expect(await readFile(received('F2026007.pdf'))).toEqual(await readFile(path));
	});

	it('konečná faktura po záloze se zapíše celou částkou', async () => {
		const xml = MINIMAL_ISDOC.replace(
			'<PaidDepositsAmount>0.00</PaidDepositsAmount>',
			'<PaidDepositsAmount>1000.00</PaidDepositsAmount>',
		).replace('<PayableAmount>1000.00</PayableAmount>', '<PayableAmount>0.00</PayableAmount>');
		const path = await source('konecna.pdf', pdfWithIsdoc(xml));

		const document = await importFrom(path);

		expect(document.amountCents).toBe(100_000);
	});

	it('přijatý dobropis se tak i popíše', async () => {
		const xml = MINIMAL_ISDOC.replace('<DocumentType>1</DocumentType>', '<DocumentType>2</DocumentType>');
		const path = await source('dobropis.pdf', pdfWithIsdoc(xml));

		const document = await importFrom(path);

		expect(document.description).toBe('Dobropis 20260001');
	});

	it('u plátce DPH vezme částku s daní', async () => {
		const xml = MINIMAL_ISDOC.replaceAll(
			'<VATApplicable>false</VATApplicable>',
			'<VATApplicable>true</VATApplicable>',
		).replace(
			'<TaxInclusiveAmount>1000.00</TaxInclusiveAmount>\n    <AlreadyClaimedTaxExclusiveAmount>',
			'<TaxInclusiveAmount>1210.00</TaxInclusiveAmount>\n    <AlreadyClaimedTaxExclusiveAmount>',
		);
		const path = await source('s-dani.pdf', pdfWithIsdoc(xml));

		const document = await importFrom(path);

		expect(document.amountCents).toBe(121_000);
	});

	it('velká přípona a smetí před hlavičkou projdou', async () => {
		const pdf = await receivedPdf('20260001');
		const content = new Uint8Array(1019 + pdf.byteLength).fill(0x20);
		content.set(pdf, 1019);
		const path = await source('SKEN.PDF', content);

		const document = await importFrom(path);

		expect(document.file).toBe('SKEN.PDF');
	});

	it('stejné jméno nepřepíše předchozí doklad', async () => {
		const path = await source('faktura.pdf', receivedPdf('20260001'));
		const original = await readFile(path);
		const first = await importFrom(path);
		await writeFile(path, await receivedPdf('20260002'));

		const second = await importFrom(path);

		expect([first.file, second.file]).toEqual(['faktura.pdf', 'faktura-2.pdf']);
		expect(await readFile(received('faktura.pdf'))).toEqual(original);
	});
});

describe('doklady, které do prijate/ nepatří', () => {
	it('ISDOC, který nejde promítnout, odmítne bez kopie', async () => {
		const xml = MINIMAL_ISDOC.replace(
			'<LocalCurrencyCode>CZK</LocalCurrencyCode>',
			'<LocalCurrencyCode>EUR</LocalCurrencyCode>',
		);
		const path = await source('eur.pdf', pdfWithIsdoc(xml));

		await expect(importFrom(path)).rejects.toEqual(
			new Error('eur.pdf: vložený ISDOC nejde přečíst (doklad je v měně EUR; appka vede jen koruny).', {
				cause: new Error('doklad je v měně EUR; appka vede jen koruny'),
			}),
		);
		expect(await exists(received())).toBe(false);
	});

	it('doklad bez čísla, dodavatele nebo platného data odmítne', async () => {
		const cases = [
			['<ID>20260001</ID>', '<ID></ID>', 'bez-cisla.pdf', 'bez-cisla.pdf: doklad neuvádí své číslo.'],
			[
				'<PartyName><Name>Jan Dodavatel</Name></PartyName>',
				'<PartyName><Name> </Name></PartyName>',
				'bez-dodavatele.pdf',
				'bez-dodavatele.pdf: doklad neuvádí dodavatele.',
			],
			[
				'<IssueDate>2026-05-28</IssueDate>',
				'<IssueDate>0999-12-31</IssueDate>',
				'stary-rok.pdf',
				'stary-rok.pdf: doklad nemá platné datum vystavení „0999-12-31“.',
			],
			[
				'<IssueDate>2026-05-28</IssueDate>',
				'<IssueDate> </IssueDate>',
				'bez-data.pdf',
				`bez-data.pdf: PDF má vadnou přílohu ISDOC — ISDOC nejde přečíst: řádek 6: prvek IssueDate neodpovídá standardu ISDOC${SUFFIX}`,
			],
			[
				'<IssueDate>2026-05-28</IssueDate>',
				'<IssueDate>2026-02-30</IssueDate>',
				'spatne-datum.pdf',
				`spatne-datum.pdf: PDF má vadnou přílohu ISDOC — ISDOC nejde přečíst: řádek 6: prvek IssueDate neodpovídá standardu ISDOC${SUFFIX}`,
			],
		] as const;
		for (const [from, to, name, reason] of cases) {
			const path = await source(name, pdfWithIsdoc(MINIMAL_ISDOC.replace(from, to)));

			await expect(importFrom(path)).rejects.toEqual(new Error(reason));
		}
		expect(await exists(received())).toBe(false);
	});

	it('nečitelnou částku s daní odmítne bez kopie', async () => {
		const amount = (value: string) =>
			MINIMAL_ISDOC.replace(
				'<TaxInclusiveAmount>1000.00</TaxInclusiveAmount>\n    <AlreadyClaimedTaxExclusiveAmount>',
				`<TaxInclusiveAmount>${value}</TaxInclusiveAmount>\n    <AlreadyClaimedTaxExclusiveAmount>`,
			);
		const word = await source('necitelna-castka.pdf', pdfWithIsdoc(amount('moc')));
		const comma = await source('carka.pdf', pdfWithIsdoc(amount('1000,50')));
		const huge = await source('strop.pdf', pdfWithIsdoc(amount('90000000000.01')));

		await expect(importFrom(word)).rejects.toEqual(
			new Error(
				`necitelna-castka.pdf: PDF má vadnou přílohu ISDOC — ISDOC nejde přečíst: řádek 69: prvek TaxInclusiveAmount neodpovídá standardu ISDOC${SUFFIX}`,
			),
		);
		await expect(importFrom(comma)).rejects.toEqual(
			new Error(
				`carka.pdf: PDF má vadnou přílohu ISDOC — ISDOC nejde přečíst: řádek 69: prvek TaxInclusiveAmount neodpovídá standardu ISDOC${SUFFIX}`,
			),
		);
		await expect(importFrom(huge)).rejects.toEqual(
			new Error(
				'strop.pdf: částka s daní v <TaxInclusiveAmount>: částka „90000000000.01“ přesahuje strop 90 miliard Kč.',
				{ cause: new Error('částka „90000000000.01“ přesahuje strop 90 miliard Kč') },
			),
		);
		expect(await exists(received())).toBe(false);
	});

	it('PDF bez čitelného ISDOC odmítne bez kopie', async () => {
		const broken = await source('rozbite.pdf', new TextEncoder().encode('%PDF-1.4\n% tohle není platné PDF\n'));
		const plain = await source('obycejne.pdf', savePdf(await samplePdf()));
		const header = await source('hlavicka.pdf', new TextEncoder().encode('%PDF-x'));

		await expect(importFrom(broken)).rejects.toEqual(
			new Error(`rozbite.pdf: PDF neobsahuje přílohu ISDOC${SUFFIX}`, {
				cause: new Error('PDF neobsahuje přílohu ISDOC'),
			}),
		);
		await expect(importFrom(plain)).rejects.toEqual(
			new Error(`obycejne.pdf: PDF neobsahuje přílohu ISDOC${SUFFIX}`),
		);
		await expect(importFrom(header)).rejects.toEqual(
			new Error('hlavicka.pdf je poškozené PDF: Failed to parse number (line:0 col:5 offset=5): "".', {
				cause: expect.any(Error),
			}),
		);
		expect(await exists(received())).toBe(false);
	});

	it('jinou příponu než PDF odmítne a složku nezaloží', async () => {
		const docx = await source('faktura.docx', new TextEncoder().encode('%PDF-1.4'));
		const bare = await source('doklad', receivedPdf('20260001'));

		await expect(importFrom(docx)).rejects.toEqual(new Error('Přijatý doklad musí být PDF: faktura.docx'));
		await expect(importFrom(bare)).rejects.toEqual(new Error('Přijatý doklad musí být PDF: doklad'));
		const wrapped = await source('faktura.pdf.zip', receivedPdf('20260001'));
		await expect(importFrom(wrapped)).rejects.toEqual(new Error('Přijatý doklad musí být PDF: faktura.pdf.zip'));
		expect(await exists(received())).toBe(false);
	});

	it('obří PDF odmítne, aniž by ho četl', async () => {
		const path = join(base, 'sken.pdf');
		await writeFile(path, new Uint8Array());
		await truncate(path, 8 * 1024 * 1024 * 1024);

		await expect(importFrom(path)).rejects.toEqual(
			new Error('Doklad nejde přečíst: soubor má víc než 64 MB — takhle doklad nevypadá'),
		);
		expect(await exists(received())).toBe(false);
	});

	it('soubor, který se za PDF jen vydává, odmítne', async () => {
		const zip = await source('faktura.pdf', new TextEncoder().encode('PK\u0003\u0004 tohle je zip'));
		const late = await source('doklad.pdf', new TextEncoder().encode(`${' '.repeat(1020)}%PDF-1.4`));

		await expect(importFrom(zip)).rejects.toEqual(new Error('faktura.pdf není PDF, má jen jeho příponu.'));
		await expect(importFrom(late)).rejects.toEqual(new Error('doklad.pdf není PDF, má jen jeho příponu.'));
		expect(await exists(received())).toBe(false);
	});

	it('složka místo zdroje nenechá v prijate/ útržek', async () => {
		const folder = join(base, 'neco.pdf');
		await mkdir(folder);

		await expect(importFrom(folder)).rejects.toEqual(
			new Error('Doklad nejde přečíst: EISDIR: illegal operation on a directory, read', {
				cause: expect.objectContaining({ code: 'EISDIR' }),
			}),
		);
		expect(await exists(received())).toBe(false);
	});

	it('chybějící vault se nezaloží', async () => {
		const vault = join(base, 'neni');

		await expect(
			importReceived({
				vaultPath: vault,
				sourcePath: join(base, 'doklad.pdf'),
			}),
		).rejects.toEqual(new Error(`Datová složka ${vault} neexistuje.`));
	});
});

describe('shodný obsah a jména', () => {
	it('tentýž obsah podruhé odmítne', async () => {
		const path = await source('F2026007.pdf', subcontractors());
		const first = await importFrom(path);
		const renamed = join(base, 'jine-jmeno.pdf');
		await copyFile(path, renamed);

		await expect(importFrom(renamed)).rejects.toEqual(
			new Error(`jine-jmeno.pdf už v prijate/ leží jako ${first.file} — tentýž soubor podruhé.`),
		);
		expect(await names(received())).toEqual(['F2026007.pdf']);
	});

	it('import zablokuje jen čitelný soubor se stejným obsahem', async () => {
		const path = await source('doklad.pdf', receivedPdf('20260001'));
		const content = await readFile(path);
		const other = Buffer.from(content);
		other[other.length - 1] ^= 1;
		await mkdir(received('slozka.pdf'), { recursive: true });
		await symlink(join(base, 'nikde.pdf'), received('mrtvy-odkaz.pdf'));
		await writeFile(received('jiny.pdf'), other);
		await writeFile(received('poznamka.txt'), 'kratší');
		const locked = received('zamceny.pdf');
		await writeFile(locked, content);
		await chmod(locked, 0o000);

		let document: ReceivedDocument;
		try {
			document = await importFrom(path);
		} finally {
			await chmod(locked, 0o600);
		}

		expect(document.file).toBe('doklad.pdf');
	});

	it('zpětné lomítko a dvojtečka se změní na pomlčku', async () => {
		await ensureVault({ vaultPath: base });
		const path = await source('fa\\2026:01.pdf', receivedPdf('20260001'));

		const document = await importFrom(path);

		expect(document.file).toBe('fa-2026-01.pdf');
		expect(
			await receivedPath({
				vaultPath: base,
				file: document.file,
			}),
		).toBe(received('fa-2026-01.pdf'));
		await removeReceived({
			vaultPath: base,
			file: document.file,
		});
		expect(await names(received())).toEqual([]);
	});

	it('mezery a tečky na začátku jména zdroje odřízne', async () => {
		const hidden = await source(' .skryty.pdf', receivedPdf('20260001'));
		const dotted = await source('. .pdf', receivedPdf('20260002'));

		const document = await importFrom(hidden);

		expect(document.file).toBe('skryty.pdf');
		await expect(importFrom(dotted)).rejects.toEqual(new Error('Nepoužitelný název souboru: .pdf'));
	});

	it('jméno ze samých teček odmítne', async () => {
		const path = await source('...', receivedPdf('20260001'));

		await expect(importFrom(path)).rejects.toEqual(new Error(`Nepoužitelný název souboru: ${path}`));
	});

	it('tři doklady stejného jména uloží vedle sebe', async () => {
		const path = join(base, 'faktura.pdf');
		const saved = [];
		for (const number of ['20260000', '20260001', '20260002']) {
			await writeFile(path, await receivedPdf(number));
			const { file } = await importFrom(path);
			saved.push(file);
		}

		expect(saved).toEqual(['faktura.pdf', 'faktura-2.pdf', 'faktura-3.pdf']);
		expect(await names(received())).toEqual(['faktura-2.pdf', 'faktura-3.pdf', 'faktura.pdf']);
	});
});

describe('selhání složky prijate/', () => {
	it('nečitelná složka se ohlásí při importu i při kontrole', async () => {
		const path = await source('doklad.pdf', receivedPdf('20260001'));
		await mkdir(received());
		await chmod(received(), 0o300);

		const reason = new Error(`Složku prijate/ nejde přečíst: EACCES: permission denied, scandir '${received()}'`, {
			cause: expect.objectContaining({ code: 'EACCES' }),
		});
		try {
			await expect(importFrom(path)).rejects.toEqual(reason);
			await expect(listBrokenReceived({ vaultPath: base })).rejects.toEqual(reason);
		} finally {
			await chmod(received(), 0o700);
		}
	});

	it('soubor na místě prijate/ se ohlásí', async () => {
		await writeFile(received(), 'neni-slozka');
		const path = await source('doklad.pdf', receivedPdf('20260001'));

		await expect(importFrom(path)).rejects.toEqual(
			new Error(`Složku prijate/ nejde vytvořit: EEXIST: file already exists, mkdir '${received()}'`, {
				cause: expect.objectContaining({ code: 'EEXIST' }),
			}),
		);
	});

	it('nepovedená kopie se ohlásí a nic po ní nezůstane', async () => {
		await mkdir(received());
		await chmod(received(), 0o500);
		const path = await source('doklad.pdf', receivedPdf('20260001'));

		try {
			await expect(importFrom(path)).rejects.toEqual(
				new Error(`Doklad nejde zkopírovat: EACCES: permission denied, open '${received('doklad.pdf')}'`, {
					cause: expect.objectContaining({ code: 'EACCES' }),
				}),
			);
		} finally {
			await chmod(received(), 0o700);
		}
		expect(await names(received())).toEqual([]);
	});

	it('jméno bez místa na dočasnou kopii nenechá nic', async () => {
		// Nejdelší jméno, které souborový systém složky vezme; dočasná kopie je o náhodnou příponu a `.tmp`
		// delší. Limit se zjišťuje, ne předpokládá: jinde než na APFS nemusí být 255 bajtů.
		const probe = join(base, 'zkouska');
		await mkdir(probe);
		const fits = async (length: number) => {
			const [written] = await Promise.allSettled([writeFile(join(probe, 'd'.repeat(length)), '')]);
			return written.status === 'fulfilled';
		};
		let [longest, tooLong] = [1, 1 << 16];
		expect(await fits(tooLong)).toBe(false);
		while (tooLong - longest > 1) {
			const middle = Math.floor((longest + tooLong) / 2);
			if (await fits(middle)) longest = middle;
			else tooLong = middle;
		}
		await rm(probe, { recursive: true });
		const name = `${'d'.repeat(longest - '.pdf'.length)}.pdf`;
		const path = await source(name, receivedPdf('20260001'));

		const error = await rejection(importFrom(path));

		expect(String(error)).toMatch(
			new RegExp(
				`^Error: Doklad nejde zkopírovat: Zápis selhal: ENAMETOOLONG: name too long, open '${received(name)}[0-9a-f]{6}\\.tmp'$`,
			),
		);
		expect(error).toHaveProperty('cause.cause.code', 'ENAMETOOLONG');
		expect(await names(received())).toEqual([]);
	});
});

describe('odstranění a cesta dokladu', () => {
	it('odmítnutý doklad jde smazat a podruhé to nevadí', async () => {
		const { file } = await importFrom(await source('cizi.pdf', receivedPdf('20260001')));
		const removal = {
			vaultPath: base,
			file,
		};

		expect(await removeReceived(removal)).toBe(null);
		expect(await exists(received(file))).toBe(false);
		expect(await removeReceived(removal)).toBe(null);
	});

	it('složku v prijate/ nesmaže', async () => {
		await mkdir(received('zamceny.pdf'), { recursive: true });

		await expect(
			removeReceived({
				vaultPath: base,
				file: 'zamceny.pdf',
			}),
		).rejects.toEqual(new Error('Doklad nejde smazat: zamceny.pdf je složka, ne soubor.'));
		expect(await exists(received('zamceny.pdf'))).toBe(true);
	});

	it('doklad, na který nejde sáhnout, ohlásí', async () => {
		await mkdir(received());
		await writeFile(received('doklad.pdf'), 'pdf');
		const removal = {
			vaultPath: base,
			file: 'doklad.pdf',
		};

		await chmod(received(), 0o500);
		try {
			await expect(removeReceived(removal)).rejects.toEqual(
				new Error(`Doklad nejde smazat: EACCES: permission denied, unlink '${received('doklad.pdf')}'`, {
					cause: expect.objectContaining({ code: 'EACCES' }),
				}),
			);
		} finally {
			await chmod(received(), 0o700);
		}
		await chmod(received(), 0o000);
		try {
			await expect(removeReceived(removal)).rejects.toEqual(
				new Error(`Doklad nejde smazat: EACCES: permission denied, lstat '${received('doklad.pdf')}'`, {
					cause: expect.objectContaining({ code: 'EACCES' }),
				}),
			);
		} finally {
			await chmod(received(), 0o700);
		}
		expect(await names(received())).toEqual(['doklad.pdf']);
	});

	it('jméno s cestou odmítne', async () => {
		for (const bad of ['../tajne.pdf', '../../etc/passwd', '.skryty.pdf', '', 'a\\b.pdf']) {
			const request = {
				vaultPath: base,
				file: bad,
			};
			const refusal = new Error(`Nepoužitelný název souboru: ${bad}`);

			await expect(removeReceived(request)).rejects.toEqual(refusal);
			await expect(receivedPath(request)).rejects.toEqual(refusal);
		}
	});

	it('cesta k dokladu míří do prijate/', async () => {
		expect(
			await receivedPath({
				vaultPath: base,
				file: 'doklad.pdf',
			}),
		).toBe(received('doklad.pdf'));
		expect(
			await receivedPath({
				vaultPath: base,
				file: ' doklad.pdf ',
			}),
		).toBe(received('doklad.pdf'));
	});
});

describe('kontrola prijate/', () => {
	it('vypíše jen doklady, které appka nepřečte', async () => {
		await mkdir(received('slozka.pdf'), { recursive: true });
		await writeFile(received('platny.pdf'), await receivedPdf('20260001'));
		await writeFile(received('.DS_Store'), 'macOS');
		await writeFile(received('bez-isdoc.pdf'), await savePdf(await samplePdf()));
		await writeFile(received('poznamka.txt'), '%PDF-1.4');
		await symlink(join(base, 'nikde.pdf'), received('mrtvy-odkaz.pdf'));
		const xml = MINIMAL_ISDOC.replace(
			'<TaxInclusiveAmount>1000.00</TaxInclusiveAmount>\n    <AlreadyClaimedTaxExclusiveAmount>',
			'<TaxInclusiveAmount></TaxInclusiveAmount>\n    <AlreadyClaimedTaxExclusiveAmount>',
		);
		await writeFile(received('bez-castky.pdf'), await pdfWithIsdoc(xml));
		listing.reversed = true;

		expect(await listBrokenReceived({ vaultPath: base })).toEqual([
			{
				file: 'bez-castky.pdf',
				reason: `bez-castky.pdf: PDF má vadnou přílohu ISDOC — ISDOC nejde přečíst: řádek 69: prvek TaxInclusiveAmount neodpovídá standardu ISDOC${SUFFIX}`,
			},
			{
				file: 'bez-isdoc.pdf',
				reason: `bez-isdoc.pdf: PDF neobsahuje přílohu ISDOC${SUFFIX}`,
			},
			{
				file: 'poznamka.txt',
				reason: 'Přijatý doklad musí být PDF: poznamka.txt',
			},
		]);
	});

	it('vault bez přijatých dokladů je v pořádku', async () => {
		expect(await listBrokenReceived({ vaultPath: base })).toEqual([]);
	});
});
