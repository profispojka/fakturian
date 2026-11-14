import { describe, expect, it } from 'vitest';

import { VAT_LIMIT_CENTS, VAT_LIMIT_IMMEDIATE_CENTS } from '~/constants/dashboard';
import {
	balance,
	dashboardStats,
	dueSoon,
	periodSeries,
	topCustomers,
	topDebtors,
	vatLimit,
	vatLevelOf,
	turnoverAndMargin,
} from '~/utils/dashboard';

import { date } from './setup/dates';

import type { Expense } from '~/schemas/expenses';
import type { InvoiceSummary } from '~/schemas/invoices';
import type { Payments } from '~/schemas/payments';

function sum(number: string, issued: string, due: string, totalCzk: number, customer = 'X'): InvoiceSummary {
	return {
		number,
		customer,
		issueDate: date(issued),
		dueDate: date(due),
		totalCents: Math.round(totalCzk * 100),
		variableSymbol: number,
		documentType: 1,
		originalInvoice: '',
		sentAt: null,
		usageLines: [],
		path: `${number}.pdf`,
	};
}

describe('dashboardStats', () => {
	const today = date('2026-05-29');
	const items: InvoiceSummary[] = [
		sum('20260003', '2026-05-10', '2026-05-20', 1000), // tento měsíc, nezaplaceno, po splatnosti
		sum('20260002', '2026-05-01', '2026-06-30', 2000), // tento měsíc, zaplaceno
		sum('20260001', '2026-02-01', '2026-02-15', 500), // jiný měsíc, nezaplaceno, po splatnosti
		sum('20250099', '2025-12-01', '2025-12-15', 9999), // jiný rok
	];
	const payments: Payments = {
		'20260002': [
			{
				date: date('2026-05-05'),
				amountCents: 200_000,
			},
		],
	};

	const s = dashboardStats(items, payments, today);

	it('po splatnosti za celou historii', () => {
		expect(s.overdueCount).toBe(3);
	});

	it('nezaplacené a poslední seznamy', () => {
		expect(s.unpaid.map((i) => i.number)).toEqual(['20260003', '20260001', '20250099']);
		expect(s.recent).toHaveLength(4);
	});
});

describe('částečná úhrada na přehledu', () => {
	const today = date('2026-05-29');
	const invoice = sum('20260001', '2026-05-01', '2026-06-30', 1000, 'Alfa');
	const payments: Payments = {
		'20260001': [
			{
				date: date('2026-05-10'),
				amountCents: 40_000,
			},
		],
	};

	it('doklad nechá mezi nezaplacenými', () => {
		expect(dashboardStats([invoice], payments, today).unpaid).toEqual([invoice]);
	});

	it('bilance i dlužníci počítají se zbytkem, ne s celou fakturou', () => {
		expect(balance([invoice], payments, 2026)).toEqual(
			expect.objectContaining({
				totalCents: 100_000,
				paidCents: 40_000,
				unpaidCents: 60_000,
			}),
		);
		expect(topDebtors([invoice], payments)).toEqual([
			{
				customer: 'Alfa',
				amountCents: 60_000,
			},
		]);
	});

	it('blížící se splatnost ho dál hlídá', () => {
		expect(dueSoon([invoice], payments, date('2026-06-25'))).toEqual([invoice]);
	});
});

