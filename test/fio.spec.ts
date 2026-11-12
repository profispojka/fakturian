import { describe, expect, it } from 'vitest';

import { matchPayments } from '~/utils/fio';

import { date } from './setup/dates';

import type { FioPayment } from '~/schemas/fio';
import type { InvoiceSummary } from '~/schemas/invoices';

function inv(number: string, totalCents: number): InvoiceSummary {
	return {
		number,
		customer: 'X',
		issueDate: date('2026-05-01'),
		dueDate: date('2026-05-15'),
		totalCents,
		variableSymbol: number,
		documentType: totalCents < 0 ? 2 : 1,
		originalInvoice: '',
		sentAt: null,
		usageLines: [],
		path: `${number}.pdf`,
	};
}
function pay(vs: string, amountCents: number, id: string): FioPayment {
	return {
		id,
		amountCents,
		vs,
		date: date('2026-05-20'),
		message: '',
	};
}

describe('matchPayments', () => {
	const invoices = [inv('20260001', 100_000), inv('20260002', 250_000)];

	it('platbu přiřadí podle VS a zapíše ji i s ID pohybu', () => {
		expect(matchPayments([pay('20260001', 100_000, 'm1')], invoices, {})).toEqual({
			matched: [
				{
					number: '20260001',
					payment: {
						id: expect.any(String),
						date: '2026-05-20',
						amountCents: 100_000,
						fioId: 'm1',
					},
				},
			],
			unmatched: [],
		});
	});

	it('částečnou platbu spáruje s částkou, která skutečně přišla', () => {
		const { matched } = matchPayments([pay('20260001', 99_900, 'm1')], invoices, {});

		expect(matched).toEqual([
			{
				number: '20260001',
				payment: {
					id: expect.any(String),
					date: '2026-05-20',
					amountCents: 99_900,
					fioId: 'm1',
				},
			},
		]);
	});

	it('přeplatek spáruje celý', () => {
		const { matched } = matchPayments([pay('20260001', 120_000, 'm1')], invoices, {});

		expect(matched.map((m) => m.payment.amountCents)).toEqual([120_000]);
	});

	it('části jedné faktury v dávce spáruje, dokud ji nedoplatí', () => {
		const third = pay('20260001', 10_000, 'm3');

		const result = matchPayments(
			[pay('20260001', 40_000, 'm1'), pay('20260001', 60_000, 'm2'), third],
			invoices,
			{},
		);

		expect(result.matched.map((m) => m.payment.fioId)).toEqual(['m1', 'm2']);
		expect(result.unmatched).toEqual([third]);
	});

	it('zvládne víc faktur najednou', () => {
		const stranger = pay('x', 100, 'm3');

		const result = matchPayments(
			[pay('20260002', 250_000, 'm1'), pay('20260001', 100_000, 'm2'), stranger],
			invoices,
			{},
		);

		expect(result.matched.map((m) => m.number)).toEqual(['20260002', '20260001']);
		expect(result.unmatched).toEqual([stranger]);
	});

	it('nespáruje neznámý VS', () => {
		const payment = pay('88888888', 100_000, 'm1');

		expect(matchPayments([payment], invoices, {})).toEqual({
			matched: [],
			unmatched: [payment],
		});
	});

	it('pohyb, který už v evidenci je, přeskočí a nepočítá mezi nespárované', () => {
		const payments = {
			'20260001': [
				{
					date: date('2026-05-20'),
					amountCents: 40_000,
					fioId: 'm1',
				},
			],
		};

		expect(matchPayments([pay('20260001', 40_000, 'm1')], invoices, payments)).toEqual({
			matched: [],
			unmatched: [],
		});
	});

	it('tentýž pohyb dvakrát ve výpisu zapíše jednou', () => {
		const result = matchPayments([pay('20260001', 40_000, 'm1'), pay('20260001', 40_000, 'm1')], invoices, {});

		expect(result.matched).toHaveLength(1);
		expect(result.unmatched).toEqual([]);
	});

	it('zčásti uhrazenou fakturu doplatí', () => {
		const payments = {
			'20260001': [
				{
					date: date('2026-05-10'),
					amountCents: 40_000,
				},
			],
		};

		const { matched } = matchPayments([pay('20260001', 60_000, 'm2')], invoices, payments);

		expect(matched.map((m) => m.number)).toEqual(['20260001']);
	});

	it('uhrazenou fakturu nepřepíše, ani když ji uhradil ruční zápis', () => {
		const payment = pay('20260001', 100_000, 'm1');
		const payments = {
			'20260001': [
				{
					date: date('2026-05-18'),
					amountCents: 100_000,
				},
			],
		};

		expect(matchPayments([payment], invoices, payments)).toEqual({
			matched: [],
			unmatched: [payment],
		});
	});

	it('pohyb bez ID nezapíše, protože by ho další synchronizace zapsala znovu', () => {
		const payment = pay('20260001', 100_000, '');

		expect(matchPayments([payment], invoices, {})).toEqual({
			matched: [],
			unmatched: [payment],
		});
	});

	it('mezi doklady se stejným VS rozhodne částka', () => {
		const sameSymbol = {
			...inv('F2026-001', 250_000),
			variableSymbol: '20260001',
		};

		const { matched } = matchPayments([pay('20260001', 250_000, 'm1')], [invoices[0]!, sameSymbol], {});

		expect(matched.map((m) => m.number)).toEqual(['F2026-001']);
	});

	it('když nerozhodne ani částka, nehádá', () => {
		const sameSymbol = {
			...inv('F2026-001', 100_000),
			variableSymbol: '20260001',
		};
		const payment = pay('20260001', 100_000, 'm1');

		expect(matchPayments([payment], [invoices[0]!, sameSymbol], {})).toEqual({
			matched: [],
			unmatched: [payment],
		});
	});

	it('příchozí platbu k dobropisu nespáruje — k němu peníze odcházejí', () => {
		const payment = pay('20260003', 50_000, 'm1');

		expect(matchPayments([payment], [inv('20260003', -50_000)], {})).toEqual({
			matched: [],
			unmatched: [payment],
		});
	});

	it('příchozí platbu nespáruje ani s dobropisem, který má co vracet', () => {
		const credit = {
			...inv('20260003', -100_000),
			originalInvoice: '20260001',
		};
		const payment = pay('20260003', 100_000, 'm1');
		const paid = {
			'20260001': [
				{
					id: 'p1',
					date: date('2026-05-10'),
					amountCents: 100_000,
				},
			],
		};

		expect(matchPayments([payment], [inv('20260001', 100_000), credit], paid)).toEqual({
			matched: [],
			unmatched: [payment],
		});
	});
});

