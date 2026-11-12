import { parseDate, parsePeriod, type DateString, type YearMonthString } from '~/utils/date';

/** Datum ve fixture musí projít stejným parserem jako vstup aplikace. */
export function date(value: string): DateString {
	const parsed = parseDate(value);
	if (!parsed) throw new Error(`Neplatné datum testu: ${value}`);
	return parsed;
}

export function period(value: string): YearMonthString {
	const parsed = parsePeriod(value);
	if (!parsed) throw new Error(`Neplatné období testu: ${value}`);
	return parsed;
}
