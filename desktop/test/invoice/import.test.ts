import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DocumentKind } from '~/constants/invoice';

import { deleteInvoice } from '../../invoice/delete.ts';
import { addCredit, checkCredit, type CreditTargets, importDocuments, placePdf } from '../../invoice/import.ts';
import { listInvoices } from '../../invoice/index.ts';
import { buildIsdoc } from '../../invoice/isdoc.ts';
import { saveInvoice } from '../../invoice/mod.ts';
import { ensureVault } from '../../vault.ts';
import { customer, invoice, supplier } from '../invoices.ts';
import { pdfWithIsdoc } from '../pdfs.ts';
import { names } from '../support.ts';

import type { Invoice } from '../../invoice/model.ts';
import type { ImportReport } from '~/bindings';

const OURS = '12345679';

let base = '';

beforeEach(async () => {
	base = await mkdtemp(join(tmpdir(), `fakturian-import-${process.pid}-`));
});

afterEach(async () => {
	await rm(base, { recursive: true });
});

function invoices(...parts: string[]): string {
	return join(base, 'faktury', ...parts);
}

function numbered(number: string): Invoice {
	return {
		...invoice(),
		number,
	};
}

// Cizí doklad tak, jak přijde od jiného softwaru: PDF s vloženým ISDOC.
async function pdfWith(name: string, xml: string): Promise<string> {
	const path = join(base, `${name}.pdf`);
	await writeFile(path, await pdfWithIsdoc(xml));
	return path;
}

function document(name: string, source: Invoice): Promise<string> {
	return pdfWith(name, buildIsdoc(source));
}

function importInto(paths: string[], ourIco: string | null = OURS): Promise<ImportReport> {
	return importDocuments({
		vaultPath: base,
		paths,
		ourIco,
	});
}

function reasons(report: ImportReport): string[] {
	return report.skipped.map(({ reason }) => reason);
}

async function listedNumbers(): Promise<string[]> {
	const { items } = await listInvoices({ vaultPath: base });
	return items.map(({ number }) => number);
}

function save(vaultPath: string, source: Invoice): Promise<string> {
	return saveInvoice({
		vaultPath,
		invoice: source,
		isNew: true,
	});
}

// Dobropis na celou fakturu: stejné řádky s opačnou cenou.
function wholeCredit(original: Invoice, number: string): Invoice {
	return {
		...original,
		number,
		variableSymbol: number,
		documentType: DocumentKind.CreditNote,
		originalInvoice: original.number,
		originalIssueDate: original.issueDate,
		lines: original.lines.map((line) => ({
			...line,
			unitPriceCents: -line.unitPriceCents,
		})),
	};
}