describe('variabilní symbol při párování', () => {
	it('nuly na začátku párování neovlivní', () => {
		const { matched } = matchPayments(
			[pay(' 12026 ', 100_000, 'm1'), pay('0000020260002', 250_000, 'm2')],
			[
				{
					...inv('F12026', 100_000),
					variableSymbol: '00012026',
				},
				inv('20260002', 250_000),
			],
			{},
		);

		expect(matched.map((m) => [m.number, m.payment.fioId])).toEqual([
			['F12026', 'm1'],
			['20260002', 'm2'],
		]);
	});

	it('doklad bez symbolu se nespáruje ani s pohybem bez symbolu', () => {
		const { matched, unmatched } = matchPayments(
			[pay('', 100_000, 'm1'), pay(' 000 ', 100_000, 'm2')],
			[
				{
					...inv('FAKTURA', 100_000),
					variableSymbol: '',
				},
			],
			{},
		);

		expect(matched).toEqual([]);
		expect(unmatched.map((m) => m.id)).toEqual(['m1', 'm2']);
	});
});

describe('párování faktury s dobropisem', () => {
	it('dobropisovaná faktura další platbu nedostane', () => {
		const credit = {
			...inv('20260002', -100_000),
			originalInvoice: '20260001',
		};

		const { matched, unmatched } = matchPayments(
			[pay('20260001', 100_000, 'm1')],
			[inv('20260001', 100_000), credit],
			{},
		);

		expect(matched).toEqual([]);
		expect(unmatched.map((m) => m.id)).toEqual(['m1']);
	});

	it('druhý pohyb z téže dávky uhrazenou fakturu nedoplní', () => {
		const { matched, unmatched } = matchPayments(
			[pay('20260001', 100_000, 'm1'), pay('20260001', 100_000, 'm2')],
			[inv('20260001', 100_000)],
			{},
		);

		expect(matched.map((m) => m.payment.fioId)).toEqual(['m1']);
		expect(unmatched.map((m) => m.id)).toEqual(['m2']);
	});
});
