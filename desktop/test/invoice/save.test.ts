import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentKind } from '~/constants/invoice';
import { invoiceTotalCents } from '~/utils/invoice';

import { listInvoices } from '../../invoice/index.ts';
import { buildIsdoc, invoiceUuid } from '../../invoice/isdoc.ts';
import { loadInvoice, saveInvoice, writePdf } from '../../invoice/mod.ts';
import { invoiceArgument, type Invoice } from '../../invoice/model.ts';
import { qrPng } from '../../invoice/payment.ts';
import { snapshotDir } from '../../store.ts';
import { creditNote, customer, invoice, numbered, supplier } from '../invoices.ts';
import { pdfWithIsdoc, rewriteIsdoc } from '../pdfs.ts';
import { names } from '../support.ts';
import { imageCount } from '../typst.ts';

const UNSAFE_NUMBER = new Error(
	'Číslo dokladu může mít nejvýš 64 znaků: písmena bez diakritiky, číslice, mezery, tečky, pomlčky a podtržítka, a musí začínat i končit písmenem nebo číslicí.',
);
const OUR_ISSUER = '<IssuingSystem>Fakturian</IssuingSystem>';

let base = '';

beforeEach(async () => {
	base = await mkdtemp(join(tmpdir(), `fakturian-save-${process.pid}-`));
});

afterEach(async () => {
	await rm(base, { recursive: true });
});

function saveNew(document: unknown): Promise<string> {
	return saveInvoice({
		vaultPath: base,
		invoice: document,
		isNew: true,
	});
}

function saveEdit(document: unknown): Promise<string> {
	return saveInvoice({
		vaultPath: base,
		invoice: document,
		isNew: false,
	});
}

function load(number: string): Promise<Invoice> {
	return loadInvoice({
		vaultPath: base,
		number,
	});
}

async function listed(): Promise<[string, string, number][]> {
	const { items } = await listInvoices({ vaultPath: base });
	return items.map((item) => [item.number, item.customer, item.totalCents]);
}

// 3 h × 1 200 Kč + 1,5 MD × 8 000 Kč = 15 600 Kč.
function sample(): Invoice {
	return {
		...invoice(),
		supplier: {
			...supplier(),
			dic: 'CZ12345679',
			registration: 'Fyzická osoba zapsaná v živnostenském rejstříku',
		},
		customer: {
			...customer(),
			dic: '',
		},
		lines: [
			{
				description: 'Konzultace & analýza',
				quantity: 3,
				unit: 'hod',
				unitPriceCents: 120_000,
				itemId: '',
			},
			{
				description: 'Vývoj',
				quantity: 1.5,
				unit: 'MD',
				unitPriceCents: 800_000,
				itemId: '',
			},
		],
	};
}

// Doklad ležící ve `faktury/`, jak ho vystavil jiný software.
async function foreignDocument(number: string, change: (xml: string) => string): Promise<void> {
	const document = {
		...invoice(),
		number,
	};
	const uuid = invoiceUuid(document);
	const xml = buildIsdoc(document);
	await mkdir(join(base, 'faktury'), { recursive: true });
	await writeFile(
		join(base, 'faktury', `${number}.pdf`),
		await pdfWithIsdoc(change(xml.replace(uuid, '11111111-2222-3333-4444-555555555555'))),
	);
}

