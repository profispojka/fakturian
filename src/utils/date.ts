import {
	CalendarDate,
	DateFormatter,
	getLocalTimeZone,
	parseAbsolute,
	parseDate as calendarDate,
	toCalendarDate as dayOf,
	today as localToday,
} from '@internationalized/date';

import { LOCALE } from '~/constants/locales';

declare const dateBrand: unique symbol;
declare const periodBrand: unique symbol;

type CalendarString = string & {
	readonly [
		K in
			| 'split'
			| 'slice'
			| 'substring'
			| 'substr'
			| 'padStart'
			| 'padEnd'
			| 'replace'
			| 'replaceAll'
			| 'concat'
			| 'charAt'
			| 'charCodeAt'
			| 'at'
	]: never;
};

export type DateString = CalendarString & { readonly [dateBrand]: true };

export type YearMonthString = CalendarString & { readonly [periodBrand]: true };

const DATE_YEAR = /^[1-9]/;

// Rok od 1000 zrcadlí rok čerpání v `desktop/invoice/model.ts`: co projde tady a neprojde tam, by
// doklad neuložilo.
const PERIOD_SHAPE = /^[1-9]\d{3}-(0[1-9]|1[0-2])$/;

export const MIN_YEAR = 1000;
export const MAX_YEAR = 9999;
export const MIN_DATE = new CalendarDate(MIN_YEAR, 1, 1);
export const MAX_DATE = new CalendarDate(MAX_YEAR, 12, 31);

export function toCalendarDate(value: DateString | undefined): CalendarDate | undefined {
	if (value === undefined) return undefined;
	return calendarDate(value);
}

export function fromCalendarDate(value: CalendarDate): DateString;
export function fromCalendarDate(value: null | undefined): undefined;
export function fromCalendarDate(value: CalendarDate | null | undefined): DateString | undefined;
export function fromCalendarDate(value: CalendarDate | null | undefined): DateString | undefined {
	return parseDate(value?.toString());
}

function monthStart(period: YearMonthString): CalendarDate {
	return calendarDate(`${period}-01`);
}

export function parseDate(text: unknown): DateString | undefined {
	if (!isDateString(text)) return undefined;
	return text;
}

export function isDateString(value: unknown): value is DateString {
	if (typeof value !== 'string' || !DATE_YEAR.test(value)) return false;
	try {
		calendarDate(value);
	} catch {
		return false;
	}
	return true;
}