describe('import vydaných dokladů', () => {
	it('naimportovaný doklad je v přehledu, ne jen na disku', async () => {
		const source = await document('export', numbered('F2025-001'));

		const report = await importInto([source]);

		expect(report.imported).toEqual([
			{
				number: 'F2025-001',
				customer: 'Odběratel s.r.o.',
				issueDate: '2026-05-29',
				totalCents: 5_175_000,
			},
		]);
		expect(await names(invoices())).toEqual(['F2025-001.pdf']);
		expect(await listedNumbers()).toEqual(['F2025-001']);
	});

	it('PDF se zkopíruje beze změny a zdroj zůstane', async () => {
		const foreign = join(base, 'cizi');
		await mkdir(foreign);
		const source = await save(foreign, numbered('F2025-030'));
		const original = await readFile(source);

		const report = await importInto([source]);

		expect(report.imported.map(({ number }) => number)).toEqual(['F2025-030']);
		expect(await readFile(invoices('F2025-030.pdf'))).toEqual(original);
		expect(await readFile(source)).toEqual(original);
	});

	it('holé ISDOC nevezme', async () => {
		const source = join(base, 'export.isdoc');
		await writeFile(source, buildIsdoc(invoice()));

		const report = await importInto([source]);

		expect(report).toEqual({
			imported: [],
			skipped: [
				{
					file: 'export.isdoc',
					reason: 'soubor není PDF s vloženým ISDOC',
				},
			],
			customers: [],
		});
		expect(await listedNumbers()).toEqual([]);
	});

	it('vrátí odběratele z dokladu bez registrace', async () => {
		const source = await document('export', numbered('F2025-002'));

		const report = await importInto([source]);

		const { name, ico, dic, address, email } = customer();
		expect(report.customers).toEqual([
			{
				name,
				ico,
				dic,
				address,
				email,
			},
		]);
	});

	it('doklad bez odběratele přeskočí', async () => {
		const anonymous = numbered('F2025-002A');
		const source = await document('anonymni', {
			...anonymous,
			customer: {
				...anonymous.customer,
				name: '',
			},
		});

		const report = await importInto([source]);

		expect(report).toEqual({
			imported: [],
			skipped: [
				{
					file: 'anonymni.pdf',
					reason: 'doklad neuvádí odběratele — anonymní doklad do vydaných faktur nepatří',
				},
			],
			customers: [],
		});
		expect(await names(invoices())).toEqual([]);
	});

	it('doklad, který by frontend odmítl, do vaultu nepustí', async () => {
		const xml = buildIsdoc(numbered('F2025-011'));
		const issue = '<IssueDate>2026-05-29</IssueDate>';
		const early = await pdfWith('rok', xml.replace(issue, '<IssueDate>0999-12-31</IssueDate>'));
		const missing = await pdfWith('datum', xml.replace(issue, '<IssueDate>2026-02-30</IssueDate>'));
		const comma = await pdfWith(
			'castka',
			xml.replace('<PayableAmount>51750.00</PayableAmount>', '<PayableAmount>1.200,00</PayableAmount>'),
		);

		const report = await importInto([early, missing, comma]);

		expect(report.imported).toEqual([]);
		expect(reasons(report)).toEqual([
			'doklad má neplatné datum vystavení „0999-12-31“ (čekám RRRR-MM-DD)',
			'PDF má vadnou přílohu ISDOC — ISDOC nejde přečíst: řádek 2: prvek IssueDate neodpovídá standardu ISDOC',
			'PDF má vadnou přílohu ISDOC — ISDOC nejde přečíst: řádek 2: prvek PayableAmount neodpovídá standardu ISDOC',
		]);
		expect(await names(invoices())).toEqual([]);
		const { broken } = await listInvoices({ vaultPath: base });
		expect(broken).toEqual([]);
	});

	it('doklad v cizí měně odmítne, koruny v ForeignCurrencyCode ne', async () => {
		const xml = buildIsdoc(numbered('F2025-012'));
		const local = '<LocalCurrencyCode>CZK</LocalCurrencyCode>';
		const foreign = await pdfWith(
			'eur',
			xml.replace(local, `${local}<ForeignCurrencyCode>EUR</ForeignCurrencyCode>`),
		);
		const crowns = await pdfWith(
			'czk',
			xml.replace(local, `${local}<ForeignCurrencyCode>czk</ForeignCurrencyCode>`),
		);
		const blank = await pdfWith(
			'prazdna',
			xml
				.replace(local, `${local}<ForeignCurrencyCode>   </ForeignCurrencyCode>`)
				.replaceAll('F2025-012', 'F2025-013'),
		);

		const report = await importInto([foreign, crowns, blank]);

		expect(reasons(report)).toEqual(['doklad je vystavený v cizí měně EUR; Fakturian vede jen koruny']);
		expect(report.imported.map(({ number }) => number)).toEqual(['F2025-012', 'F2025-013']);
	});

	it('odběratele bez IČO sloučí podle jména bez ohledu na velikost písmen', async () => {
		const first = {
			...numbered('F2025-003'),
			customer: {
				...customer(),
				name: 'Jana Novak',
				ico: '',
			},
		};
		const second = {
			...first,
			number: 'F2025-004',
			customer: {
				...first.customer,
				name: 'JANA NOVAK',
			},
		};
		const paths = [await document('prvni', first), await document('druhy', second)];

		const report = await importInto(paths);

		expect(report.imported.length).toBe(2);
		expect(report.customers.map(({ name }) => name)).toEqual(['Jana Novak']);
	});

	it('různí odběratelé bez IČO i s různým IČO zůstanou zvlášť, stejné IČO je jeden', async () => {
		const parties = [
			['Jana Novak', ''],
			['Petr Novak', ''],
			['Firma A', '87654326'],
			['Firma B', '11223344'],
			['Firma A přejmenovaná', '87654326'],
		];
		const paths = [];
		for (const [i, [name, ico]] of parties.entries()) {
			paths.push(
				await document(`doklad-${i}`, {
					...numbered(`F2025-84${i}`),
					customer: {
						...customer(),
						name,
						ico,
					},
				}),
			);
		}

		const report = await importInto(paths);

		expect(report.customers.map(({ name }) => name)).toEqual(['Jana Novak', 'Petr Novak', 'Firma A', 'Firma B']);
	});

	it('odběratele nezdvojí úvodní nuly v IČO', async () => {
		const paths = [];
		for (const [i, ico] of ['87654326', '0087654326'].entries()) {
			paths.push(
				await document(`doklad-${i}`, {
					...numbered(`F2025-82${i}`),
					customer: {
						...customer(),
						ico,
					},
				}),
			);
		}

		const report = await importInto(paths);

		expect(report.imported.length).toBe(2);
		expect(report.customers.map(({ ico }) => ico)).toEqual(['87654326']);
	});

	it('prázdná dávka projde bez chyby', async () => {
		expect(await importInto([])).toEqual({
			imported: [],
			skipped: [],
			customers: [],
		});
	});

	it('bez našeho IČO projde i doklad jiného dodavatele', async () => {
		const source = await document('export', numbered('F2025-050'));

		const report = await importInto([source], null);

		expect(report.imported.map(({ number }) => number)).toEqual(['F2025-050']);
	});
});

