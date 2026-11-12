import {
	DUE_SOON_DAYS,
	RECENT_INVOICES,
	SERIES_MONTHS,
	SERIES_QUARTERS,
	SERIES_YEARS,
	VAT_DANGER_RATIO,
	VAT_LIMIT_CENTS,
	VAT_LIMIT_IMMEDIATE_CENTS,
	VAT_WARN_RATIO,
} from '~/constants/dashboard';
import { DocumentKind } from '~/constants/invoice';
import {
	monthOf,
	yearOf,
	addDays,
	endOfYear,
	periodOf,
	periodShortLabel,
	shiftMonth,
	shortYear,
	startOfYear,
} from '~/utils/date';
import { expensesTotalCents } from '~/utils/expenses';
import { invoiceState } from '~/utils/invoice';
import { ledgerOf, settlementOf } from '~/utils/payments';

import type { Expense } from '~/schemas/expenses';
import type { InvoiceSummary } from '~/schemas/invoices';
import type { Payments } from '~/schemas/payments';
import type { DateString } from '~/utils/date';

export interface DashboardStats {
	overdueCount: number;
	unpaid: InvoiceSummary[];
	recent: InvoiceSummary[];
}

type WithDueDate = InvoiceSummary & { dueDate: DateString };

function hasDueDate(i: InvoiceSummary): i is WithDueDate {
	return i.dueDate !== undefined;
}

export function dashboardStats(items: InvoiceSummary[], payments: Payments, today: DateString): DashboardStats {
	let overdueCount = 0;
	const unpaid: InvoiceSummary[] = [];
	const ledger = ledgerOf(items, payments);

	for (const i of items) {
		const settlement = settlementOf(i, ledger);
		if (settlement.outstandingCents === 0) continue;
		unpaid.push(i);
		if (invoiceState(i, settlement, today) === 'overdue') overdueCount++;
	}

	return {
		overdueCount,
		unpaid,
		recent: items.slice(0, RECENT_INVOICES),
	};
}

