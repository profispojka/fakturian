import { describe, expect, it } from 'vitest';

import { emptyPayments, paymentFormSchema, paymentsFileSchema } from '~/schemas/payments';
import { addDays, today } from '~/utils/date';
import { lastPaymentOn, ledgerOf, settlementOf } from '~/utils/payments';

import { date } from './setup/dates';

import type { InvoiceSummary } from '~/schemas/invoices';
import type { ReceivedPayment } from '~/schemas/payments';

function inv(totalCents: number, over: Partial<InvoiceSummary> = {}): InvoiceSummary {
	return {
		number: '20260001',
		customer: 'X',
		issueDate: date('2026-05-01'),
		dueDate: date('2026-05-15'),
		totalCents,
		variableSymbol: '20260001',
		documentType: totalCents < 0 ? 2 : 1,
		originalInvoice: '',
		sentAt: null,
		usageLines: [],
		path: '20260001.pdf',
		...over,
	};
}

/** Vypořádání samostatného dokladu: archiv i platby obsahují jen jeho. */
function settle(invoice: InvoiceSummary, received: ReceivedPayment[] = []) {
	return settlementOf(invoice, ledgerOf([invoice], { [invoice.number]: received }));
}

describe('settlementOf', () => {
	it('bez plateb dluží doklad celou částku', () => {
		expect(settle(inv(100_000))).toEqual({
			paidCents: 0,
			outstandingCents: 100_000,
			overpaidCents: 0,
			credited: false,
		});
	});

	it('částečná platba nechá zbytek k úhradě', () => {
		expect(
			settle(inv(100_000), [
				{
					date: date('2026-05-20'),
					amountCents: 40_000,
				},
			]),
		).toEqual({
			paidCents: 40_000,
			outstandingCents: 60_000,
			overpaidCents: 0,
			credited: false,
		});
	});

	it('platby se sečtou', () => {
		const s = settle(inv(100_000), [
			{
				date: date('2026-05-25'),
				amountCents: 60_000,
			},
			{
				date: date('2026-05-20'),
				amountCents: 40_000,
			},
		]);

		expect(s).toMatchObject({
			paidCents: 100_000,
			outstandingCents: 0,
		});
	});

	it('přeplatek se neschová v uhrazené částce', () => {
		expect(
			settle(inv(100_000), [
				{
					date: date('2026-05-20'),
					amountCents: 120_000,
				},
			]),
		).toEqual({
			paidCents: 100_000,
			outstandingCents: 0,
			overpaidCents: 20_000,
			credited: false,
		});
	});

	it('nulový doklad nic nedluží ani bez platby', () => {
		expect(settle(inv(0))).toEqual({
			paidCents: 0,
			outstandingCents: 0,
			overpaidCents: 0,
			credited: false,
		});
	});
});

describe('lastPaymentOn', () => {
	it('najde poslední datum bez ohledu na pořadí zápisu', () => {
		expect(
			lastPaymentOn([
				{
					date: date('2026-05-25'),
					amountCents: 60_000,
				},
				{
					date: date('2026-06-02'),
					amountCents: 10_000,
				},
				{
					date: date('2026-05-20'),
					amountCents: 40_000,
				},
			]),
		).toBe('2026-06-02');
	});

	it('bez plateb data nemá', () => {
		expect(lastPaymentOn([])).toBeUndefined();
	});
});