describe('doklad z webview', () => {
	it('nepovinná pole doplní prázdná a rok čerpání bez hodnoty vynechá', () => {
		expect(
			invoiceArgument({
				number: '20260001',
				issueDate: '2026-05-29',
				dueDate: '2026-06-12',
				supplier: {
					name: 'Jan Dodavatel',
				},
				customer: {
					name: 'Odběratel s.r.o.',
				},
				lines: [
					{
						description: 'Práce',
						quantity: 1,
						unit: 'ks',
						unitPriceCents: 100,
						usageYear: null,
					},
				],
			}),
		).toEqual({
			number: '20260001',
			uuid: '',
			documentType: DocumentKind.Invoice,
			originalInvoice: '',
			originalIssueDate: '',
			originalUuid: '',
			issueDate: '2026-05-29',
			dueDate: '2026-06-12',
			supplier: {
				name: 'Jan Dodavatel',
				ico: '',
				dic: '',
				address: {
					street: '',
					city: '',
					zip: '',
				},
				email: '',
				registration: '',
			},
			customer: {
				name: 'Odběratel s.r.o.',
				ico: '',
				dic: '',
				address: {
					street: '',
					city: '',
					zip: '',
				},
				email: '',
				registration: '',
			},
			vatNote: '',
			bankAccount: '',
			bankCode: '',
			iban: '',
			variableSymbol: '',
			note: '',
			lines: [
				{
					description: 'Práce',
					quantity: 1,
					unit: 'ks',
					unitPriceCents: 100,
					itemId: '',
				},
			],
		});
	});

	it('druh dokladu jde po drátě jako číslo z číselníku ISDOC', () => {
		expect(
			invoiceArgument({
				...invoice(),
				documentType: 2,
			}).documentType,
		).toBe(DocumentKind.CreditNote);
		expect(() =>
			invoiceArgument({
				...invoice(),
				documentType: 3,
			}),
		).toThrow(new Error('Doklad má neplatný tvar (documentType: Neznámý typ dokladu 3.).'));
	});

	it('data vystavení a splatnosti jsou povinná, původní smí být prázdné, a každé je RRRR-MM-DD', () => {
		expect(
			invoiceArgument({
				...invoice(),
				originalIssueDate: ' ',
			}).originalIssueDate,
		).toBe('');
		expect(
			invoiceArgument({
				...invoice(),
				originalIssueDate: '2026-05-01',
			}).originalIssueDate,
		).toBe('2026-05-01');
		for (const [field, value] of [
			['issueDate', ''],
			['issueDate', '2026-02-30'],
			['dueDate', ''],
			['dueDate', '12. 6. 2026'],
			['originalIssueDate', '2026-05-01+02:00'],
		] as const) {
			expect(() =>
				invoiceArgument({
					...invoice(),
					[field]: value,
				}),
			).toThrow(new Error(`Doklad má neplatný tvar (${field}: Datum musí být ve tvaru RRRR-MM-DD.).`));
		}
	});

	it('neúplný nebo cizí tvar dokladu odmítne i s polem, které vadí', () => {
		const [line] = invoice().lines;
		for (const [document, reason] of [
			[
				{
					...invoice(),
					number: undefined,
				},
				'number: Neplatný vstup: očekáváno řetězec, obdrženo undefined',
			],
			[
				{
					...invoice(),
					lines: [
						{
							...line,
							quantity: Number.NaN,
						},
					],
				},
				'lines.0.quantity: Neplatný vstup: očekáváno číslo, obdrženo NaN',
			],
			[
				{
					...invoice(),
					lines: [
						{
							...line,
							unitPriceCents: 1.5,
						},
					],
				},
				'lines.0.unitPriceCents: Neplatný vstup: očekáváno int, obdrženo číslo',
			],
			[
				{
					...invoice(),
					lines: [
						{
							...line,
							usageYear: 999,
						},
					],
				},
				'lines.0.usageYear: Hodnota je příliš malá: number musí být >=1000',
			],
			[
				{
					...invoice(),
					paid: true,
				},
				'Neznámé klíče: "paid"',
			],
		] as const) {
			expect(() => invoiceArgument(document)).toThrow(new Error(`Doklad má neplatný tvar (${reason}).`));
		}
	});

	it('neplatný tvar se ohlásí dřív, než uložení sáhne na disk', async () => {
		await expect(
			saveNew({
				...invoice(),
				documentType: 7,
			}),
		).rejects.toThrow(new Error('Doklad má neplatný tvar (documentType: Neznámý typ dokladu 7.).'));
		expect(await names(base)).toEqual([]);
	});
});