export function parseIsdocDate(text: string): DateString | undefined {
	const match = /^(\d{4}-\d{2}-\d{2})(?:Z|[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00)?$/.exec(text.trim());
	return parseDate(match?.[1]);
}

export function parsePeriod(text: unknown): YearMonthString | undefined {
	const value = typeof text === 'string' ? text.trim() : text;
	if (!isYearMonthString(value)) return undefined;
	return value;
}

function isYearMonthString(value: unknown): value is YearMonthString {
	return typeof value === 'string' && PERIOD_SHAPE.test(value);
}

// Kalendář listuje šipkami donekonečna a musí se zastavit tam, kde by období přestalo projít tvarem
// `RRRR-MM`.
export function canShiftMonth(period: YearMonthString, months: number): boolean {
	const month = monthStart(period);
	const next = month.year * 12 + month.month - 1 + months;
	return next >= MIN_YEAR * 12 && next < (MAX_YEAR + 1) * 12;
}

// Výsledky výpočtů musí splňovat stejný rozsah jako načítaná data.
function inRange<T extends DateString | YearMonthString>(text: string, isValid: (value: unknown) => value is T): T {
	if (!isValid(text)) throw new RangeError(`Datum ${text} je mimo rozsah let ${MIN_YEAR}–${MAX_YEAR}.`);
	return text;
}

function dateString(value: CalendarDate): DateString {
	return inRange(value.toString(), isDateString);
}

function periodString(value: CalendarDate): YearMonthString {
	return inRange(value.toString().slice(0, 7), isYearMonthString);
}

export function yearOf(date: DateString): number {
	return calendarDate(date).year;
}

export function monthOf(date: DateString): number {
	return calendarDate(date).month;
}

export function startOfYear(date: DateString): DateString {
	return dateString(new CalendarDate(yearOf(date), 1, 1));
}

export function endOfYear(date: DateString): DateString {
	return dateString(new CalendarDate(yearOf(date), 12, 31));
}

export function dateIn(year: number, month: number, day: number): DateString {
	return dateString(new CalendarDate(year, month, day));
}

export function monthsBetween(from: YearMonthString, to: YearMonthString): number {
	const start = monthStart(from);
	const end = monthStart(to);
	return (end.year - start.year) * 12 + end.month - start.month;
}

export function today(): DateString {
	return dateString(localToday(getLocalTimeZone()));
}

// Okamžik z backendu je v UTC; den se počítá v místní zóně stejně jako `today()`.
export function localDateOf(instant: string): DateString {
	return dateString(dayOf(parseAbsolute(instant, getLocalTimeZone())));
}

export function addDays(date: DateString, days: number): DateString {
	const start = calendarDate(date);
	if (days < MIN_DATE.compare(start) || days > MAX_DATE.compare(start))
		throw new RangeError('Datum je mimo rozsah RRRR-MM-DD.');
	return dateString(start.add({ days }));
}

// Rozdíl dvou kalendářních dat, ne dvou okamžiků — letní čas do něj nemá co mluvit.
export function daysBetween(from: DateString, to: DateString): number {
	return calendarDate(to).compare(calendarDate(from));
}

export function periodOf(date: DateString): YearMonthString {
	return periodString(calendarDate(date));
}

export function shiftMonth(period: YearMonthString, delta: number): YearMonthString {
	if (!canShiftMonth(period, delta)) throw new RangeError('Období je mimo rozsah RRRR-MM.');
	return periodString(monthStart(period).add({ months: delta }));
}

// Jediné místo, kde se datum formátuje: popisek filtru se s daty v tabulce porovnává okem a musí
// mít stejný tvar.
// Stryker disable next-line ObjectLiteral: Bez voleb vyjde ve výchozím formátu a zóně appky totéž; UTC hlídá den jen západně od Greenwiche.
const DATE = {
	day: 'numeric',
	month: 'numeric',
	year: 'numeric',
	timeZone: 'UTC',
} satisfies Intl.DateTimeFormatOptions;

const DAY_MONTH = {
	day: 'numeric',
	month: 'numeric',
	timeZone: 'UTC',
} satisfies Intl.DateTimeFormatOptions;

export function formatDate(date: DateString | undefined): string {
	if (!date) return '—';
	return new DateFormatter(LOCALE, DATE).format(calendarDate(date).toDate('UTC'));
}

export function formatDayMonth(date: DateString | undefined): string {
	if (!date) return '—';
	return new DateFormatter(LOCALE, DAY_MONTH).format(calendarDate(date).toDate('UTC'));
}

const MONTH = {
	month: 'long',
	timeZone: 'UTC',
} satisfies Intl.DateTimeFormatOptions;
const MONTH_SHORT = {
	month: 'short',
	timeZone: 'UTC',
} satisfies Intl.DateTimeFormatOptions;
const YEAR_SHORT = {
	year: '2-digit',
	timeZone: 'UTC',
} satisfies Intl.DateTimeFormatOptions;

// `CalendarDate` měsíc mimo 1–12 mlčky ořízne, takže třináctý by vyšel jako prosinec.
function formatMonth(options: Intl.DateTimeFormatOptions, m: number): string {
	if (m < 1 || m > 12) return '';
	return new DateFormatter(LOCALE, options).format(new CalendarDate(2000, m, 1).toDate('UTC'));
}

export function monthName(m: number): string {
	return formatMonth(MONTH, m);
}

export function shortMonthName(m: number): string {
	return formatMonth(MONTH_SHORT, m);
}

export function shortYear(year: number): string {
	return new DateFormatter(LOCALE, YEAR_SHORT).format(new CalendarDate(year, 1, 1).toDate('UTC'));
}

export function periodShortLabel(period: YearMonthString): string {
	return shortMonthName(monthStart(period).month);
}
