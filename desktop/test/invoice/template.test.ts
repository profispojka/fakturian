import { describe, expect, it } from 'vitest';

import { DocumentKind, NON_VAT_PAYER_NOTE } from '~/constants/invoice';
import moneyParity from '~/utils/fixtures/money-parity.json' with { type: 'json' };
import { z } from '~/utils/zod';

import { qrPng } from '../../invoice/payment.ts';
import { czDate, czkCents, invoiceData, invoiceTypst } from '../../invoice/template.ts';
import { compileTypst, renderTypstPdf, renderTypstSvg } from '../../pdf.ts';
import printed from '../fixtures/printed-text.json' with { type: 'json' };
import { creditNote, customer, invoice, sampleInvoice, samples, supplier } from '../invoices.ts';
import { imageCount, invoiceFiles, printedText } from '../typst.ts';

import type { Invoice } from '../../invoice/model.ts';

const PRINTED = z
	.object({
		invoice: z.array(z.string()),
		creditNote: z.array(z.string()),
	})
	.parse(printed);

function printedOn(document: Invoice): string[] {
	return printedText(compileTypst(invoiceTypst(), invoiceFiles(document)));
}

function longInvoice(): Invoice {
	const [line] = invoice().lines;
	return {
		...invoice(),
		lines: Array.from({ length: 80 }, () => line!),
	};
}

describe('částka na dokladu', () => {
	it('se vypíše stejně jako ve formuláři', () => {
		const { formats } = z.object({ formats: z.array(z.tuple([z.number(), z.string()])) }).parse(moneyParity);

		expect(formats.length).toBeGreaterThan(0);
		expect(formats.map(([cents]) => czkCents(cents))).toEqual(formats.map(([, text]) => text));
	});

	it('záporná nula se vypíše bez mínusu', () => {
		expect(czkCents(-0)).toBe('0,00');
	});
});

describe('datum na dokladu', () => {
	it('ISO datum přepíše do češtiny', () => {
		expect(czDate('2026-08-21')).toBe('21. 8. 2026');
		expect(czDate(' 2026-01-01 ')).toBe('1. 1. 2026');
	});

	it('co nejde rozebrat, projde beze změny', () => {
		expect(czDate('21.8.2026')).toBe('21.8.2026');
		expect(czDate('')).toBe('');
		expect(czDate('2026-13-01')).toBe('2026-13-01');
		expect(czDate(' 2026-08-21T10:00:00 ')).toBe('2026-08-21T10:00:00');
	});
});

describe('data pro šablonu', () => {
	it('fakturu vypíší naformátovanou tak, jak ji ukazuje obrazovka', () => {
		expect(invoiceData(invoice(), true, false)).toEqual({
			title: 'Faktura',
			kind: 'invoice',
			due_label: 'K úhradě',
			number: '20260001',
			original_invoice: '',
			issue_date: '29. 5. 2026',
			due_date: '12. 6. 2026',
			variable_symbol: '20260001',
			bank_account: '2000145399/0800',
			iban: 'CZ6508000000192000145399',
			currency: 'Kč',
			total: '51 750,00',
			due_total: '51 750,00',
			note: 'Děkujeme za spolupráci.',
			vat_note: NON_VAT_PAYER_NOTE,
			supplier: supplier(),
			customer: customer(),
			lines: [
				{
					description: 'Programátorské práce',
					quantity: '40',
					unit: 'hod',
					unit_price: '1 200,00',
					total: '48 000,00',
				},
				{
					description: 'Konzultace',
					quantity: '2,5',
					unit: 'hod',
					unit_price: '1 500,00',
					total: '3 750,00',
				},
			],
			has_logo: false,
			has_qr: true,
			web: 'fakturian.app',
		});
	});

	it('dobropis vrací kladnou částku k vrácení', () => {
		expect(invoiceData(creditNote(), false, true)).toEqual({
			title: 'Dobropis',
			kind: 'credit-note',
			due_label: 'K vrácení',
			number: '20260002',
			original_invoice: '20260001',
			issue_date: '29. 5. 2026',
			due_date: '12. 6. 2026',
			variable_symbol: '20260002',
			bank_account: '2000145399/0800',
			iban: 'CZ6508000000192000145399',
			currency: 'Kč',
			total: '-6 000,00',
			due_total: '6 000,00',
			note: 'Oprava chybně vyúčtovaných hodin.',
			vat_note: NON_VAT_PAYER_NOTE,
			supplier: supplier(),
			customer: customer(),
			lines: [
				{
					description: 'Programátorské práce — oprava',
					quantity: '5',
					unit: 'hod',
					unit_price: '-1 200,00',
					total: '-6 000,00',
				},
			],
			has_logo: true,
			has_qr: false,
			web: 'fakturian.app',
		});
	});

	it('množství píše s desetinnou čárkou', () => {
		const [line] = invoice().lines;
		const quantities = [6.5, 72].map((quantity) => ({
			...line!,
			quantity,
		}));

		const { lines } = invoiceData(
			{
				...invoice(),
				lines: quantities,
			},
			false,
			false,
		);

		expect(lines.map(({ quantity, total }) => [quantity, total])).toEqual([
			['6,5', '7 800,00'],
			['72', '86 400,00'],
		]);
	});

	it('zápis v rejstříku nese obě strany bez okrajových mezer', () => {
		const document = sampleInvoice();
		document.supplier.registration = '  Zapsáno v evidenci pod IČO 12345679 ';
		document.customer.registration = '';

		const data = invoiceData(document, false, false);

		expect([data.supplier.registration, data.customer.registration]).toEqual([
			'Zapsáno v evidenci pod IČO 12345679',
			'',
		]);
	});

	it('druh dokladu, účet a poznámka k DPH se nepletou', () => {
		const issued = invoiceData(
			{
				...sampleInvoice(),
				bankCode: '',
			},
			false,
			false,
		);
		const credit = invoiceData(
			{
				...sampleInvoice(),
				documentType: DocumentKind.CreditNote,
				bankAccount: '',
				vatNote: 'Vlastní poznámka k DPH.',
			},
			false,
			false,
		);

		expect([issued.title, issued.bank_account, issued.vat_note]).toEqual([
			'Faktura',
			'2000145399',
			'Nejsem plátce DPH.',
		]);
		expect([credit.title, credit.bank_account, credit.vat_note]).toEqual([
			'Dobropis',
			'',
			'Vlastní poznámka k DPH.',
		]);
	});

	it('neplátce má vlastní větu k DPH, jinak výchozí', () => {
		const custom = {
			...invoice(),
			vatNote: ' Nejsem plátce DPH podle §6 zákona o DPH. ',
		};

		expect(invoiceData(custom, false, false).vat_note).toBe('Nejsem plátce DPH podle §6 zákona o DPH.');
		expect(
			invoiceData(
				{
					...custom,
					vatNote: ' ',
				},
				false,
				false,
			).vat_note,
		).toBe(NON_VAT_PAYER_NOTE);
	});
});