describe('doklady, které import nevezme', () => {
	it('vadný soubor neshodí zbytek dávky', async () => {
		const good = await document('dobry', numbered('F2025-010'));
		const wrong = join(base, 'rozbity.pdf');
		await writeFile(wrong, 'tohle není PDF');

		const report = await importInto([wrong, good]);

		expect(report.imported.map(({ number }) => number)).toEqual(['F2025-010']);
		expect(report.skipped).toEqual([
			{
				file: 'rozbity.pdf',
				reason: 'soubor není PDF s vloženým ISDOC',
			},
		]);
	});

	it('chybějící zdroj se ohlásí a dávka jde dál', async () => {
		const missing = join(base, 'cizi', 'chybi.pdf');

		const report = await importInto([missing]);

		expect(reasons(report)).toEqual([`nejde přečíst: ENOENT: no such file or directory, open '${missing}'`]);
		expect(await names(invoices())).toEqual([]);
	});

	it('doklad bez čísla ani s číslem, které je cesta, nepřevezme', async () => {
		const blank = await document('bezcisla', numbered(''));
		const path = await document('zakerny', numbered('../../uniklo'));

		const report = await importInto([blank, path]);

		expect(report.imported).toEqual([]);
		expect(reasons(report)).toEqual([
			'Číslo dokladu je povinné.',
			'Číslo dokladu může mít nejvýš 64 znaků: písmena bez diakritiky, číslice, mezery, tečky, pomlčky a podtržítka, a musí začínat i končit písmenem nebo číslicí.',
		]);
		expect(await names(invoices())).toEqual([]);
	});

	it('doklad plátce DPH odmítne', async () => {
		const xml = buildIsdoc(numbered('F2025-020'));
		const source = await pdfWith(
			'platce',
			xml.replaceAll('<VATApplicable>false</VATApplicable>', '<VATApplicable>true</VATApplicable>'),
		);

		const report = await importInto([source]);

		expect(reasons(report)).toEqual(['doklad je od plátce DPH; Fakturian umí jen neplátce']);
	});

	it('VATApplicable 0 neprojde schématem', async () => {
		const xml = buildIsdoc(numbered('F2025-060'));
		const source = await pdfWith(
			'nula',
			xml.replaceAll('<VATApplicable>false</VATApplicable>', '<VATApplicable>0</VATApplicable>'),
		);

		const report = await importInto([source]);

		expect(reasons(report)).toEqual([
			'PDF má vadnou přílohu ISDOC — ISDOC nejde přečíst: řádek 2: prvek VATApplicable neodpovídá standardu ISDOC',
		]);
	});

	it('žádný nepodporovaný druh dokladu ISDOC neprojde', async () => {
		const paths = [];
		for (const type of [3, 4, 5, 6, 7]) {
			const xml = buildIsdoc(numbered(`F2025-00${type}`));
			paths.push(
				await pdfWith(
					`typ-${type}`,
					xml.replace('<DocumentType>1</DocumentType>', `<DocumentType>${type}</DocumentType>`),
				),
			);
		}

		const report = await importInto(paths);

		expect(report.imported).toEqual([]);
		expect(reasons(report)).toEqual([
			'doklad typu 3 (vrubopis) appka neumí — do vydaných faktur nepatří',
			'doklad typu 4 (zálohová faktura (nedaňový zálohový list)) appka neumí — do vydaných faktur nepatří',
			'doklad typu 5 (daňový doklad při přijetí platby) appka neumí — do vydaných faktur nepatří',
			'doklad typu 6 (opravný daňový doklad při přijetí platby) appka neumí — do vydaných faktur nepatří',
			'doklad typu 7 (zjednodušený daňový doklad) appka neumí — do vydaných faktur nepatří',
		]);
	});

	it('doklad bez IČO dodavatele neprojde, když naše IČO známe', async () => {
		const anonymous = await document('anonymni', {
			...invoice(),
			supplier: {
				...supplier(),
				name: '',
				ico: '',
			},
		});
		const named = await document('bez-ica', {
			...numbered('F2025-810'),
			supplier: {
				...supplier(),
				ico: '',
			},
		});

		const report = await importInto([anonymous, named]);

		expect(report.imported).toEqual([]);
		expect(reasons(report)).toEqual([
			'doklad neuvádí IČO dodavatele (neznámý dodavatel), takže nejde poznat, že je tvůj — přijaté doklady patří do Výdajů',
			'doklad neuvádí IČO dodavatele (Jan Dodavatel), takže nejde poznat, že je tvůj — přijaté doklady patří do Výdajů',
		]);
	});

	it('přijatý doklad mezi vydané nepatří a jeho odběratel mezi odběratele taky ne', async () => {
		const source = await document('prijata', {
			...numbered('F2025-040'),
			supplier: customer(),
			customer: supplier(),
		});

		const report = await importInto([source]);

		expect(report).toEqual({
			imported: [],
			skipped: [
				{
					file: 'prijata.pdf',
					reason: 'doklad vystavil Odběratel s.r.o. (IČO 87654326), ne ty — přijaté doklady patří do Výdajů',
				},
			],
			customers: [],
		});
	});

	it('doklad s jinou částkou k úhradě odmítne', async () => {
		const xml = buildIsdoc(invoice());
		const source = await pdfWith(
			'nesedi',
			xml.replace('<PayableAmount>51750.00</PayableAmount>', '<PayableAmount>999.99</PayableAmount>'),
		);

		const report = await importInto([source]);

		expect(reasons(report)).toEqual([
			'doklad hlásí k úhradě 999.99 Kč, ale ze řádků vychází 51750.00 — nejspíš obsahuje zálohy nebo odpočty, které appka neumí',
		]);
	});

	it('doklad bez položek neprojde schématem', async () => {
		const source = await document('bez-polozek', {
			...invoice(),
			lines: [],
		});

		const report = await importInto([source]);

		expect(reasons(report)).toEqual([
			'PDF má vadnou přílohu ISDOC — ISDOC nejde přečíst: řádek 2: prvek InvoiceLines neodpovídá standardu ISDOC',
		]);
		expect(await listedNumbers()).toEqual([]);
	});
});

