import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NON_VAT_PAYER_NOTE } from '~/constants/invoice';
import { emptyLine, emptyParty, newInvoice } from '~/schemas/invoices';
import { emptySupplier } from '~/schemas/suppliers';
import { invoiceServices } from '~/services/invoices';

import { date } from './setup/dates';
import { summary } from './setup/fixtures';

const invoke = vi.fn();
vi.stubGlobal('fakturian', {
	invoke,
});

function wireInvoice() {
	return {
		...newInvoice(emptySupplier(), '20260001'),
		uuid: 'uuid-1',
		originalIssueDate: '2026-02-01',
		originalUuid: 'uuid-0',
		issueDate: '2026-03-01',
		dueDate: '2026-03-15',
		lines: [
			{
				description: 'Práce',
				quantity: 2,
				unit: 'hod',
				unitPriceCents: 150_000,
				itemId: 'p1',
			},
		],
	};
}

beforeEach(() => {
	invoke.mockReset();
});
afterEach(() => {
	vi.useRealTimers();
});

describe('výchozí faktura', () => {
	it('vytvoří úplný samostatný model k okamžiku založení', () => {
		vi.useFakeTimers();
		vi.setSystemTime('2026-03-01T12:00');
		const blankParty = {
			name: '',
			ico: '',
			dic: '',
			address: {
				street: '',
				city: '',
				zip: '',
			},
			email: '',
			registration: '',
		};
		const blankLine = {
			id: expect.any(String),
			description: '',
			quantity: 1,
			unit: 'ks',
			unitPriceCents: 0,
		};
		expect(emptyParty()).toEqual(blankParty);
		expect(emptyLine()).toEqual(blankLine);
		const first = newInvoice(null, '20260001');
		expect(first).toEqual({
			number: '20260001',
			uuid: '',
			documentType: 1,
			originalInvoice: '',
			originalUuid: '',
			issueDate: '2026-03-01',
			dueDate: '2026-03-15',
			supplier: blankParty,
			customer: blankParty,
			vatNote: NON_VAT_PAYER_NOTE,
			bankAccount: '',
			bankCode: '',
			iban: '',
			variableSymbol: '20260001',
			note: '',
			lines: [blankLine],
		});
		first.customer.name = 'Změna';
		first.lines[0]!.quantity = 9;
		vi.setSystemTime('2026-03-02T12:00');
		const second = newInvoice(null, '20260002');
		expect(second.issueDate).toBe('2026-03-02');
		expect(second.dueDate).toBe('2026-03-16');
		expect(second.customer).toEqual(blankParty);
		expect(second.supplier).toEqual(blankParty);
		expect(second.lines).toEqual([blankLine]);
		expect(second.lines[0]!.id).not.toBe(first.lines[0]!.id);
	});

	it('převezme údaje dodavatele a jeho splatnost včetně nuly', () => {
		vi.useFakeTimers();
		vi.setSystemTime('2026-03-01T12:00');
		const supplier = {
			...emptySupplier(),
			name: 'Dodavatel',
			registration: 'Zapsáno v obchodním rejstříku',
			bankAccount: '123',
			bankCode: '0800',
			iban: 'CZ123',
			defaultDueDays: 0,
		};
		const invoice = newInvoice(supplier, 'FA-2026-01');
		expect(invoice).toEqual({
			number: 'FA-2026-01',
			uuid: '',
			documentType: 1,
			originalInvoice: '',
			originalUuid: '',
			issueDate: '2026-03-01',
			dueDate: '2026-03-01',
			supplier: {
				name: 'Dodavatel',
				ico: '',
				dic: '',
				address: {
					street: '',
					city: '',
					zip: '',
				},
				email: '',
				registration: 'Zapsáno v obchodním rejstříku',
			},
			customer: {
				name: '',
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
			vatNote: NON_VAT_PAYER_NOTE,
			bankAccount: '123',
			bankCode: '0800',
			iban: 'CZ123',
			variableSymbol: '202601',
			note: '',
			lines: [
				{
					id: expect.any(String),
					description: '',
					quantity: 1,
					unit: 'ks',
					unitPriceCents: 0,
				},
			],
		});
		supplier.name = 'Změněný';
		expect(invoice.supplier.name).toBe('Dodavatel');
	});
});

describe('invoiceServices', () => {
	it('načítá a validuje celý doklad včetně vazby na ceník', async () => {
		const raw = wireInvoice();
		const withLineIds = {
			...raw,
			lines: raw.lines.map((line) => ({
				...line,
				id: expect.any(String),
			})),
		};
		invoke.mockResolvedValue(raw);
		expect(await invoiceServices.load('/vault', '20260001')).toEqual(withLineIds);
		expect(invoke).toHaveBeenCalledExactlyOnceWith('load_invoice', {
			vaultPath: '/vault',
			number: '20260001',
		});
		invoke.mockResolvedValue({
			...raw,
			dueDate: '',
			originalIssueDate: '',
		});
		expect(await invoiceServices.load('/vault', '20260002')).toEqual({
			...withLineIds,
			dueDate: undefined,
			originalIssueDate: undefined,
		});
	});

	it.each([true, false])('ukládá snímek modelu a přesné isNew=%s', async (isNew) => {
		const invoice = newInvoice(emptySupplier(), '20260002');
		invoice.issueDate = date('2026-03-03');
		invoice.dueDate = date('2026-03-17');
		invoice.lines = [
			{
				id: 'r1',
				description: 'Práce',
				quantity: 2,
				unit: 'hod',
				unitPriceCents: 150_000,
				itemId: 'p1',
				usageYear: 2025,
			},
		];
		invoke.mockResolvedValue('/vault/saved.pdf');
		// Rok čerpání jde do backendu s dokladem: ten ho ukládá do řádkového `Extensions` v ISDOC.
		const expected = {
			...invoice,
			originalIssueDate: '',
			lines: [
				{
					description: 'Práce',
					quantity: 2,
					unit: 'hod',
					unitPriceCents: 150_000,
					itemId: 'p1',
					usageYear: 2025,
				},
			],
		};
		expect(await invoiceServices.save('/vault', invoice, isNew)).toBe('/vault/saved.pdf');
		expect(invoke).toHaveBeenCalledExactlyOnceWith('save_invoice', {
			vaultPath: '/vault',
			invoice: expected,
			isNew,
		});
		invoice.supplier.name = 'Jiné';
		invoice.customer.name = 'Jiný';
		invoice.lines[0]!.quantity = 9;
		expect(invoke.mock.calls[0]?.[1].invoice).toEqual({
			...expected,
			supplier: {
				...expected.supplier,
				name: '',
			},
			customer: {
				...expected.customer,
				name: '',
			},
		});
		expect(invoice.lines[0]!.usageYear).toBe(2025);
	});

	it('náhled převádí nepovinná data na prázdné řetězce', async () => {
		const invoice = newInvoice(null, '20260003');
		delete invoice.dueDate;
		invoke.mockResolvedValue(['<svg/>']);
		expect(await invoiceServices.preview('/vault', invoice)).toEqual(['<svg/>']);
		expect(invoke).toHaveBeenCalledExactlyOnceWith('preview_invoice', {
			vaultPath: '/vault',
			invoice: {
				...invoice,
				dueDate: '',
				originalIssueDate: '',
				lines: [
					{
						description: '',
						quantity: 1,
						unit: 'ks',
						unitPriceCents: 0,
						usageYear: null,
					},
				],
			},
		});
	});

	it('náhled s poškozenou odpovědí se odmítne', async () => {
		invoke.mockResolvedValue('/tmp/preview.pdf');

		await expect(invoiceServices.preview('/vault', newInvoice(null, '20260003'))).rejects.toThrow(
			new Error('Náhled má poškozený obsah (Neplatný vstup: očekáváno pole, obdrženo řetězec).'),
		);
	});

	it('čte seznam přes vlastní command', async () => {
		const broken = {
			fileName: '20260002.pdf',
			path: '/a/faktury/20260002.pdf',
			reason: 'PDF nejde přečíst',
		};
		invoke.mockResolvedValueOnce({
			items: [summary('20260001', { totalCents: 300_000 })],
			broken: [broken],
		});
		expect(await invoiceServices.list('/a')).toEqual({
			items: [summary('20260001', { totalCents: 300_000 })],
			broken: [broken],
		});
		expect(invoke).toHaveBeenCalledExactlyOnceWith('list_invoices', { vaultPath: '/a' });
	});

	it('čte použitá čísla dokladů', async () => {
		invoke.mockResolvedValue(['20260001']);
		expect(await invoiceServices.usedNumbers('/a')).toEqual(['20260001']);
		expect(invoke).toHaveBeenCalledExactlyOnceWith('list_used_numbers', { vaultPath: '/a' });
	});

	it('zapíše odeslání přes přesný doklad a vrátí jeho čas', async () => {
		invoke.mockResolvedValue('2026-08-31T08:00:00Z');

		expect(await invoiceServices.markSent('/vault', '20260001')).toBe('2026-08-31T08:00:00Z');
		expect(invoke).toHaveBeenCalledExactlyOnceWith('mark_invoice_sent', {
			vaultPath: '/vault',
			number: '20260001',
		});
	});

	it('uloží PDF dokladu do cíle, který zvolil uživatel', async () => {
		invoke.mockResolvedValue(null);

		expect(await invoiceServices.exportPdf('/vault', '20260001', '/Users/jan/Faktura.pdf')).toBeUndefined();
		expect(invoke).toHaveBeenCalledExactlyOnceWith('export_invoice_pdf', {
			vaultPath: '/vault',
			number: '20260001',
			target: '/Users/jan/Faktura.pdf',
		});
	});

	it('smaže přesný doklad', async () => {
		invoke.mockResolvedValue(null);

		expect(await invoiceServices.remove('/vault', '20260001')).toBeUndefined();
		expect(invoke).toHaveBeenCalledExactlyOnceWith('delete_invoice', {
			vaultPath: '/vault',
			number: '20260001',
		});
	});

	it('odmítá neplatné odpovědi každé čtecí operace', async () => {
		invoke.mockResolvedValue(null);
		await expect(invoiceServices.load('/x', '20260001')).rejects.toThrow(
			new Error('Doklad má poškozený obsah (Neplatný vstup: očekáváno object, obdrženo null).'),
		);
		await expect(invoiceServices.list('/x')).rejects.toThrow(
			new Error('Seznam faktur má poškozený obsah (Neplatný vstup: očekáváno object, obdrženo null).'),
		);
		invoke.mockResolvedValue([42]);
		await expect(invoiceServices.usedNumbers('/x')).rejects.toThrow(
			new Error(
				'Seznam použitých čísel má poškozený obsah (0: Neplatný vstup: očekáváno řetězec, obdrženo číslo).',
			),
		);
	});

	it('pojmenuje nejvýše tři chybná pole v pořadí schématu', async () => {
		invoke.mockResolvedValue({
			...wireInvoice(),
			number: 1,
			uuid: 2,
			documentType: 'x',
			originalInvoice: 3,
		});
		await expect(invoiceServices.load('/x', '20260001')).rejects.toThrow(
			new Error(
				'Doklad má poškozený obsah (number: Neplatný vstup: očekáváno řetězec, obdrženo číslo, uuid: Neplatný vstup: očekáváno řetězec, obdrženo číslo a documentType: Neplatná možnost: očekávána jedna z hodnot 1|2).',
			),
		);
		invoke.mockResolvedValue({
			items: [
				{
					...summary('20260001', { totalCents: 300_000 }),
					issueDate: '2026-02-30',
				},
			],
			broken: [],
		});
		await expect(invoiceServices.list('/x')).rejects.toThrow(
			new Error('Seznam faktur má poškozený obsah (items.0.issueDate: Datum musí být ve tvaru RRRR-MM-DD.).'),
		);
		invoke.mockResolvedValue({
			items: [],
			broken: [
				{
					fileName: 'x.pdf',
					path: '/x.pdf',
					reason: 42,
				},
			],
		});
		await expect(invoiceServices.list('/x')).rejects.toThrow(
			new Error(
				'Seznam faktur má poškozený obsah (broken.0.reason: Neplatný vstup: očekáváno řetězec, obdrženo číslo).',
			),
		);
	});

	it.each([
		[
			{
				...wireInvoice(),
				extra: 'neznámé',
			},
			'Neznámé klíče: "extra"',
		],
		[
			{
				...wireInvoice(),
				supplier: {
					...wireInvoice().supplier,
					extra: true,
				},
			},
			'supplier: Neznámé klíče: "extra"',
		],
		[
			{
				...wireInvoice(),
				lines: [
					{
						description: 'Práce',
						quantity: 1,
						unit: 'hod',
						unitPriceCents: 100,
					},
				],
			},
			'lines.0.itemId: Neplatný vstup: očekáváno řetězec, obdrženo undefined',
		],
		[
			{
				...wireInvoice(),
				lines: [
					{
						...wireInvoice().lines[0],
						extra: true,
					},
				],
			},
			'lines.0: Neznámé klíče: "extra"',
		],
		[
			{
				...wireInvoice(),
				issueDate: '2026-02-30',
			},
			'issueDate: Datum musí být ve tvaru RRRR-MM-DD.',
		],
	])('odmítá rozejití kontraktu %j', async (raw, issue) => {
		invoke.mockResolvedValue(raw);
		await expect(invoiceServices.load('/x', '20260001')).rejects.toThrow(
			new Error(`Doklad má poškozený obsah (${issue}).`),
		);
	});

	it.each([
		['load', () => invoiceServices.load('/x', '20260001')],
		['save', () => invoiceServices.save('/x', newInvoice(null, '20260001'), true)],
		['preview', () => invoiceServices.preview('/x', newInvoice(null, '20260001'))],
		['list', () => invoiceServices.list('/x')],
		['usedNumbers', () => invoiceServices.usedNumbers('/x')],
		['markSent', () => invoiceServices.markSent('/x', '1')],
		['exportPdf', () => invoiceServices.exportPdf('/x', '1', '/cil.pdf')],
		['remove', () => invoiceServices.remove('/x', '1')],
	])('%s předá hlášku backendu beze změny', async (_name, call) => {
		// Backend posílá chybu jako řetězec, ne jako `Error`.
		invoke.mockRejectedValue('Vault je zamčený');
		await expect(call()).rejects.toBe('Vault je zamčený');
	});
});