describe('uložení a načtení', () => {
	it('uložený doklad se načte zpátky se zhmotněným UUID', async () => {
		const path = await saveNew(sample());

		expect(path).toBe(join(base, 'faktury', '20260001.pdf'));
		expect(await load('20260001')).toEqual({
			...sample(),
			uuid: '3588469d-1bc3-524a-99f2-56991fb58e01',
		});
		expect(invoiceTotalCents(sample())).toBe(1_560_000);
	});

	it('nový doklad pod obsazeným číslem se neuloží, editace ano', async () => {
		await saveNew(sample());

		await expect(saveNew(sample())).rejects.toThrow(new Error('Faktura 20260001 už existuje. Zvol jiné číslo.'));
		expect(await saveEdit(sample())).toBe(join(base, 'faktury', '20260001.pdf'));
	});

	it('načítá se číslo dokladu ve vaultu, ne cesta', async () => {
		const path = await saveNew(sample());

		await expect(load('20269999')).rejects.toThrow(new Error('Doklad 20269999 ve složce faktury/ není.'));
		await expect(load(path)).rejects.toThrow(new Error(`Doklad ${path} ve složce faktury/ není.`));
		await expect(
			loadInvoice({
				vaultPath: '/nikde',
				number: '20260001',
			}),
		).rejects.toThrow(new Error('Datová složka /nikde neexistuje.'));
	});

	it('doklad, který není PDF, se nenačte a hláška řekne, co s tím', async () => {
		await mkdir(join(base, 'faktury'));
		await writeFile(join(base, 'faktury', '20260001.pdf'), 'tohle PDF neni');

		await expect(load('20260001')).rejects.toThrow(
			new Error('Doklad 20260001 nejde přečíst. Oprav nebo obnov PDF ze zálohy.', {
				cause: expect.objectContaining({
					message: 'Failed to parse PDF document (line:0 col:28 offset=14): No PDF header found',
				}),
			}),
		);
	});

	it('číslo, které je cesta, odmítne dřív, než sáhne na disk', async () => {
		const vault = join(base, 'neni');

		await expect(
			saveInvoice({
				vaultPath: vault,
				invoice: {
					...invoice(),
					number: '../cizi',
				},
				isNew: true,
			}),
		).rejects.toThrow(UNSAFE_NUMBER);
		expect(await names(base)).toEqual([]);
	});

	it('doklad bez položek se neuloží', async () => {
		await expect(
			saveNew({
				...invoice(),
				lines: [],
			}),
		).rejects.toThrow(new Error('Doklad nejde uložit (Přidej aspoň jednu položku.).'));
		expect(await names(base)).toEqual([]);
	});

	it('splatnost před vystavením se neuloží, ve stejný den ano', async () => {
		await expect(
			saveNew({
				...invoice(),
				dueDate: '2026-05-28',
			}),
		).rejects.toThrow(new Error('Doklad nejde uložit (Splatnost před vystavením.).'));
		expect(await names(base)).toEqual([]);

		await saveNew({
			...invoice(),
			dueDate: '2026-05-29',
		});
		expect(await listed()).toEqual([['20260001', 'Odběratel s.r.o.', 5_175_000]]);
	});

	it('faktura se záporným součtem ani dobropis s kladným se neuloží, nulové ano', async () => {
		const line = invoice().lines[0];
		await expect(
			saveNew({
				...invoice(),
				lines: [
					{
						...line,
						quantity: 1,
						unitPriceCents: -1,
					},
				],
			}),
		).rejects.toThrow(new Error('Doklad nejde uložit (Součet faktury nesmí být záporný.).'));
		await expect(
			saveNew({
				...creditNote(),
				lines: [
					{
						...line,
						quantity: 1,
						unitPriceCents: 1,
					},
				],
			}),
		).rejects.toThrow(new Error('Doklad nejde uložit (Součet dobropisu nesmí být kladný.).'));
		expect(await names(base)).toEqual([]);

		await saveNew({
			...invoice(),
			lines: [
				{
					...line,
					unitPriceCents: 0,
				},
			],
		});
		await saveNew({
			...creditNote(),
			lines: [
				{
					...line,
					unitPriceCents: 0,
				},
			],
		});
		expect(await listed()).toEqual([
			['20260002', 'Odběratel s.r.o.', 0],
			['20260001', 'Odběratel s.r.o.', 0],
		]);
	});

	it('dobropis bez odkazu na fakturu se neuloží', async () => {
		await expect(
			saveNew({
				...creditNote(),
				originalInvoice: ' ',
			}),
		).rejects.toThrow(new Error('Dobropis musí odkazovat na fakturu, kterou opravuje.'));
		expect(await names(base)).toEqual([]);
	});

	it('neplatné údaje odběratele se neuloží a hláška vyjmenuje první tři', async () => {
		await expect(
			saveNew({
				...invoice(),
				customer: {
					...customer(),
					ico: '87654321',
					dic: 'xx',
					address: {
						street: 'Odběratelská 2',
						city: 'Brno',
						zip: '12',
					},
					email: 'kdosi',
				},
			}),
		).rejects.toThrow(
			new Error(
				'Doklad nejde uložit (Neplatné IČO odběratele., Neplatné DIČ odběratele. a Neplatné PSČ odběratele.).',
			),
		);
		expect(await names(base)).toEqual([]);
	});

	it('neúplný odběratel se neuloží a hláška vyjmenuje, co chybí', async () => {
		await expect(
			saveNew({
				...invoice(),
				customer: {
					name: 'Petra Nováková',
					ico: ' ',
					address: {
						street: '',
						city: 'Olomouc',
						zip: '',
					},
				},
			}),
		).rejects.toThrow(
			new Error('Doklad nejde uložit (Odběrateli chybí IČO, ulice a PSČ — doplň je přes „Upravit".).'),
		);
		await expect(
			saveNew({
				...invoice(),
				customer: {
					...customer(),
					name: ' ',
				},
			}),
		).rejects.toThrow(new Error('Doklad nejde uložit (Vyber nebo zadej odběratele.).'));
		expect(await names(base)).toEqual([]);
	});

	it('odběratel bez DIČ a e-mailu se uloží', async () => {
		await saveNew({
			...invoice(),
			customer: {
				...customer(),
				dic: '',
				email: '',
			},
		});

		const { customer: back } = await load('20260001');

		expect([back.ico, back.dic, back.email]).toEqual(['87654326', '', '']);
	});

	it('složka jménem dokladu číslo nezabere, ale zápis nového dokladu na její místo selže', async () => {
		await mkdir(join(base, 'faktury', '20260001.pdf'), { recursive: true });

		await expect(saveNew(invoice())).rejects.toThrow(new Error('Faktura 20260001 už existuje. Zvol jiné číslo.'));
	});

	it('do složky faktury/ bez práva zápisu se nový doklad nezapíše', async () => {
		const invoices = join(base, 'faktury');
		await mkdir(invoices);
		await chmod(invoices, 0o500);

		try {
			await expect(saveNew(invoice())).rejects.toThrow(
				new Error(`Zápis selhal: EACCES: permission denied, open '${join(invoices, '20260001.pdf')}'`),
			);
		} finally {
			await chmod(invoices, 0o700);
		}
		expect(await names(invoices)).toEqual([]);
	});

	it('faktury/, kterou nejde založit, se ohlásí se svou cestou', async () => {
		await chmod(base, 0o500);

		try {
			// Chyba souborového systému jde dál, jak ji Node vydá; na text ji převede až `errorText()`.
			await expect(saveNew(invoice())).rejects.toThrow(
				`EACCES: permission denied, mkdir '${join(base, 'faktury')}'`,
			);
		} finally {
			await chmod(base, 0o700);
		}
	});
});

