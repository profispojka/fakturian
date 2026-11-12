import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DocumentKind } from '~/constants/invoice';

import { customer, invoice, MINIMAL_ISDOC, supplier } from './invoices.ts';
import { fixture } from './isdoc.ts';
import { invoicePdf, pdfWithIsdoc, samplePdf } from './pdfs.ts';
import { thrownBy } from './support.ts';

import { alreadyThere, checkSource, isCreditNote, normIco, readSource, sourceFromPdf, type Source } from '../import.ts';
import { setSent, toXml } from '../isdoc/mod.ts';
import { loadPdf, readIsdoc, replaceIsdoc } from '../pdf.ts';

import type { Invoice } from '../invoice/model.ts';

async function source(xml: string): Promise<Source> {
	const pdf = await loadPdf(await pdfWithIsdoc(xml));
	return sourceFromPdf(pdf);
}

// Doklad, který kontrolou projde: faktura s jediným řádkem a sedící částkou k úhradě.
function importable(changes: Partial<Invoice> = {}, payableCents = 100): Source {
	return {
		invoice: {
			...invoice(),
			lines: [
				{
					description: 'Práce',
					quantity: 1,
					unit: 'ks',
					unitPriceCents: 100,
					itemId: '',
				},
			],
			...changes,
		},
		payableCents,
		foreignCurrency: undefined,
		vatPayer: false,
		sentAt: undefined,
	};
}

function refusal(checked: Source, ourIco = ''): unknown {
	return thrownBy(() => checkSource(checked, ourIco));
}

describe('doklad z PDF', () => {
	it('vlastní doklad přečte i s částkou k úhradě', async () => {
		const pdf = await loadPdf(invoicePdf(invoice()));

		const read = await sourceFromPdf(pdf);

		expect([read.invoice.number, read.payableCents, read.foreignCurrency, read.sentAt]).toEqual([
			'20260001',
			5_175_000,
			undefined,
			undefined,
		]);
	});

	it('čas odeslání přečte z dokladu', async () => {
		const pdf = await loadPdf(invoicePdf(invoice()));
		const { document } = await readIsdoc(pdf);
		setSent(document, '2026-05-29T10:15:00Z', 'Jan Dodavatel');
		await replaceIsdoc(pdf, toXml(document));

		const read = await sourceFromPdf(pdf);

		expect(read.sentAt).toBe('2026-05-29T10:15:00Z');
	});

	it('cizí měnu vezme z ForeignCurrencyCode, koruny ne', async () => {
		const foreign = await source(await fixture('example1.isdoc'));
		const crowns = await source(
			MINIMAL_ISDOC.replace(
				'<LocalCurrencyCode>CZK</LocalCurrencyCode>',
				'<LocalCurrencyCode>CZK</LocalCurrencyCode><ForeignCurrencyCode>CZK</ForeignCurrencyCode>',
			),
		);

		expect([foreign.foreignCurrency, crowns.foreignCurrency]).toEqual(['EUR', undefined]);
	});

	it('plátce DPH pozná podle VATApplicable v hlavičce', async () => {
		const payer = await source(
			MINIMAL_ISDOC.replace('<VATApplicable>false</VATApplicable>\n', '<VATApplicable> true </VATApplicable>\n'),
		);
		const exempt = await source(MINIMAL_ISDOC);

		expect([payer.vatPayer, exempt.vatPayer]).toEqual([true, false]);
	});

	it('částku k úhradě nad strop odmítne', async () => {
		await expect(
			source(
				MINIMAL_ISDOC.replace(
					'<PayableAmount>1000.00</PayableAmount>',
					'<PayableAmount>90000000000.01</PayableAmount>',
				),
			),
		).rejects.toThrow(
			new Error('částka k úhradě v <PayableAmount>: částka „90000000000.01“ přesahuje strop 90 miliard Kč', {
				cause: new Error('částka „90000000000.01“ přesahuje strop 90 miliard Kč'),
			}),
		);
	});

	it('PDF bez ISDOC řekne proč', async () => {
		await expect(sourceFromPdf(await samplePdf())).rejects.toThrow(new Error('PDF neobsahuje přílohu ISDOC'));
	});
});