describe('zdroj dokladu', () => {
	it('ISDOC vkládá až za šablonou pod jménem, pod kterým se čte zpátky', () => {
		expect(invoiceTypst().split('\n').slice(-2)).toEqual([
			'#pdf.attach("invoice.isdoc", relationship: "source", mime-type: "text/xml", description: "ISDOC data faktury")',
			'',
		]);
	});
});

describe('co je na papíře', () => {
	it('faktura nese částku, účet, obě strany, výzvu k úhradě a patku', () => {
		expect(printedOn(invoice())).toEqual(PRINTED.invoice);
	});

	it('dobropis vrací peníze a k úhradě nevyzývá', () => {
		expect(printedOn(creditNote())).toEqual(PRINTED.creditNote);
	});

	it('dobropis bez čísla původní faktury je jen opravný doklad', () => {
		const expected = PRINTED.creditNote.map((run) => run.replace(' k faktuře 20260001', ''));

		expect(
			printedOn({
				...creditNote(),
				originalInvoice: '',
			}),
		).toEqual(expected);
	});

	it('holý doklad bez IBAN, poznámky, DIČ a e-mailu nese aspoň číslo účtu', () => {
		const runs = printedOn({
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

		expect(runs.filter((run) => run.includes('2000145399/0800')).length).toBe(1);
		expect(runs.filter((run) => run.includes('IBAN') || run.includes('DIČ') || run.includes('@'))).toEqual([]);
	});

	it('vloží jen písma, která nese překladač, ne písma systému', () => {
		// typst.ts načítá i systémová písma a vypnout to nejde; překlep v názvu písma by doklad tiše
		// vysázel písmem z Macu, které jinde chybí.
		const fonts = new Set<string>();
		for (const document of samples()) {
			const pdf = new TextDecoder('latin1').decode(renderTypstPdf(invoiceTypst(), invoiceFiles(document)));
			for (const [, font = ''] of pdf.matchAll(
				/\/BaseFont\s*\/[A-Z]{6}\+([^\s/>\]]+?)(?:-Identity-H)?[\s/>\]]/g,
			)) {
				fonts.add(font);
			}
		}

		expect([...fonts].toSorted()).toEqual([
			'LibertinusSerif-Bold',
			'LibertinusSerif-Italic',
			'LibertinusSerif-Regular',
		]);
	});

	it('logo přidá právě jeden obrázek vedle QR kódu', () => {
		const plain = renderTypstPdf(invoiceTypst(), invoiceFiles(invoice()));
		const branded = renderTypstPdf(invoiceTypst(), invoiceFiles(invoice(), qrPng('logo')));

		expect([imageCount(plain), imageCount(branded)]).toEqual([1, 2]);
	});

	it('značky typstu v datech se vysázejí tak, jak jsou', () => {
		const name = 'Firma "Uvozovka" #[s.r.o.] \\ $x$ & <b>';
		const document = compileTypst(
			invoiceTypst(),
			invoiceFiles({
				...invoice(),
				customer: {
					...customer(),
					name,
				},
			}),
		);

		expect(document.numOfPages).toBe(1);
		expect(printedText(document)).toContain(name);
	});

	it('dlouhý doklad má víc stran a patku s odkazem na každé', () => {
		const document = compileTypst(invoiceTypst(), invoiceFiles(longInvoice()));
		const links = printedText(document).filter((run) => run === 'fakturian.app');

		expect(document.numOfPages).toBeGreaterThan(1);
		expect(links.length).toBe(document.numOfPages);
	});

	it('náhled dlouhého dokladu vydá každou stranu jako samostatné SVG', () => {
		const pages = renderTypstSvg(invoiceTypst(), invoiceFiles(longInvoice()));

		expect(pages.map((page) => page.slice(0, page.indexOf(' xmlns=')))).toEqual([
			'<svg viewBox="0 0 595.275590551 841.8897637796667" width="595.275590551pt" height="841.8897637796667pt"',
			'<svg viewBox="0 841.8897637796667 595.275590551 841.8897637796667" width="595.275590551pt" height="841.8897637796667pt"',
			'<svg viewBox="0 1683.7795275593335 595.275590551 841.8897637796667" width="595.275590551pt" height="841.8897637796667pt"',
		]);
	});
});