export function dueSoon(
	items: InvoiceSummary[],
	payments: Payments,
	today: DateString,
	days = DUE_SOON_DAYS,
): InvoiceSummary[] {
	const horizon = addDays(today, days);
	const ledger = ledgerOf(items, payments);
	return items
		.filter((i) => i.documentType === DocumentKind.Invoice)
		.filter((i) => settlementOf(i, ledger).outstandingCents !== 0)
		.filter(hasDueDate)
		.filter((i) => i.dueDate >= today && i.dueDate <= horizon)
		.toSorted((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export type PeriodRange = 'month' | 'quarter' | 'year';

export interface SeriesBucket {
	key: string;
	label: string;
	salesCents: number;
}

export function periodSeries(items: InvoiceSummary[], range: PeriodRange, today: DateString): SeriesBucket[] {
	const year = yearOf(today);

	const buckets: SeriesBucket[] = [];
	const index = new Map<string, SeriesBucket>();

	if (range === 'month') {
		for (let i = SERIES_MONTHS - 1; i >= 0; i--) {
			const period = shiftMonth(periodOf(today), -i);
			const b: SeriesBucket = {
				key: period,
				label: periodShortLabel(period),
				salesCents: 0,
			};
			buckets.push(b);
			index.set(b.key, b);
		}
		for (const it of items) {
			const b = index.get(periodOf(it.issueDate));
			if (b) b.salesCents += it.totalCents;
		}
	} else if (range === 'quarter') {
		const curQ = Math.floor((monthOf(today) - 1) / 3);
		for (let i = SERIES_QUARTERS - 1; i >= 0; i--) {
			const total = year * 4 + curQ - i;
			const y = Math.floor(total / 4);
			const q = (total % 4) + 1;
			const key = `${y}-Q${q}`;
			const b: SeriesBucket = {
				key,
				label: `Q${q}/${shortYear(y)}`,
				salesCents: 0,
			};
			buckets.push(b);
			index.set(key, b);
		}
		for (const it of items) {
			const q = Math.floor((monthOf(it.issueDate) - 1) / 3) + 1;
			const b = index.get(`${yearOf(it.issueDate)}-Q${q}`);
			if (b) b.salesCents += it.totalCents;
		}
	} else {
		let minYear = year;
		for (const it of items) {
			if (yearOf(it.issueDate) < minYear) minYear = yearOf(it.issueDate);
		}
		minYear = Math.max(minYear, year - SERIES_YEARS + 1);
		for (let y = minYear; y <= year; y++) {
			const key = String(y);
			const b: SeriesBucket = {
				key,
				label: key,
				salesCents: 0,
			};
			buckets.push(b);
			index.set(key, b);
		}
		for (const it of items) {
			const b = index.get(String(yearOf(it.issueDate)));
			if (b) b.salesCents += it.totalCents;
		}
	}

	return buckets;
}

export interface Balance {
	totalCents: number;
	paidCents: number;
	unpaidCents: number;
	purchaseCents: number;
}

export function balance(
	items: InvoiceSummary[],
	payments: Payments,
	year: number | null,
	expenses: Expense[] = [],
): Balance {
	let totalCents = 0;
	let paidCents = 0;
	let unpaidCents = 0;
	const ledger = ledgerOf(items, payments);
	for (const it of items) {
		if (year !== null && yearOf(it.issueDate) !== year) continue;
		const settlement = settlementOf(it, ledger);
		totalCents += it.totalCents;
		paidCents += settlement.paidCents;
		unpaidCents += settlement.outstandingCents;
	}
	return {
		totalCents,
		paidCents,
		unpaidCents,
		purchaseCents: expensesTotalCents(expenses, (date) => year === null || yearOf(date) === year),
	};
}

export interface CustomerTotal {
	customer: string;
	amountCents: number;
}

export function topDebtors(items: InvoiceSummary[], payments: Payments, limit = 3): CustomerTotal[] {
	const byCustomer = new Map<string, number>();
	const ledger = ledgerOf(items, payments);
	for (const it of items) {
		const { outstandingCents } = settlementOf(it, ledger);
		byCustomer.set(it.customer, (byCustomer.get(it.customer) ?? 0) + outstandingCents);
	}
	return rankCustomers(byCustomer, limit);
}

export function topCustomers(items: InvoiceSummary[], limit = 3): CustomerTotal[] {
	const byCustomer = new Map<string, number>();
	for (const it of items) {
		byCustomer.set(it.customer, (byCustomer.get(it.customer) ?? 0) + it.totalCents);
	}
	return rankCustomers(byCustomer, limit);
}

function rankCustomers(byCustomer: Map<string, number>, limit: number): CustomerTotal[] {
	return [...byCustomer.entries()]
		.map(([customer, amountCents]) => ({
			customer,
			amountCents,
		}))
		.filter((c) => c.amountCents > 0)
		.toSorted((a, b) => b.amountCents - a.amountCents)
		.slice(0, limit);
}

export type VatStage = 'below' | 'next-year' | 'immediate';

export interface VatYear {
	year: number;
	turnoverCents: number;
	stage: VatStage;
	payerFrom: DateString | undefined;
}

export interface VatLimitStats extends VatYear {
	limitCents: number;
	immediateLimitCents: number;
	ratio: number;
	from: DateString;
	to: DateString;
	/** Loňský rok: po překročení limitu je uživatel plátcem i tehdy, když letos zatím nic nevyfakturoval. */
	previous: VatYear;
}

function vatYear(items: InvoiceSummary[], day: DateString): VatYear {
	const year = yearOf(day);
	const inYear = items.filter((i) => yearOf(i.issueDate) === year);
	const turnoverCents = inYear.reduce((sum, i) => sum + i.totalCents, 0);
	const stage = stageOf(turnoverCents);
	return {
		year,
		turnoverCents,
		stage,
		payerFrom: payerFrom(stage, crossingDay(inYear), endOfYear(day)),
	};
}

// Rok se bere celý, ne jen po dnešek: doklad s pozdějším datem do obratu patří a při hlídání limitu
// se nesmí ztratit.
export function vatLimit(items: InvoiceSummary[], today: DateString): VatLimitStats {
	const current = vatYear(items, today);
	return {
		...current,
		limitCents: VAT_LIMIT_CENTS,
		immediateLimitCents: VAT_LIMIT_IMMEDIATE_CENTS,
		ratio: current.turnoverCents / VAT_LIMIT_CENTS,
		from: startOfYear(today),
		to: endOfYear(today),
		previous: vatYear(items, addDays(startOfYear(today), -1)),
	};
}

function stageOf(turnoverCents: number): VatStage {
	if (turnoverCents > VAT_LIMIT_IMMEDIATE_CENTS) return 'immediate';
	if (turnoverCents > VAT_LIMIT_CENTS) return 'next-year';
	return 'below';
}

function payerFrom(
	stage: VatStage,
	crossed: DateString | undefined,
	lastDayOfYear: DateString,
): DateString | undefined {
	if (stage === 'below') return undefined;
	if (stage === 'immediate') return crossed;
	return addDays(lastDayOfYear, 1);
}

// Obrat se řadí podle data vystavení, jako v iDokladu a Fakturoidu
// (docs/02-TECHNOLOGIE.md, „Limit plátcovství DPH").
function crossingDay(inYear: InvoiceSummary[]): DateString | undefined {
	let running = 0;
	for (const i of inYear.toSorted((a, b) => a.issueDate.localeCompare(b.issueDate))) {
		running += i.totalCents;
		if (running > VAT_LIMIT_IMMEDIATE_CENTS) return addDays(i.issueDate, 1);
	}
	return undefined;
}

export type VatLevel = 'ok' | 'warn' | 'danger';

export function vatLevelOf(ratio: number): VatLevel {
	if (ratio >= VAT_DANGER_RATIO) return 'danger';
	if (ratio >= VAT_WARN_RATIO) return 'warn';
	return 'ok';
}

export interface TurnoverMargin {
	turnoverCents: number;
	costsCents: number;
	marginCents: number;
}

export function turnoverAndMargin(items: InvoiceSummary[], expenses: Expense[], year: number): TurnoverMargin {
	const turnoverCents = items.filter((i) => yearOf(i.issueDate) === year).reduce((s, i) => s + i.totalCents, 0);
	const costsCents = expensesTotalCents(expenses, (date) => yearOf(date) === year);
	return {
		turnoverCents,
		costsCents,
		marginCents: turnoverCents - costsCents,
	};
}