describe('doklad ze souboru', () => {
	let dir = '';

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'fakturian-source-'));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true });
	});

	async function written(name: string, content: string | Uint8Array): Promise<string> {
		const path = join(dir, name);
		await writeFile(path, typeof content === 'string' ? new TextEncoder().encode(content) : content);
		return path;
	}

	it('PDF s ISDOC přečte bez ohledu na příponu', async () => {
		const path = await written('export.dat', invoicePdf(invoice()));

		const read = await readSource(path);

		expect([read.invoice.number, read.payableCents]).toEqual(['20260001', 5_175_000]);
	});

	it('holé XML ani jiný soubor nejsou PDF s ISDOC', async () => {
		const bare = await written('export.isdoc', MINIMAL_ISDOC);
		const zip = await written('faktura.pdf', 'PK\u0003\u0004 tohle je zip');

		for (const path of [bare, zip]) {
			await expect(readSource(path)).rejects.toEqual(
				new Error('soubor není PDF s vloženým ISDOC', { cause: expect.any(Error) }),
			);
		}
	});

	it('poškozené PDF i nečitelný soubor řeknou proč', async () => {
		const broken = await written('rozbite.pdf', '%PDF-x');
		const missing = join(dir, 'chybi.pdf');

		await expect(readSource(broken)).rejects.toEqual(
			new Error('PDF je poškozené: Failed to parse number (line:0 col:5 offset=5): ""', {
				cause: expect.any(Error),
			}),
		);
		await expect(readSource(missing)).rejects.toEqual(
			new Error(`nejde přečíst: ENOENT: no such file or directory, open '${missing}'`, {
				cause: expect.objectContaining({ code: 'ENOENT' }),
			}),
		);
	});
});

describe('co odmítne už XSD', () => {
	it('doklad bez řádků ani s UUID mimo tvar ze schématu se nepřečte', async () => {
		const withoutLines = MINIMAL_ISDOC.replace(
			/<InvoiceLines>[\s\S]*<\/InvoiceLines>/,
			'<InvoiceLines></InvoiceLines>',
		);
		const braced = MINIMAL_ISDOC.replace(
			'<UUID>00000000-0000-0000-0000-000000000001</UUID>',
			'<UUID>{00000000-0000-0000-0000-000000000001}</UUID>',
		);

		await expect(source(withoutLines)).rejects.toThrow(
			new Error(
				'PDF má vadnou přílohu ISDOC — ISDOC nejde přečíst: řádek 39: prvek InvoiceLines neodpovídá standardu ISDOC',
			),
		);
		await expect(source(braced)).rejects.toThrow(
			new Error(
				'PDF má vadnou přílohu ISDOC — ISDOC nejde přečíst: řádek 5: prvek UUID neodpovídá standardu ISDOC',
			),
		);
	});
});