describe('kolize čísel', () => {
	it('editace dokladu, který na disku není, selže', async () => {
		await expect(saveEdit(numbered('20260009', 'Alfa', 10_000))).rejects.toThrow(
			new Error(
				'Doklad 20260009 ve složce faktury/ není — smazal ho někdo mimo appku, nebo je odpojený disk? Ulož ho jako nový doklad.',
			),
		);
		expect(await listed()).toEqual([]);
	});

	it('editace pod číslem jiného vlastního dokladu nic nepřepíše', async () => {
		await saveNew(numbered('20260001', 'Alfa', 10_000));
		await saveNew(numbered('20260002', 'Beta', 25_000));
		const overwrite = {
			...numbered('20260002', 'Alfa', 10_000),
			uuid: invoiceUuid(numbered('20260001', 'Alfa', 10_000)),
		};

		await expect(saveEdit(overwrite)).rejects.toThrow(
			new Error(
				'Pod číslem 20260002 už je jiný doklad (vystaven 2026-05-29 pro Beta). Editace ho přepsat nesmí — vrať původní číslo, nebo zvol volné.',
			),
		);
		expect(await listed()).toEqual([
			['20260002', 'Beta', 50_000],
			['20260001', 'Alfa', 20_000],
		]);
	});

	it('opakované uložení téhož dokladu projde', async () => {
		await saveNew(numbered('20260001', 'Alfa', 10_000));

		const path = await saveEdit(numbered('20260001', 'Alfa', 50_000));

		expect(path).toBe(join(base, 'faktury', '20260001.pdf'));
		expect(await listed()).toEqual([['20260001', 'Alfa', 100_000]]);
	});

	it('číslo iCloud zástupce se znovu nevydá', async () => {
		await mkdir(join(base, 'faktury'));
		await writeFile(join(base, 'faktury', '.20260001.pdf.icloud'), new Uint8Array());

		await expect(saveNew(numbered('20260001', 'Alfa', 10_000))).rejects.toThrow(
			new Error('Faktura 20260001 už existuje. Zvol jiné číslo.'),
		);
		expect(await names(join(base, 'faktury'))).toEqual(['.20260001.pdf.icloud']);
	});

	it('číslo lišící se jen velikostí písmen je obsazené', async () => {
		await saveNew(numbered('F2026-1', 'Alfa', 10_000));

		await expect(saveNew(numbered('f2026-1', 'Beta', 25_000))).rejects.toThrow(
			new Error('Faktura f2026-1 už existuje. Zvol jiné číslo.'),
		);
		expect(await listed()).toEqual([['F2026-1', 'Alfa', 20_000]]);
	});

	it('ze šesti souběžných uložení téhož čísla projde právě jedno', async () => {
		const customers = ['Alfa', 'Beta', 'Gama', 'Delta', 'Epsilon', 'Zeta'];

		const results = await Promise.allSettled(customers.map((name) => saveNew(numbered('20260001', name, 10_000))));

		expect(results.filter(({ status }) => status === 'fulfilled').length).toBe(1);
		expect(results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []))).toEqual(
			Array.from({ length: 5 }, () => new Error('Faktura 20260001 už existuje. Zvol jiné číslo.')),
		);
		const { items, broken } = await listInvoices({ vaultPath: base });
		expect([items.length, broken]).toEqual([1, []]);
	});

	it('editace se zastaví, dokud leží vedle dokladu konfliktní kopie', async () => {
		const canonical = await saveNew(numbered('20260001', 'Alfa', 10_000));
		await copyFile(canonical, join(base, 'faktury', '20260001 2.pdf'));

		await expect(saveEdit(numbered('20260001', 'Alfa', 50_000))).rejects.toThrow(
			new Error('Číslo dokladu 20260001 je ve složce faktury/ víckrát. Nejdřív rozhodni konflikt ve Finderu.'),
		);
		const { items, broken } = await listInvoices({ vaultPath: base });
		expect([items, broken.map(({ fileName }) => fileName)]).toEqual([[], ['20260001 2.pdf', '20260001.pdf']]);
	});

	it('doklad s příponou .PDF se upraví na místě', async () => {
		const saved = await saveNew(numbered('20260001', 'Alfa', 10_000));
		const upper = join(base, 'faktury', '20260001.PDF');
		await rename(saved, upper);
		expect(await listed()).toEqual([['20260001', 'Alfa', 20_000]]);

		await expect(saveNew(numbered('20260001', 'Alfa', 10_000))).rejects.toThrow(
			new Error('Faktura 20260001 už existuje. Zvol jiné číslo.'),
		);
		const path = await saveEdit(numbered('20260001', 'Alfa', 50_000));

		expect(path).toBe(upper);
		expect(await names(join(base, 'faktury'))).toEqual(['20260001.PDF']);
		expect(await listed()).toEqual([['20260001', 'Alfa', 100_000]]);
	});
});