describe('dueSoon', () => {
	const today = date('2026-05-29');
	const items: InvoiceSummary[] = [
		sum('a', '2026-05-01', '2026-05-20', 1000), // po splatnosti
		sum('b', '2026-05-01', '2026-05-29', 1000), // splatnost dnes
		sum('c', '2026-05-01', '2026-06-02', 1000), // za pár dní
		sum('d', '2026-05-01', '2026-06-10', 1000), // mimo výchozí sedmidenní okno
	];

	it('vezme jen nezaplacené se splatností od dneška do 7 dnů dopředu', () => {
		expect(dueSoon(items, {}, today).map((i) => i.number)).toEqual(['b', 'c']);
	});

	it('doklad po splatnosti do sady nepatří', () => {
		expect(dueSoon(items, {}, today).map((i) => i.number)).not.toContain('a');
	});

	it('zaplacenou fakturu vynechá, i kdyby splatnost byla blízko', () => {
		expect(
			dueSoon(
				items,
				{
					b: [
						{
							date: today,
							amountCents: 100_000,
						},
					],
				},
				today,
			).map((i) => i.number),
		).toEqual(['c']);
	});

	it('řadí od nejbližšího data splatnosti', () => {
		expect(dueSoon(items, {}, today).map((i) => String(i.dueDate))).toEqual(['2026-05-29', '2026-06-02']);
	});

	it('vlastní počet dní rozšíří okno', () => {
		expect(dueSoon(items, {}, today, 15).map((i) => i.number)).toEqual(['b', 'c', 'd']);
	});

	it('doklad bez splatnosti do sady nepatří', () => {
		const without: InvoiceSummary = {
			...sum('e', '2026-05-01', '2026-05-30', 1000),
			dueDate: undefined,
		};
		expect(dueSoon([...items, without], {}, today).map((i) => i.number)).toEqual(['b', 'c']);
	});
});

describe('doklad bez splatnosti', () => {
	const today = date('2026-05-29');
	const without: InvoiceSummary = {
		...sum('x', '2026-05-01', '2026-05-10', 1000),
		dueDate: undefined,
	};

	it('počítá se mezi nezaplacené, ale ne mezi doklady po splatnosti', () => {
		const s = dashboardStats([without], {}, today);
		expect(s.unpaid).toEqual([without]);
		expect(s.overdueCount).toBe(0);
	});
});

describe('periodSeries', () => {
	const today = date('2026-05-29');
	const items: InvoiceSummary[] = [
		sum('a', '2026-05-10', '2026-05-20', 1000),
		sum('b', '2026-05-01', '2026-05-15', 500),
		sum('c', '2026-02-01', '2026-02-15', 300),
		sum('d', '2024-07-01', '2024-07-15', 9999),
	];

	it('měsíce — 12 souvislých kbelíků končících aktuálním měsícem', () => {
		const s = periodSeries(items, 'month', today);
		expect(s).toHaveLength(12);
		expect(s.at(-1)!.key).toBe('2026-05');
		expect(s.at(-1)!.salesCents).toBe(150000); // 1000 + 500
		expect(s.find((b) => b.key === '2026-02')!.salesCents).toBe(30000);
		expect(s.reduce((t, b) => t + b.salesCents, 0)).toBe(180000);
	});

	it('kvartály — 8 kbelíků, aktuální Q2/26 poslední', () => {
		const s = periodSeries(items, 'quarter', today);
		expect(s).toHaveLength(8);
		expect(s.at(-1)!.key).toBe('2026-Q2');
		expect(s.at(-1)!.salesCents).toBe(150000);
		expect(s.find((b) => b.key === '2026-Q1')!.salesCents).toBe(30000);
	});

	it('roky — od nejstaršího dokladu po aktuální rok', () => {
		const s = periodSeries(items, 'year', today);
		expect(s.map((b) => b.key)).toEqual(['2024', '2025', '2026']);
		expect(s.find((b) => b.key === '2024')!.salesCents).toBe(999900);
		expect(s.find((b) => b.key === '2026')!.salesCents).toBe(180000);
		expect(s.find((b) => b.key === '2025')!.salesCents).toBe(0);
	});

	it('dobropis (záporná částka) snižuje prodej v období', () => {
		const withCredit = [...items, sum('e', '2026-05-12', '2026-05-12', -400)];
		const s = periodSeries(withCredit, 'month', today);
		expect(s.at(-1)!.salesCents).toBe(110000); // 1500 - 400
	});
});