describe('kolize čísel', () => {
	it('číslo, které ve vaultu už je, přeskočí a původní nechá', async () => {
		const stored = await save(base, invoice());
		const before = await readFile(stored);
		const source = await document('export', invoice());

		const report = await importInto([source]);

		expect(reasons(report)).toEqual(['faktura 20260001 už ve vaultu existuje']);
		expect(await readFile(stored)).toEqual(before);
		expect(await listedNumbers()).toEqual(['20260001']);
	});

	it('dva soubory téhož čísla v jedné dávce: druhý nepřepíše první', async () => {
		const foreign = join(base, 'cizi');
		await mkdir(foreign);
		const first = await save(foreign, {
			...numbered('F2025-040'),
			customer: {
				...customer(),
				name: 'První odběratel',
			},
		});
		const copy = join(base, 'kopie.pdf');
		await copyFile(first, copy);
		const content = await readFile(first);

		const report = await importInto([first, copy]);

		expect(report.imported.map(({ number }) => number)).toEqual(['F2025-040']);
		expect(report.skipped).toEqual([
			{
				file: 'kopie.pdf',
				reason: 'faktura F2025-040 už ve vaultu existuje',
			},
		]);
		expect(await readFile(invoices('F2025-040.pdf'))).toEqual(content);
	});

	it('konfliktní jméno ve faktury/ nepřepíše', async () => {
		const stored = await save(base, numbered('F2025-824'));
		const collision = invoices('F2025 2.pdf');
		await rename(stored, collision);
		const before = await readFile(collision);
		const source = await document('zdroj', numbered('F2025 2'));

		const report = await importInto([source]);

		expect(reasons(report)).toEqual(['faktura F2025 2 už ve vaultu existuje']);
		expect(await readFile(collision)).toEqual(before);
	});

	it('číslo lišící se jen velikostí písmen nepřepíše', async () => {
		const stored = await save(base, numbered('F2025-840'));
		const before = await readFile(stored);
		const source = await document('zdroj', numbered('f2025-840'));

		const report = await importInto([source], null);

		expect(reasons(report)).toEqual(['faktura f2025-840 už ve vaultu existuje']);
		expect(await readFile(stored)).toEqual(before);
		expect(await names(invoices())).toEqual(['F2025-840.pdf']);
	});

	it('jméno zabrané něčím jiným než dokladem nenahradí', async () => {
		await ensureVault({ vaultPath: base });
		const taken = invoices('F2025-842.pdf');
		await mkdir(taken);
		await writeFile(join(taken, 'poznamka.txt'), 'obsah');
		const source = await document('zdroj', numbered('F2025-842'));

		const report = await importInto([source], null);

		expect(reasons(report)).toEqual(['faktura F2025-842 už ve vaultu existuje']);
		expect(await readFile(join(taken, 'poznamka.txt'), 'utf8')).toBe('obsah');
	});
});