describe('cizí a poškozené doklady', () => {
	it('cizí doklad se přepsat nedá a hláška řekne, kdo ho vystavil a co dělat', async () => {
		await foreignDocument('F2025-900', (xml) =>
			xml.replace(OUR_ISSUER, '<IssuingSystem>Fakturoid</IssuingSystem>'),
		);

		await expect(
			saveEdit({
				...invoice(),
				number: 'F2025-900',
			}),
		).rejects.toThrow(
			new Error(
				'Fakturu F2025-900 vystavil Fakturoid, ne Fakturian — přepsat archivovaný doklad nejde. Ulož ji jako nový doklad s vlastním číslem.',
			),
		);
	});

	it('vystavitele bez jména nebo z mezer nazve jiným softwarem a jméno ořízne', async () => {
		for (const [issuer, who] of [
			['', 'jiný software'],
			['<IssuingSystem>  </IssuingSystem>', 'jiný software'],
			['<IssuingSystem>  Cizí systém  </IssuingSystem>', 'Cizí systém'],
		] as const) {
			await foreignDocument('F2025-905', (xml) => xml.replace(OUR_ISSUER, issuer));

			await expect(
				saveEdit({
					...invoice(),
					number: 'F2025-905',
				}),
			).rejects.toThrow(
				new Error(
					`Fakturu F2025-905 vystavil ${who}, ne Fakturian — přepsat archivovaný doklad nejde. Ulož ji jako nový doklad s vlastním číslem.`,
				),
			);
		}
	});

	it('doklad bez IssuingSystem je cizí, i když nese UUID odvozené z čísla', async () => {
		const document = {
			...invoice(),
			number: 'F2025-902',
		};
		const path = await saveNew(document);
		await rewriteIsdoc(path, (xml) => xml.replace(OUR_ISSUER, ''));

		await expect(saveEdit(document)).rejects.toThrow(
			new Error(
				'Fakturu F2025-902 vystavil jiný software, ne Fakturian — přepsat archivovaný doklad nejde. Ulož ji jako nový doklad s vlastním číslem.',
			),
		);
	});

	it('nečitelný soubor se nepřepíše', async () => {
		const target = join(base, 'faktury', 'F2025-903.pdf');
		await mkdir(join(base, 'faktury'));
		await writeFile(target, 'tohle PDF neni');

		await expect(
			saveEdit({
				...invoice(),
				number: 'F2025-903',
			}),
		).rejects.toThrow(
			new Error(
				'Doklad F2025-903 nejde přečíst, takže ho nelze bezpečně přepsat. Oprav nebo obnov PDF ze zálohy.',
				{
					cause: expect.objectContaining({
						message: 'Failed to parse PDF document (line:0 col:28 offset=14): No PDF header found',
					}),
				},
			),
		);
		expect(await readFile(target, 'utf8')).toBe('tohle PDF neni');
	});

	it('editace pod číslem jiného vlastního dokladu ho nepřepíše', async () => {
		await saveNew({
			...invoice(),
			number: 'F2025-910',
			customer: {
				...customer(),
				name: 'PRVNÍ',
			},
		});
		await saveNew({
			...invoice(),
			number: 'F2025-911',
			customer: {
				...customer(),
				name: 'DRUHÁ',
			},
		});
		const edited = await load('F2025-911');

		await expect(
			saveEdit({
				...edited,
				number: 'F2025-910',
			}),
		).rejects.toThrow(
			new Error(
				'Pod číslem F2025-910 už je jiný doklad (vystaven 2026-05-29 pro PRVNÍ). Editace ho přepsat nesmí — vrať původní číslo, nebo zvol volné.',
			),
		);
		const preserved = await load('F2025-910');
		expect(preserved.customer.name).toBe('PRVNÍ');
	});

	it('editace téhož dokladu projde', async () => {
		await saveNew({
			...invoice(),
			number: 'F2025-912',
		});
		const edited = await load('F2025-912');

		await saveEdit({
			...edited,
			customer: {
				...edited.customer,
				name: 'PŘEJMENOVANÝ ODBĚRATEL',
			},
		});

		const again = await load('F2025-912');
		expect(again.customer.name).toBe('PŘEJMENOVANÝ ODBĚRATEL');
	});
});