describe('balance / top listy', () => {
	const items: InvoiceSummary[] = [
		sum('1', '2026-01-10', '2026-01-20', 1000, 'Alfa'),
		sum('2', '2026-02-10', '2026-02-20', 2000, 'Beta'),
		sum('3', '2026-03-10', '2026-03-20', 3000, 'Alfa'),
		sum('4', '2025-12-10', '2025-12-20', 5000, 'Gama'),
	];
	const payments: Payments = {
		'1': [
			{
				date: date('2026-01-15'),
				amountCents: 100_000,
			},
		],
		'4': [
			{
				date: date('2025-12-15'),
				amountCents: 500_000,
			},
		],
	};

	it('bilance za rok rozlišuje zaplaceno/nezaplaceno', () => {
		const b = balance(items, payments, 2026);
		expect(b.totalCents).toBe(600000);
		expect(b.paidCents).toBe(100000);
		expect(b.unpaidCents).toBe(500000);
	});

	it('bilance bez filtru roku sčítá vše', () => {
		expect(balance(items, payments, null).totalCents).toBe(1100000);
	});

	describe('nákup', () => {
		function expense(id: string, czk: number, on: string): Expense {
			return {
				id,
				supplier: 'S',
				description: '',
				amountCents: Math.round(czk * 100),
				date: date(on),
			};
		}
		const expenses = [expense('a', 1_000, '2026-02-01'), expense('b', 4_000, '2025-11-01')];

		it('bez výdajů je nula', () => {
			expect(balance(items, payments, 2026).purchaseCents).toBe(0);
		});

		it('za rok počítá jen doklady toho roku', () => {
			expect(balance(items, payments, 2026, expenses).purchaseCents).toBe(1_000_00);
		});

		it('bez filtru roku sčítá všechny roky', () => {
			expect(balance(items, payments, null, expenses).purchaseCents).toBe(5_000_00);
		});

		it('předplatné zapsané jednou se počítá jednou, v roce svého data, ne za každý měsíc', () => {
			const domain = expense('d', 500, '2025-11-01');
			expect(balance(items, payments, null, [domain]).purchaseCents).toBe(500_00);
			expect(balance(items, payments, 2025, [domain]).purchaseCents).toBe(500_00);
			expect(balance(items, payments, 2026, [domain]).purchaseCents).toBe(0);
		});
	});

	it('top dlužníci dle nezaplacené částky', () => {
		expect(topDebtors(items, payments)).toEqual([
			{
				customer: 'Alfa',
				amountCents: 300000,
			},
			{
				customer: 'Beta',
				amountCents: 200000,
			},
		]);
	});

	it('top odběratelé dle obratu', () => {
		expect(topCustomers(items)).toEqual([
			{
				customer: 'Gama',
				amountCents: 500000,
			},
			{
				customer: 'Alfa',
				amountCents: 400000,
			},
			{
				customer: 'Beta',
				amountCents: 200000,
			},
		]);
	});
});

describe('faktura s dobropisem na Přehledu', () => {
	const today = date('2026-05-29');
	const invoice = sum('20260001', '2026-02-01', '2026-02-15', 1000, 'Acme');
	const credit = {
		...sum('20260002', '2026-02-20', '2026-02-20', -1000, 'Acme'),
		documentType: 2 as const,
		originalInvoice: '20260001',
	};

	it('dobropisovaná faktura ani dobropis nejsou po splatnosti ani nezaplacené', () => {
		const s = dashboardStats([credit, invoice], {}, today);
		expect(s.overdueCount).toBe(0);
		expect(s.unpaid).toEqual([]);
		expect(topDebtors([credit, invoice], {})).toEqual([]);
	});

	it('dobropis s vratkou je nevypořádaný, ale po splatnosti se nepočítá', () => {
		const paid: Payments = {
			'20260001': [
				{
					date: date('2026-02-10'),
					amountCents: 100_000,
				},
			],
		};
		const s = dashboardStats([credit, invoice], paid, today);
		expect(s.overdueCount).toBe(0);
		expect(s.unpaid.map((i) => i.number)).toEqual(['20260002']);
		expect(balance([credit, invoice], paid, 2026)).toEqual({
			totalCents: 0,
			paidCents: 100_000,
			unpaidCents: -100_000,
			purchaseCents: 0,
		});
	});

	it('dobropis ani dobropisovaná faktura se mezi brzy splatné nedostanou', () => {
		const soon = sum('20260003', '2026-05-20', '2026-06-01', 500);
		const soonCredit = {
			...credit,
			dueDate: date('2026-06-01'),
		};
		const credited = {
			...invoice,
			dueDate: date('2026-06-01'),
		};
		const paid: Payments = {
			'20260001': [
				{
					date: date('2026-02-10'),
					amountCents: 100_000,
				},
			],
		};
		expect(dueSoon([soon, soonCredit, credited], paid, today).map((i) => i.number)).toEqual(['20260003']);
	});
});