describe('selhání zápisu', () => {
	it('nepovedená kopie nenechá ve faktury/ útržek a zdroj zůstane', async () => {
		await ensureVault({ vaultPath: base });
		const source = await document('zdroj', numbered('F2025-830'));
		await chmod(invoices(), 0o500);

		let report: ImportReport;
		try {
			report = await importInto([source], null);
		} finally {
			await chmod(invoices(), 0o700);
		}

		expect(reasons(report)).toEqual([
			`Zápis selhal: EACCES: permission denied, open '${invoices('F2025-830.pdf')}'`,
		]);
		expect(await names(invoices())).toEqual([]);
		expect(new Uint8Array(await readFile(source))).toEqual(await pdfWithIsdoc(buildIsdoc(numbered('F2025-830'))));
	});

	it('soubor na místě faktury/ je chyba celé dávky', async () => {
		await writeFile(invoices(), 'soubor');

		await expect(importInto([])).rejects.toEqual(
			new Error(`Složku faktury/ nejde vytvořit: EEXIST: file already exists, mkdir '${invoices()}'`, {
				cause: expect.objectContaining({ code: 'EEXIST' }),
			}),
		);
	});

	it('chybějící vault se nezaloží', async () => {
		const vault = join(base, 'neni');

		await expect(
			importDocuments({
				vaultPath: vault,
				paths: [],
				ourIco: null,
			}),
		).rejects.toEqual(new Error(`Datová složka ${vault} neexistuje.`));
		expect(await names(base)).toEqual([]);
	});
});