describe('zápis PDF', () => {
	it('po uložení nezůstane ve faktury/ dočasný soubor', async () => {
		await saveNew(invoice());
		await saveEdit(invoice());

		expect(await names(join(base, 'faktury'))).toEqual(['20260001.pdf']);
	});

	it('přepsání dokladu zálohuje původní bajty, první uložení ne', async () => {
		const path = await saveNew(invoice());
		const original = await readFile(path);
		const snapshots = join(snapshotDir(base), 'faktury');
		expect(await names(base)).toEqual(['faktury']);

		const [first, second] = invoice().lines;
		await saveEdit({
			...invoice(),
			lines: [
				{
					...first!,
					unitPriceCents: 424_200,
				},
				second!,
			],
		});

		const backups = await names(snapshots);
		const [backup = ''] = backups;
		expect(backups.map((name) => name.replace(/\d{4}-\d{2}-\d{2}/, 'datum'))).toEqual(['20260001.datum.pdf']);
		expect(await readFile(join(snapshots, backup))).toEqual(original);
		expect(await readFile(path)).not.toEqual(original);
	});

	it('zálohy dokladu z jednoho týdne drží originál z doby před první úpravou', async () => {
		// Podvržené je jen datum: kontrolu ISDOC ve workeru hlídají skutečné časovače.
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime('2026-09-14T12:00');
		try {
			const path = await saveNew(invoice());
			const original = await readFile(path);
			for (const cents of [100_001, 100_002, 100_003]) {
				const [first, second] = invoice().lines;
				await saveEdit({
					...invoice(),
					lines: [
						{
							...first!,
							unitPriceCents: cents,
						},
						second!,
					],
				});
			}

			const snapshots = join(snapshotDir(base), 'faktury');
			expect(await names(snapshots)).toEqual(['20260001.2026-09-14.pdf']);
			expect(await readFile(join(snapshots, '20260001.2026-09-14.pdf'))).toEqual(original);
		} finally {
			vi.useRealTimers();
		}
	});

	it('nečitelný doklad se přepíše bez zálohy', async () => {
		const path = join(base, 'faktury', '20260001.pdf');
		await mkdir(join(base, 'faktury'));
		await writeFile(path, 'nečitelné');
		await chmod(path, 0o000);

		await writePdf(base, path, '20260001', new TextEncoder().encode('nové'));

		expect(await readFile(path, 'utf8')).toBe('nové');
		expect(await names(base)).toEqual(['faktury']);
	});
});