describe('vatLimit', () => {
	const today = date('2026-05-29');

	it('loňské překročení hlásí plátcovství i v roce s nulovým obratem', () => {
		const lastYear = [sum('1', '2025-03-01', '2025-03-15', 2_100_000)];
		const v = vatLimit(lastYear, today);
		expect([v.turnoverCents, v.stage, v.payerFrom]).toEqual([0, 'below', undefined]);
		expect(v.previous).toEqual({
			year: 2025,
			turnoverCents: 210_000_000,
			stage: 'next-year',
			payerFrom: '2026-01-01',
		});
	});

	it('loňské okamžité plátcovství nese den překročení', () => {
		const lastYear = [
			sum('1', '2025-03-01', '2025-03-15', 2_536_501),
			sum('3', '2024-12-31', '2025-01-14', 3_000_000),
		];
		expect(vatLimit(lastYear, today).previous).toEqual({
			year: 2025,
			turnoverCents: 253_650_100,
			stage: 'immediate',
			payerFrom: '2025-03-02',
		});
	});

	it('sečte obrat za kalendářní rok, ne za okno posunuté ode dneška', () => {
		const items: InvoiceSummary[] = [
			sum('1', '2026-05-01', '2026-05-15', 600_000),
			sum('2', '2026-01-01', '2026-01-15', 100_000), // první den roku patří dovnitř
			sum('3', '2026-12-20', '2027-01-03', 50_000), // vystavené po dnešku, ale v témž roce
			sum('4', '2025-08-01', '2025-08-15', 999_999), // loňský rok je mimo
		];
		const v = vatLimit(items, today);
		expect(v.turnoverCents).toBe(75_000_000);
		expect(v.year).toBe(2026);
		expect(v.limitCents).toBe(VAT_LIMIT_CENTS);
		expect(v.immediateLimitCents).toBe(VAT_LIMIT_IMMEDIATE_CENTS);
		expect(v.ratio).toBeCloseTo(0.375);
		expect(v.from).toBe('2026-01-01');
		expect(v.to).toBe('2026-12-31');
	});

	it('pod dolním prahem se plátcovství netýká nikoho', () => {
		const v = vatLimit([sum('1', '2026-03-01', '2026-03-15', 1_999_999)], today);
		expect(v.stage).toBe('below');
		expect(v.payerFrom).toBeUndefined();
	});

	it('obrat přesně na prahu ho ještě nepřekročil', () => {
		const v = vatLimit([sum('1', '2026-03-01', '2026-03-15', 2_000_000)], today);
		expect(v.stage).toBe('below');
		expect(v.payerFrom).toBeUndefined();
	});

	it('nad dolním prahem je plátcovství od 1. ledna dalšího roku', () => {
		const items = [sum('1', '2026-03-01', '2026-03-15', 2_000_000), sum('2', '2026-04-01', '2026-04-15', 1)];
		const v = vatLimit(items, today);
		expect(v.stage).toBe('next-year');
		expect(v.payerFrom).toBe('2027-01-01');
	});

	it('nad horním prahem je plátcovství dnem po dokladu, kterým se práh překročil', () => {
		const items = [
			sum('1', '2026-03-01', '2026-03-15', 2_000_000),
			sum('2', '2026-07-14', '2026-07-28', 536_501),
			sum('3', '2026-09-01', '2026-09-15', 100_000),
		];
		const v = vatLimit(items, today);
		expect(v.turnoverCents).toBe(263_650_100);
		expect(v.stage).toBe('immediate');
		expect(v.payerFrom).toBe('2026-07-15');
	});

	it('obrat přesně na horním prahu je pořád jen plátcovství od nového roku', () => {
		const v = vatLimit([sum('1', '2026-03-01', '2026-03-15', 2_536_500)], today);
		expect(v.stage).toBe('next-year');
		expect(v.payerFrom).toBe('2027-01-01');
	});

	it('den překročení nepočítá doklad, kterým obrat na práh jen dosedl', () => {
		const items = [sum('1', '2026-03-01', '2026-03-15', 2_536_500), sum('2', '2026-06-10', '2026-06-24', 1)];
		const v = vatLimit(items, today);
		expect(v.stage).toBe('immediate');
		expect(v.payerFrom).toBe('2026-06-11');
	});

	it('den překročení nezávisí na pořadí dokladů ve vstupu', () => {
		const items = [
			sum('3', '2026-09-01', '2026-09-15', 100_000),
			sum('2', '2026-07-14', '2026-07-28', 536_501),
			sum('1', '2026-03-01', '2026-03-15', 2_000_000),
		];
		expect(vatLimit(items, today).payerFrom).toBe('2026-07-15');
	});

	it('pozdější dobropis sníží obrat, ale nezruší vznik plátcovství', () => {
		const items = [sum('1', '2026-03-01', '2026-03-15', 2_600_000), sum('2', '2026-03-20', '2026-03-20', -700_000)];
		const v = vatLimit(items, today);
		expect(v.turnoverCents).toBe(190_000_000);
		expect(v.stage).toBe('immediate');
		expect(v.payerFrom).toBe('2026-03-02');
	});

	it('dobropis před překročením snižuje průběžný obrat', () => {
		const items = [
			sum('1', '2026-03-01', '2026-03-15', 2_000_000),
			sum('2', '2026-03-02', '2026-03-02', -500_000),
			sum('3', '2026-03-03', '2026-03-15', 900_000),
		];
		const v = vatLimit(items, today);
		expect(v.stage).toBe('next-year');
		expect(v.payerFrom).toBe('2027-01-01');
	});

	it('doklady ve stejný den posoudí společně bez ohledu na pořadí', () => {
		const invoice = sum('1', '2026-03-01', '2026-03-15', 2_600_000);
		const credit = sum('2', '2026-03-01', '2026-03-01', -700_000);
		for (const items of [
			[invoice, credit],
			[credit, invoice],
		]) {
			const v = vatLimit(items, today);
			expect(v.stage).toBe('below');
			expect(v.payerFrom).toBeUndefined();
		}
	});

	it('zachová loňské překročení i po pozdějším dobropisu', () => {
		const items = [sum('1', '2025-03-01', '2025-03-15', 2_600_000), sum('2', '2025-03-20', '2025-03-20', -700_000)];
		expect(vatLimit(items, today).previous).toEqual({
			year: 2025,
			turnoverCents: 190_000_000,
			stage: 'immediate',
			payerFrom: '2025-03-02',
		});
	});
});