describe('umístění PDF', () => {
	it('přesun na zabrané jméno nechá oba soubory', async () => {
		const source = join(base, 'zdroj.pdf');
		const target = join(base, '20260001.pdf');
		await writeFile(source, 'zdroj');
		await writeFile(target, 'doklad');

		expect(await placePdf(source, target, true)).toBe('taken');
		expect(await readFile(target, 'utf8')).toBe('doklad');
		expect(await readFile(source, 'utf8')).toBe('zdroj');
	});

	it('přesun na volné jméno doklad přesune i s obsahem', async () => {
		const source = join(base, 'zdroj.pdf');
		const target = join(base, '20260001.pdf');
		await writeFile(source, 'doklad');

		expect(await placePdf(source, target, true)).toBe('written');
		expect([await names(base), await readFile(target, 'utf8')]).toEqual([['20260001.pdf'], 'doklad']);
	});

	it('nepovedený přesun ani kopie nenechá rezervaci', async () => {
		const missing = join(base, 'chybi.pdf');
		const target = join(base, '20260001.pdf');

		await expect(placePdf(missing, target, true)).rejects.toEqual(
			new Error(`${missing}: ENOENT: no such file or directory, rename '${missing}' -> '${target}'`),
		);
		await expect(placePdf(missing, target, false)).rejects.toEqual(
			new Error(`nejde zkopírovat: ENOENT: no such file or directory, open '${missing}'`, {
				cause: expect.objectContaining({ code: 'ENOENT' }),
			}),
		);
		const nowhere = join(base, 'nic', 'x.pdf');
		await expect(placePdf(missing, nowhere, true)).rejects.toEqual(
			new Error(`nejde přesunout: ENOENT: no such file or directory, open '${nowhere}'`, {
				cause: expect.objectContaining({ code: 'ENOENT' }),
			}),
		);
		expect(await names(base)).toEqual([]);
	});
});