describe('faktura s dobropisem', () => {
	const invoice = inv(100_000);
	const credit = inv(-100_000, {
		number: '20260002',
		originalInvoice: '20260001',
	});
	const paidOn = date('2026-05-20');

	it('nezaplacená faktura s dobropisem nic nedluží a dobropis nic nevrací', () => {
		const ledger = ledgerOf([invoice, credit], {});

		expect(settlementOf(invoice, ledger)).toEqual({
			paidCents: 0,
			outstandingCents: 0,
			overpaidCents: 0,
			credited: true,
		});
		expect(settlementOf(credit, ledger)).toEqual({
			paidCents: 0,
			outstandingCents: 0,
			overpaidCents: 0,
			credited: false,
		});
	});

	it('zčásti zaplacenou fakturu vrací dobropis v zaplacené výši', () => {
		const ledger = ledgerOf([invoice, credit], {
			'20260001': [
				{
					date: paidOn,
					amountCents: 30_000,
				},
			],
		});

		expect(settlementOf(invoice, ledger)).toEqual({
			paidCents: 30_000,
			outstandingCents: 0,
			overpaidCents: 0,
			credited: true,
		});
		expect(settlementOf(credit, ledger)).toEqual({
			paidCents: 0,
			outstandingCents: -30_000,
			overpaidCents: 0,
			credited: false,
		});
	});

	it('vrací nejvýš svou částku, i když odběratel fakturu přeplatil', () => {
		const ledger = ledgerOf([invoice, credit], {
			'20260001': [
				{
					date: paidOn,
					amountCents: 130_000,
				},
			],
		});

		expect(settlementOf(invoice, ledger)).toMatchObject({
			paidCents: 100_000,
			overpaidCents: 30_000,
		});
		expect(settlementOf(credit, ledger).outstandingCents).toBe(-100_000);
	});

	it('vrácené peníze dobropis vypořádají a nad vratku jsou přeplatkem', () => {
		const ledger = ledgerOf([invoice, credit], {
			'20260001': [
				{
					date: paidOn,
					amountCents: 100_000,
				},
			],
			'20260002': [
				{
					date: date('2026-05-25'),
					amountCents: 120_000,
				},
			],
		});

		expect(settlementOf(credit, ledger)).toEqual({
			paidCents: -100_000,
			outstandingCents: 0,
			overpaidCents: 20_000,
			credited: false,
		});
	});

	it('zčásti vrácený dobropis nese uhrazeno i zbývá se svým znaménkem', () => {
		const ledger = ledgerOf([invoice, credit], {
			'20260001': [
				{
					date: paidOn,
					amountCents: 100_000,
				},
			],
			'20260002': [
				{
					date: date('2026-05-25'),
					amountCents: 40_000,
				},
			],
		});

		expect(settlementOf(credit, ledger)).toMatchObject({
			paidCents: -40_000,
			outstandingCents: -60_000,
		});
	});

	it('faktura s odkazem na jinou fakturu ji nevypořádá', () => {
		const odd = inv(100_000, {
			number: '20260003',
			originalInvoice: '20260001',
		});
		const ledger = ledgerOf([invoice, odd], {});

		expect(settlementOf(invoice, ledger)).toMatchObject({
			outstandingCents: 100_000,
			credited: false,
		});
	});
});

describe('formulář platby', () => {
	it('platbu z dneška i z minulosti přijme', () => {
		expect(
			paymentFormSchema.safeParse({
				id: 'p1',
				date: today(),
				amountCents: 100,
			}).success,
		).toBe(true);
		expect(
			paymentFormSchema.safeParse({
				id: 'p1',
				date: addDays(today(), -1),
				amountCents: 100,
			}).success,
		).toBe(true);
	});

	it('platbu z budoucnosti odmítne u data', () => {
		const result = paymentFormSchema.safeParse({
			id: 'p1',
			date: addDays(today(), 1),
			amountCents: 100,
		});

		expect(
			result.error?.issues.map((issue) => ({
				path: issue.path,
				message: issue.message,
			})),
		).toEqual([
			{
				path: ['date'],
				message: 'Platba nemůže přijít v budoucnu.',
			},
		]);
	});
});

describe('soubor plateb', () => {
	const fromFio = {
		id: 'p1',
		date: '2026-03-01',
		amountCents: 100,
		fioId: '26001',
	};

	it('chybějící soubor je prázdná evidence', () => {
		expect(paymentsFileSchema.parse({})).toEqual(emptyPayments());
	});
	it('faktura bez plateb i platba z Fia projdou beze změny', () => {
		const file = {
			payments: {
				'1': [],
				'2': [fromFio],
			},
		};
		expect(paymentsFileSchema.parse(file)).toEqual(file);
	});
	it('platba z Fia bez id pohybu neprojde', () => {
		expect(
			paymentsFileSchema.safeParse({
				payments: {
					'1': [
						{
							...fromFio,
							fioId: '',
						},
					],
				},
			}).success,
		).toBe(false);
	});
	it.each([
		['x', 'Zadej číslo.'],
		[1.5, 'Zadej celé číslo.'],
		[0, 'Zadej číslo > 0.'],
		[-1, 'Zadej číslo > 0.'],
	])('částku %s odmítne hláškou „%s“', (amountCents, message) => {
		const result = paymentsFileSchema.safeParse({
			payments: {
				'1': [
					{
						id: 'p1',
						date: '2026-03-01',
						amountCents,
					},
				],
			},
		});
		expect(result.error?.issues.map((issue) => issue.message)).toEqual([message]);
	});
});