describe('obrat vs. marže (přefakturace)', () => {
	function expense(id: string, czk: number): Expense {
		return {
			id,
			supplier: 'Sub',
			description: '',
			amountCents: Math.round(czk * 100),
			date: date('2026-03-01'),
		};
	}

	const invoices = [sum('20260001', '2026-03-10', '2026-03-24', 100_000)];
	const costs = [expense('a', 40_000), expense('b', 40_000)];

	it('obrat je z vydaných faktur, marže je obrat minus náklady', () => {
		const t = turnoverAndMargin(invoices, costs, 2026);
		expect(t.turnoverCents).toBe(100_000_00);
		expect(t.costsCents).toBe(80_000_00);
		expect(t.marginCents).toBe(20_000_00);
	});

	it('limit plátcovství se počítá z obratu, ne z marže', () => {
		const v = vatLimit(invoices, date('2026-05-29'));
		expect(v.turnoverCents).toBe(100_000_00);
		expect(v.turnoverCents).not.toBe(turnoverAndMargin(invoices, costs, 2026).marginCents);
	});

	it('počítá se jen zvolený rok', () => {
		const lastYear = [sum('20250001', '2025-03-10', '2025-03-24', 500_000)];
		const t = turnoverAndMargin([...invoices, ...lastYear], costs, 2026);
		expect(t.turnoverCents).toBe(100_000_00);
	});

	it('dobropis obrat snižuje', () => {
		const s = [...invoices, sum('20260002', '2026-04-01', '2026-04-01', -20_000)];
		expect(turnoverAndMargin(s, [], 2026).turnoverCents).toBe(80_000_00);
	});

	it('bez nákladů se marže rovná obratu', () => {
		expect(turnoverAndMargin(invoices, [], 2026).marginCents).toBe(100_000_00);
	});
});