describe('kontrola vydaného dokladu', () => {
	it('číslo, které je cesta, neprojde', () => {
		expect(refusal(importable({ number: '../cizi' }))).toEqual(
			new Error(
				'Číslo dokladu může mít nejvýš 64 znaků: písmena bez diakritiky, číslice, mezery, tečky, pomlčky a podtržítka, a musí začínat i končit písmenem nebo číslicí.',
			),
		);
	});

	it('datum, které by frontend odmítl, neprojde', () => {
		expect(
			refusal(
				importable({
					dueDate: ' ',
					originalIssueDate: '2026-05-01+02:00',
				}),
			),
		).toBe(undefined);
		expect(refusal(importable({ issueDate: '2026-02-30' }))).toEqual(
			new Error('doklad má neplatné datum vystavení „2026-02-30“ (čekám RRRR-MM-DD)'),
		);
		expect(refusal(importable({ issueDate: '' }))).toEqual(
			new Error('doklad má neplatné datum vystavení „“ (čekám RRRR-MM-DD)'),
		);
		expect(refusal(importable({ dueDate: '15.5.2026' }))).toEqual(
			new Error('doklad má neplatné datum splatnosti „15.5.2026“ (čekám RRRR-MM-DD)'),
		);
		expect(refusal(importable({ originalIssueDate: '0999-12-31' }))).toEqual(
			new Error('doklad má neplatné datum původního dokladu „0999-12-31“ (čekám RRRR-MM-DD)'),
		);
	});

	it('doklad jiného dodavatele neprojde, i když neuvádí IČO', () => {
		const ours = '12345679';

		expect(
			refusal(
				importable({
					supplier: {
						...supplier(),
						ico: ' 012345679 ',
					},
				}),
				ours,
			),
		).toBe(undefined);
		expect(
			refusal(
				importable({
					supplier: {
						...supplier(),
						name: 'Cizí s.r.o.',
						ico: '87654326',
					},
				}),
				ours,
			),
		).toEqual(new Error('doklad vystavil Cizí s.r.o. (IČO 87654326), ne ty — přijaté doklady patří do Výdajů'));
		expect(
			refusal(
				importable({
					supplier: {
						...supplier(),
						name: ' ',
						ico: ' ',
					},
				}),
				ours,
			),
		).toEqual(
			new Error(
				'doklad neuvádí IČO dodavatele (neznámý dodavatel), takže nejde poznat, že je tvůj — přijaté doklady patří do Výdajů',
			),
		);
		expect(refusal(importable({ supplier: supplier() }), '')).toBe(undefined);
	});

	it('doklad plátce DPH ani v cizí měně neprojde', () => {
		expect(
			refusal({
				...importable(),
				vatPayer: true,
			}),
		).toEqual(new Error('doklad je od plátce DPH; Fakturian umí jen neplátce'));
		expect(
			refusal({
				...importable(),
				foreignCurrency: 'EUR',
			}),
		).toEqual(new Error('doklad je vystavený v cizí měně EUR; Fakturian vede jen koruny'));
	});

	it('doklad bez odběratele neprojde', () => {
		expect(
			refusal(
				importable({
					customer: {
						...customer(),
						name: ' ',
					},
				}),
			),
		).toEqual(new Error('doklad neuvádí odběratele — anonymní doklad do vydaných faktur nepatří'));
	});

	it('součty mají stejná znaménka jako ve formuláři', () => {
		function signed(documentType: DocumentKind, cents: number, originalInvoice: string): Source {
			return importable(
				{
					documentType,
					originalInvoice,
					lines: [
						{
							description: 'Práce',
							quantity: 1,
							unit: 'ks',
							unitPriceCents: cents,
							itemId: '',
						},
					],
				},
				cents,
			);
		}

		expect(refusal(signed(DocumentKind.Invoice, 100, ''))).toBe(undefined);
		expect(refusal(signed(DocumentKind.Invoice, 0, ''))).toBe(undefined);
		expect(refusal(signed(DocumentKind.CreditNote, 0, '20260001'))).toBe(undefined);
		expect(refusal(signed(DocumentKind.Invoice, -100, ''))).toEqual(
			new Error('faktura má záporný součet -1.00 Kč — vratka patří na dobropis'),
		);
		expect(refusal(signed(DocumentKind.CreditNote, -100, '20260001'))).toBe(undefined);
		expect(refusal(signed(DocumentKind.CreditNote, 100, '20260001'))).toEqual(
			new Error('dobropis má kladný součet 1.00 Kč'),
		);
		expect(refusal(signed(DocumentKind.CreditNote, -100, ' '))).toEqual(
			new Error('dobropis neuvádí fakturu, kterou opravuje'),
		);
	});

	it('částka k úhradě musí sedět se součtem řádků', () => {
		expect(refusal(importable({}, 30_000))).toEqual(
			new Error(
				'doklad hlásí k úhradě 300.00 Kč, ale ze řádků vychází 1.00 — nejspíš obsahuje zálohy nebo odpočty, které appka neumí',
			),
		);
	});

	it('vlastní vysázený doklad projde', async () => {
		const pdf = await loadPdf(invoicePdf(invoice()));
		const read = await sourceFromPdf(pdf);

		expect(refusal(read, '12345679')).toBe(undefined);
	});
});

describe('druh a stav dokladu', () => {
	it('IČO bez mezer a úvodních nul, nuly uvnitř zůstanou', () => {
		expect(normIco(' 001 234 567 ')).toBe('1234567');
		expect(normIco('10 203 040')).toBe('10203040');
	});

	it('hláška o existujícím dokladu jmenuje jeho číslo', () => {
		expect(alreadyThere('F2025-840')).toBe('faktura F2025-840 už ve vaultu existuje');
	});

	it('dobropis pozná podle druhu dokladu', () => {
		expect(isCreditNote(importable())).toBe(false);
		expect(isCreditNote(importable({ documentType: DocumentKind.CreditNote }))).toBe(true);
	});
});