describe('vykreslení a logo', () => {
	it('dobropis se načte zpátky jako dobropis', async () => {
		await saveNew(creditNote());

		const back = await load('20260002');
		expect([back.documentType, back.originalInvoice, invoiceTotalCents(back)]).toEqual([
			DocumentKind.CreditNote,
			'20260001',
			-600_000,
		]);
	});

	it('holý doklad bez IBAN, poznámky, DIČ a e-mailu se načte s prázdnými poli', async () => {
		await saveNew({
			...invoice(),
			iban: '',
			note: '',
			supplier: {
				...supplier(),
				dic: '',
				email: '',
			},
			customer: {
				...customer(),
				dic: '',
			},
		});

		const back = await load('20260001');
		expect([back.iban, back.note, back.supplier.dic, back.customer.dic, back.supplier.email]).toEqual([
			'',
			'',
			'',
			'',
			'',
		]);
	});

	it('logo z vaultu přidá do dokladu právě jeden obrázek', async () => {
		const plain = await saveNew(invoice());
		await writeFile(join(base, 'logo.png'), qrPng('logo'));
		const branded = await saveNew({
			...invoice(),
			number: '20260002',
		});

		expect([imageCount(await readFile(plain)), imageCount(await readFile(branded))]).toEqual([1, 2]);
	});

	it('vadné logo vystavení nezablokuje a do dokladu se nedostane', async () => {
		for (const [number, content] of [
			['20260001', 'tohle rozhodne neni PNG'],
			['20260002', ''],
		] as const) {
			await writeFile(join(base, 'logo.png'), content);

			const path = await saveNew({
				...invoice(),
				number,
			});

			expect(imageCount(await readFile(path))).toBe(1);
		}
	});
});