describe('výdaj v nákladech podle roku', () => {
	function cost(czk: number, on: string): Expense {
		return {
			id: on,
			supplier: 'S',
			description: '',
			amountCents: Math.round(czk * 100),
			date: date(on),
		};
	}
	const invoices = [sum('20260001', '2026-03-10', '2026-03-24', 200_000)];

	it('předplatné zapsané jednou se počítá jednou, ne dvanáctkrát', () => {
		const t = turnoverAndMargin(invoices, [cost(1_000, '2026-01-01')], 2026);
		expect(t.costsCents).toBe(1_000_00);
		expect(t.marginCents).toBe(200_000_00 - 1_000_00);
	});

	it('výdaj z minulého roku do letošních nákladů nepatří', () => {
		expect(turnoverAndMargin(invoices, [cost(12_000, '2025-06-10')], 2026).costsCents).toBe(0);
	});

	it('výdaj datovaný později v roce patří do nákladů toho roku', () => {
		expect(turnoverAndMargin(invoices, [cost(1_000, '2026-12-01')], 2026).costsCents).toBe(1_000_00);
	});
});

describe('doklady mimo zobrazený rozsah', () => {
	function fact(number: string, issued: string, czk = 1000): InvoiceSummary {
		return {
			number,
			customer: 'X',
			issueDate: date(issued),
			dueDate: date(issued),
			totalCents: czk * 100,
			variableSymbol: number,
			documentType: 1,
			originalInvoice: '',
			sentAt: null,
			usageLines: [],
			path: `${number}.pdf`,
		};
	}

	it('čtvrtletní graf doklad mimo rozsah nepřičte', () => {
		const s = periodSeries([fact('a', '2015-01-15')], 'quarter', date('2026-08-21'));

		expect(s.every((b) => b.salesCents === 0)).toBe(true);
	});

	it('roční graf doklad starší než deset let nepřičte', () => {
		const s = periodSeries([fact('a', '2000-01-15')], 'year', date('2026-08-21'));

		expect(s.every((b) => b.salesCents === 0)).toBe(true);
	});

	it('doklad uvnitř rozsahu se do svého sloupce přičte', () => {
		const s = periodSeries([fact('a', '2026-08-15', 500)], 'quarter', date('2026-08-21'));

		expect(s.reduce((total, b) => total + b.salesCents, 0)).toBe(500_00);
	});
});

describe('vatLevelOf', () => {
	it('do 70 % je klid', () => {
		expect(vatLevelOf(0)).toBe('ok');
		expect(vatLevelOf(0.6999)).toBe('ok');
	});

	it('od 70 % varuje, od 90 % je to naléhavé', () => {
		expect(vatLevelOf(0.7)).toBe('warn');
		expect(vatLevelOf(0.8999)).toBe('warn');
		expect(vatLevelOf(0.9)).toBe('danger');
	});

	it('překročený limit zůstává nejvyšší úrovní, ne nedefinovanou', () => {
		expect(vatLevelOf(1)).toBe('danger');
		expect(vatLevelOf(3.5)).toBe('danger');
	});
});