describe('dobropisy v dávce', () => {
	it('dobropis na celou fakturu ve vaultu projde', async () => {
		await save(base, invoice());
		const credit = await document('dobropis', wholeCredit(invoice(), '20260002'));

		const report = await importInto([credit]);

		expect(reasons(report)).toEqual([]);
		expect(report.imported.map(({ number }) => number)).toEqual(['20260002']);
	});

	it('dobropis se ověří až po fakturách své dávky', async () => {
		const credit = await document('dobropis', wholeCredit(invoice(), '20260002'));
		const original = await document('faktura', invoice());

		const report = await importInto([credit, original]);

		expect(reasons(report)).toEqual([]);
		expect(report.imported.map(({ number }) => number)).toEqual(['20260001', '20260002']);
	});

	it('dobropis bez své faktury ani bez odkazu nepřevezme', async () => {
		const orphan = await document('sirotek', wholeCredit(invoice(), '20260002'));
		const blank = await document('bez-odkazu', {
			...wholeCredit(invoice(), '20260003'),
			originalInvoice: '  ',
		});

		const report = await importInto([orphan, blank]);

		expect(report.imported).toEqual([]);
		expect(reasons(report)).toEqual([
			'dobropis opravuje fakturu 20260001, která není ve vaultu ani v tomtéž importu',
			'dobropis neuvádí fakturu, kterou opravuje',
		]);
	});

	it('dobropis na dobropis ve vaultu nepřevezme', async () => {
		const first = wholeCredit(invoice(), '20260002');
		await save(base, invoice());
		await save(base, first);

		const report = await importInto([
			await document('druhy', {
				...wholeCredit(first, '20260003'),
				lines: first.lines,
			}),
		]);

		expect(reasons(report)).toEqual([
			'dobropis opravuje fakturu 20260002, která není ve vaultu ani v tomtéž importu',
		]);
	});

	it('faktura, která na jinou jen odkazuje, dobropis té faktury neblokuje', async () => {
		await save(base, invoice());
		await save(base, {
			...numbered('20260004'),
			originalInvoice: '20260001',
		});

		const report = await importInto([await document('dobropis', wholeCredit(invoice(), '20260002'))]);

		expect(reasons(report)).toEqual([]);
	});

	it('tentýž dobropis dvakrát v dávce hlásí existující číslo', async () => {
		const credit = await document('dobropis', wholeCredit(invoice(), '20260002'));
		const copy = join(base, 'kopie.pdf');
		await copyFile(credit, copy);

		const report = await importInto([await document('faktura', invoice()), credit, copy]);

		expect(reasons(report)).toEqual(['faktura 20260002 už ve vaultu existuje']);
	});

	it('odkaz dobropisu na fakturu se porovná bez mezer kolem', () => {
		const targets: CreditTargets = new Map([
			[
				'20260001',
				{
					totalCents: 5_175_000,
					creditNote: undefined,
				},
			],
		]);
		const credit = {
			...wholeCredit(invoice(), '20260002'),
			originalInvoice: ' 20260001 ',
		};

		expect(() => checkCredit(targets, credit)).not.toThrow();
		addCredit(targets, credit);
		expect(targets.get('20260001')?.creditNote).toBe('20260002');
	});

	it('dobropis dobropisu nepřevezme', async () => {
		const first = wholeCredit(invoice(), '20260002');
		const second = {
			...wholeCredit(first, '20260003'),
			lines: first.lines,
		};
		const paths = [
			await document('faktura', invoice()),
			await document('prvni', first),
			await document('druhy', second),
		];

		const report = await importInto(paths);

		expect(reasons(report)).toEqual([
			'dobropis opravuje fakturu 20260002, která není ve vaultu ani v tomtéž importu',
		]);
	});

	it('částečný dobropis nepřevezme', async () => {
		await save(base, invoice());
		const credit = wholeCredit(invoice(), '20260002');
		const partial = await document('castecny', {
			...credit,
			lines: credit.lines.slice(0, 1),
		});

		const report = await importInto([partial]);

		expect(reasons(report)).toEqual([
			'dobropis vrací 48000.00 Kč, ale faktura 20260001 je na 51750.00 Kč; Fakturian vede jen dobropis na celou fakturu',
		]);
	});

	it('druhý dobropis k faktuře nepřevezme ve vaultu ani v dávce', async () => {
		const other = numbered('20260005');
		await save(base, invoice());
		await save(base, wholeCredit(invoice(), '20260002'));
		const paths = [
			await document('k-ulozene', wholeCredit(invoice(), '20260003')),
			await document('faktura', other),
			await document('prvni', wholeCredit(other, '20260006')),
			await document('druhy', wholeCredit(other, '20260007')),
		];

		const report = await importInto(paths);

		expect(reasons(report)).toEqual([
			'faktura 20260001 už má dobropis 20260002; Fakturian vede k faktuře jediný',
			'faktura 20260005 už má dobropis 20260006; Fakturian vede k faktuře jediný',
		]);
	});

	it('smazaný dobropis fakturu uvolní', async () => {
		await save(base, invoice());
		await save(base, wholeCredit(invoice(), '20260002'));
		await deleteInvoice(
			{
				vaultPath: base,
				number: '20260002',
			},
			rm,
		);

		const report = await importInto([await document('novy', wholeCredit(invoice(), '20260003'))]);

		expect(reasons(report)).toEqual([]);
		expect(report.imported.map(({ number }) => number)).toEqual(['20260003']);
	});

	it('dobropis bez faktury ve vaultu nic neblokuje', async () => {
		await save(base, {
			...wholeCredit(invoice(), '20260002'),
			originalInvoice: '20269999',
		});

		const report = await importInto([
			await document('faktura', invoice()),
			await document('dobropis', wholeCredit(invoice(), '20260003')),
		]);

		expect(reasons(report)).toEqual([]);
	});
});
