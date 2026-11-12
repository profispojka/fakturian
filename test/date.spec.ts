import { assert, integer, oneof, property, tuple } from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	toCalendarDate,
	fromCalendarDate,
	startOfYear,
	endOfYear,
	dateIn,
	monthOf,
	monthsBetween,
	yearOf,
	addDays,
	daysBetween,
	formatDate,
	formatDayMonth,
	canShiftMonth,
	isDateString,
	localDateOf,
	monthName,
	parseDate,
	parseIsdocDate,
	parsePeriod,
	periodOf,
	periodShortLabel,
	shiftMonth,
	shortMonthName,
	shortYear,
	today,
} from '~/utils/date';

import { date, period } from './setup/dates';

import type { DateString } from '~/utils/date';

describe('dnešek', () => {
	// Půl hodiny po místní půlnoci: v UTC je ještě včerejšek, takže by `toISOString().slice(0, 10)` dalo
	// jiný den než appka.
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime('2031-01-01T00:30');
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('today je dnešní datum v místní zóně', () => {
		expect(String(today())).toBe('2031-01-01');
		expect(yearOf(today())).toBe(2031);
	});
});

describe('parseDate', () => {
	it('datum a období sdílejí rozsah roků 1000–9999', () => {
		expect(parseDate('0000-01-01')).toBeUndefined();
		expect(parseDate('0999-12-31')).toBeUndefined();
		expect(parseDate('1000-01-01')).toBe('1000-01-01');
		expect(parseDate('9999-12-31')).toBe('9999-12-31');
		expect(parseDate('10000-01-01')).toBeUndefined();
	});
	it('bere jen RRRR-MM-DD, které v kalendáři existuje', () => {
		expect(String(parseDate('2026-05-29'))).toBe('2026-05-29');
		expect(String(parseDate('2028-02-29'))).toBe('2028-02-29');
	});

	it('den nebo měsíc, který není, neprojde', () => {
		expect(parseDate('2026-02-30')).toBeUndefined();
		expect(parseDate('2026-13-01')).toBeUndefined();
		expect(parseDate('2026-00-10')).toBeUndefined();
	});

	it('jiný tvar než RRRR-MM-DD se odmítne, i když z něj jde datum vyčíst', () => {
		for (const bad of ['20260529', '2026-05-29T10:00', '2026-5-9', '29-05-2026', '29.5.2026', ' 2026-05-29', '']) {
			expect(parseDate(bad), bad).toBeUndefined();
		}
	});

	it('chybějící vstup je chybějící datum, ne pád', () => {
		expect(parseDate(null)).toBeUndefined();
		expect(parseDate(undefined)).toBeUndefined();
	});

	it('nepřevádí cizí objekty na datum ani nevolá jejich metody', () => {
		const toString = vi.fn(() => '2026-05-29');
		expect(parseDate({ toString })).toBeUndefined();
		expect(toString).not.toHaveBeenCalled();
	});
});

describe('parseIsdocDate', () => {
	it.each(['', 'Z', '+00:00', '-00:00', '+02:00', '-05:30', '+13:59', '-13:59', '+14:00', '-14:00'])(
		'zachová kalendářní den s posunem „%s“',
		(offset) => {
			expect(String(parseIsdocDate(`2028-02-29${offset}`))).toBe('2028-02-29');
		},
	);

	it('toleruje krajní mezery XML data', () => {
		expect(String(parseIsdocDate(' 2026-03-01Z\n'))).toBe('2026-03-01');
	});

	it.each([
		'',
		'2026-02-30Z',
		'2026-13-01+02:00',
		'2026-03-01+14:01',
		'2026-03-01-14:01',
		'2026-03-01+15:00',
		'2026-03-01+02:60',
		'2026-03-01+2:00',
		'2026-03-01+0200',
		'2026-03-01z',
		'2026-03-01Zjunk',
		'2026-03-01T00:00:00Z',
		'20260301Z',
	])('odmítne neplatné datum nebo posun „%s“', (value) => {
		expect(parseIsdocDate(value)).toBeUndefined();
	});
});

describe('parsePeriod', () => {
	it('platné období projde, i s krajními mezerami z textového pole', () => {
		expect(String(parsePeriod('2026-12'))).toBe('2026-12');
		expect(String(parsePeriod('2026-01'))).toBe('2026-01');
		expect(String(parsePeriod(' 2026-05 '))).toBe('2026-05');
	});

	it('překlep se odmítne, ne aby tiše zmizel z dokladu', () => {
		for (const bad of ['2026-13', '2026-00', '2026-1', '26-01', '2026/12', 'prosinec', '', null, undefined]) {
			expect(parsePeriod(bad), String(bad)).toBeUndefined();
		}
	});

	it('nepřevádí cizí objekty na období ani nevolá jejich metody', () => {
		const toString = vi.fn(() => '2026-05');
		expect(parsePeriod({ toString })).toBeUndefined();
		expect(toString).not.toHaveBeenCalled();
	});

	it('celé datum ani tvar bez pomlčky období není', () => {
		expect(parsePeriod('2026-05-15')).toBeUndefined();
		expect(parsePeriod('202605')).toBeUndefined();
	});

	it('rok pod 1000 neprojde, stejně jako v backendu', () => {
		expect(parsePeriod('0999-05')).toBeUndefined();
		expect(String(parsePeriod('1000-01'))).toBe('1000-01');
	});
});

describe('rozpoznání hodnoty', () => {
	it('isDateString pozná platný datový string, ne období', () => {
		expect(isDateString(date('2026-05-29'))).toBe(true);
		expect(isDateString('2026-05-29')).toBe(true);
		expect(isDateString(period('2026-05'))).toBe(false);
		expect(isDateString(undefined)).toBe(false);
	});
});

describe('části data', () => {
	it('rok, měsíc a období se odvozují přes kalendář', () => {
		const d = date('2026-05-29');
		expect(yearOf(d)).toBe(2026);
		expect(monthOf(d)).toBe(5);
		expect(String(periodOf(d))).toBe('2026-05');
	});
});

describe('addDays', () => {
	it('přičte dny přes hranici měsíce', () => {
		expect(String(addDays(date('2026-05-29'), 14))).toBe('2026-06-12');
	});

	it('přičte dny přes přestupný den i hranici roku', () => {
		expect(String(addDays(date('2028-02-28'), 1))).toBe('2028-02-29');
		expect(String(addDays(date('2026-12-30'), 3))).toBe('2027-01-02');
		expect(String(addDays(date('2026-03-01'), -1))).toBe('2026-02-28');
	});
});

describe('localDateOf', () => {
	it('den okamžiku počítá v místní zóně, ne v UTC', () => {
		expect(localDateOf('2026-09-06T22:30:00Z')).toBe('2026-09-07');
		expect(localDateOf('2026-12-31T22:59:59.999999999Z')).toBe('2026-12-31');
		expect(localDateOf('2026-12-31T23:00:00Z')).toBe('2027-01-01');
	});
});

describe('startOfYear a endOfYear', () => {
	it('vrátí 1. leden a 31. prosinec roku, do kterého datum patří', () => {
		expect(startOfYear(date('2026-05-29'))).toBe('2026-01-01');
		expect(endOfYear(date('2026-05-29'))).toBe('2026-12-31');
	});

	it('krajní dny roku zůstávají ve svém roce', () => {
		expect(startOfYear(date('2026-01-01'))).toBe('2026-01-01');
		expect(endOfYear(date('2026-12-31'))).toBe('2026-12-31');
	});

	it('přestupný rok nemění ani jeden konec', () => {
		expect(startOfYear(date('2028-02-29'))).toBe('2028-01-01');
		expect(endOfYear(date('2028-02-29'))).toBe('2028-12-31');
	});
});

describe('dateIn', () => {
	it('složí datum z roku, měsíce a dne s nulami na začátku', () => {
		expect(dateIn(2026, 3, 2)).toBe('2026-03-02');
	});

	it('rok mimo rozsah odmítne', () => {
		expect(() => dateIn(999, 12, 31)).toThrow(new RangeError('Datum 0999-12-31 je mimo rozsah let 1000–9999.'));
	});
});

describe('daysBetween', () => {
	it('celé dny mezi daty, dozadu záporně', () => {
		expect(daysBetween(date('2026-05-01'), date('2026-05-15'))).toBe(14);
		expect(daysBetween(date('2026-05-15'), date('2026-05-01'))).toBe(-14);
		expect(daysBetween(date('2026-05-15'), date('2026-05-15'))).toBe(0);
	});

	it('počítá kalendářní dny, ne 24hodinové úseky', () => {
		// Přechod na letní čas (29. 3. 2026) i přestupný den musí vyjít celý.
		expect(daysBetween(date('2026-03-28'), date('2026-03-30'))).toBe(2);
		expect(daysBetween(date('2024-02-28'), date('2024-03-01'))).toBe(2);
	});
});

describe('fakturované období', () => {
	describe('posun o měsíce', () => {
		it('posouvá dopředu i dozadu uvnitř roku', () => {
			expect(String(shiftMonth(period('2026-05'), 2))).toBe('2026-07');
			expect(String(shiftMonth(period('2026-05'), -2))).toBe('2026-03');
			expect(String(shiftMonth(period('2026-05'), 0))).toBe('2026-05');
		});

		it('přechází přes hranici roku v obou směrech', () => {
			expect(String(shiftMonth(period('2026-01'), -1))).toBe('2025-12');
			expect(String(shiftMonth(period('2026-12'), 1))).toBe('2027-01');
			expect(String(shiftMonth(period('2026-06'), -24))).toBe('2024-06');
			expect(String(shiftMonth(period('2026-06'), 24))).toBe('2028-06');
		});
	});

	it('canShiftMonth ohraničuje období, které projde tvarem RRRR-MM', () => {
		expect(canShiftMonth(period('1000-01'), 0)).toBe(true);
		expect(canShiftMonth(period('1000-01'), -1)).toBe(false);
		expect(canShiftMonth(period('9999-12'), 0)).toBe(true);
		expect(canShiftMonth(period('9999-12'), 1)).toBe(false);
	});
});

describe('názvy měsíců', () => {
	it('měsíc má český název, mimo rozsah je prázdno', () => {
		expect(monthName(1)).toBe('leden');
		expect(monthName(12)).toBe('prosinec');
		expect(monthName(0)).toBe('');
		expect(monthName(13)).toBe('');
	});

	it('zkratka do osy grafu, mimo rozsah prázdno', () => {
		expect(shortMonthName(1)).toBe('led');
		expect(shortMonthName(12)).toBe('pro');
		expect(shortMonthName(0)).toBe('');
		expect(shortMonthName(13)).toBe('');
	});
});

describe('shortYear', () => {
	it('rok se do popisku kvartálu píše posledními dvěma číslicemi', () => {
		expect(shortYear(2026)).toBe('26');
		expect(shortYear(2000)).toBe('00');
		expect(shortYear(1999)).toBe('99');
	});
});

describe('periodShortLabel', () => {
	it('období se do osy grafu píše zkratkou', () => {
		expect(periodShortLabel(period('2026-01'))).toBe('led');
		expect(periodShortLabel(period('2026-12'))).toBe('pro');
	});
});

describe('formatDate / formatDayMonth', () => {
	it('datum se píše číselně a s mezerami', () => {
		expect(formatDate(date('2026-03-14'))).toBe('14. 3. 2026');
		expect(formatDayMonth(date('2026-07-14'))).toBe('14. 7.');
	});

	it('chybějící datum je pomlčka, ne prázdno', () => {
		expect(formatDate(undefined)).toBe('—');
		expect(formatDayMonth(undefined)).toBe('—');
	});
});

describe('datum na hranici Nuxt UI', () => {
	it('převádí datum tam i zpět bez změny kalendářního dne', () => {
		const value = toCalendarDate(date('2028-02-29'));
		expect(value?.year).toBe(2028);
		expect(value?.month).toBe(2);
		expect(value?.day).toBe(29);
		expect(fromCalendarDate(value)).toBe('2028-02-29');
	});
	it('prázdné hodnoty zůstávají prázdné', () => {
		expect(toCalendarDate(undefined)).toBeUndefined();
		expect(fromCalendarDate(undefined)).toBeUndefined();
		expect(fromCalendarDate(null)).toBeUndefined();
	});
});

describe('datum na drátě', () => {
	it('JSON.stringify zapíše datum i období ve tvaru hranice', () => {
		expect(
			JSON.stringify({
				date: date('2026-03-05'),
				period: period('2026-03'),
			}),
		).toBe('{"date":"2026-03-05","period":"2026-03"}');
	});
});

describe('řetězcový model a kalendářní výpočty', () => {
	it('povolí přesný posun na oba krajní dny', () => {
		const span = daysBetween(date('1000-01-01'), date('9999-12-31'));
		expect(addDays(date('1000-01-01'), span)).toBe('9999-12-31');
		expect(addDays(date('9999-12-31'), -span)).toBe('1000-01-01');
		expect(() => addDays(date('1000-01-01'), span + 1)).toThrow(RangeError);
		expect(() => addDays(date('9999-12-31'), -span - 1)).toThrow(RangeError);
	});
	it('nepřijme prefixy ani objekt napodobující datum', () => {
		expect(parseDate('+002026-05-29')).toBeUndefined();
		expect(parsePeriod('+002026-05')).toBeUndefined();
		expect(parseIsdocDate('text2026-03-01Z')).toBeUndefined();
		expect(
			isDateString({
				year: 2026,
				month: 5,
				day: 29,
				toString: () => '2026-05-29',
			}),
		).toBe(false);
	});
	it('přesně formátuje všechny měsíce pro popisky a grafy', () => {
		const months = Array.from({ length: 12 }, (_, i) => i + 1);
		expect(months.map(monthName)).toEqual([
			'leden',
			'únor',
			'březen',
			'duben',
			'květen',
			'červen',
			'červenec',
			'srpen',
			'září',
			'říjen',
			'listopad',
			'prosinec',
		]);
		expect(months.map(shortMonthName)).toEqual([
			'led',
			'úno',
			'bře',
			'dub',
			'kvě',
			'čvn',
			'čvc',
			'srp',
			'zář',
			'říj',
			'lis',
			'pro',
		]);
	});
	it('hlásí srozumitelně překročení rozsahu data a období', () => {
		expect(() => addDays(date('9999-12-31'), 1)).toThrow(new RangeError('Datum je mimo rozsah RRRR-MM-DD.'));
		expect(() => addDays(date('1000-01-01'), -1)).toThrow(new RangeError('Datum je mimo rozsah RRRR-MM-DD.'));
		expect(() => shiftMonth(period('9999-12'), 1)).toThrow(new RangeError('Období je mimo rozsah RRRR-MM.'));
	});
	it('kopie vnořeného modelu zachová datum i období a oddělí úpravy', () => {
		const original = {
			address: {
				city: 'Praha',
			},
			entries: [
				{
					startDate: date('2028-02-29'),
					month: period('2028-02'),
					lines: [{ quantity: 1 }],
				},
			],
		};
		const copy = structuredClone(original);
		expect(copy).toEqual({
			address: {
				city: 'Praha',
			},
			entries: [
				{
					startDate: '2028-02-29',
					month: '2028-02',
					lines: [{ quantity: 1 }],
				},
			],
		});
		copy.address.city = 'Brno';
		copy.entries[0]!.lines[0]!.quantity = 2;
		copy.entries[0]!.startDate = addDays(copy.entries[0]!.startDate, 1);
		expect(original.address.city).toBe('Praha');
		expect(original.entries[0]!.lines).toEqual([{ quantity: 1 }]);
		expect(original.entries[0]!.startDate).toBe('2028-02-29');
		expect(copy.entries[0]!.startDate).toBe('2028-03-01');
	});
	it('odvodí části data přes kalendář', () => {
		expect(yearOf(date('2028-02-29'))).toBe(2028);
		expect(monthOf(date('2028-02-29'))).toBe(2);
	});
	it('počítá měsíce přes přechod roku v obou směrech', () => {
		expect(monthsBetween(period('2025-12'), period('2027-02'))).toBe(14);
		expect(monthsBetween(period('2027-02'), period('2025-12'))).toBe(-14);
		expect(monthsBetween(period('2026-02'), period('2026-02'))).toBe(0);
	});
	it('výpočet nesmí vytvořit řetězec mimo povolený rozsah', () => {
		expect(addDays(date('1000-01-01'), 0)).toBe('1000-01-01');
		expect(addDays(date('9999-12-31'), 0)).toBe('9999-12-31');
		expect(shiftMonth(period('1000-01'), 0)).toBe('1000-01');
		expect(shiftMonth(period('9999-12'), 0)).toBe('9999-12');
		expect(() => addDays(date('1000-01-01'), -1)).toThrow(RangeError);
		expect(() => addDays(date('9999-12-31'), 1)).toThrow(RangeError);
		expect(() => shiftMonth(period('1000-01'), -1)).toThrow(RangeError);
		expect(() => shiftMonth(period('9999-12'), 1)).toThrow(RangeError);
	});
	it('strážce typu nepřijme neplatný nebo nenormalizovaný string', () => {
		expect(isDateString('2026-02-30')).toBe(false);
		expect(isDateString({})).toBe(false);
	});
});

// Nezávislý model kalendáře: pořadové číslo dne podle algoritmu `days_from_civil` H. Hinnanta, bez
// `@internationalized/date`, který appka používá.
function dayNumber(year: number, month: number, day: number): number {
	const y = month <= 2 ? year - 1 : year;
	const era = Math.floor(y / 400);
	const yearOfEra = y - era * 400;
	const dayOfYear = Math.floor((153 * ((month + 9) % 12) + 2) / 5) + day - 1;
	return era * 146_097 + yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
}

function civil(n: number): { year: number; month: number; day: number } {
	const era = Math.floor(n / 146_097);
	const dayOfEra = n - era * 146_097;
	const yearOfEra = Math.floor(
		(dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36_524) - Math.floor(dayOfEra / 146_096)) / 365,
	);
	const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
	const shifted = Math.floor((5 * dayOfYear + 2) / 153);
	const month = shifted < 10 ? shifted + 3 : shifted - 9;
	return {
		year: era * 400 + yearOfEra + (month <= 2 ? 1 : 0),
		month,
		day: dayOfYear - Math.floor((153 * shifted + 2) / 5) + 1,
	};
}

function daysInMonth(year: number, month: number): number {
	if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
	return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
const two = (n: number) => String(n).padStart(2, '0');
const dateText = (year: number, month: number, day: number) =>
	`${String(year).padStart(4, '0')}-${two(month)}-${two(day)}`;
// Model rozepíše pořadové číslo dne; appka dostane jeho zápis.
function dateOfDay(n: number): DateString {
	const { year, month, day } = civil(n);
	return date(dateText(year, month, day));
}

const FIRST_DAY = dayNumber(1000, 1, 1);
const LAST_DAY = dayNumber(9999, 12, 31);
const dayInRange = integer({
	min: FIRST_DAY,
	max: LAST_DAY,
});
const beyond = integer({
	min: 1,
	max: 1_000_000,
});
const dayOutside = oneof(
	tuple(dayInRange, beyond).map(([n, k]) => [n, LAST_DAY - n + k] as const),
	tuple(dayInRange, beyond).map(([n, k]) => [n, FIRST_DAY - n - k] as const),
);
// Měsíc jako `rok × 12 + měsíc − 1`; povolená období leží v ⟨12 000, 120 000).
const FIRST_MONTH = 12_000;
const LAST_MONTH = 119_999;
const monthInRange = integer({
	min: FIRST_MONTH,
	max: LAST_MONTH,
});
const monthOutside = oneof(
	tuple(monthInRange, beyond).map(([m, k]) => [m, LAST_MONTH - m + k] as const),
	tuple(monthInRange, beyond).map(([m, k]) => [m, FIRST_MONTH - m - k] as const),
);
const periodOfMonth = (index: number) => period(`${Math.floor(index / 12)}-${two((index % 12) + 1)}`);

describe('kalendář proti nezávislému modelu', () => {
	it('datum platí právě tehdy, když den v měsíci existuje a rok je 1000–9999', () => {
		assert(
			property(
				integer({
					min: 1,
					max: 9999,
				}),
				integer({
					min: 1,
					max: 12,
				}),
				integer({
					min: 1,
					max: 31,
				}),
				(year, month, day) => {
					const valid = year >= 1000 && day <= daysInMonth(year, month);
					expect(isDateString(dateText(year, month, day))).toBe(valid);
				},
			),
		);
	});

	it('rok, měsíc, období a hranice roku sedí s rozpadem modelu', () => {
		assert(
			property(dayInRange, (n) => {
				const { year, month, day } = civil(n);
				const d = dateOfDay(n);
				expect(dayNumber(year, month, day)).toBe(n);
				expect(yearOf(d)).toBe(year);
				expect(monthOf(d)).toBe(month);
				expect(periodOf(d)).toBe(`${year}-${two(month)}`);
				expect(startOfYear(d)).toBe(`${year}-01-01`);
				expect(endOfYear(d)).toBe(`${year}-12-31`);
			}),
		);
	});

	it('posun o dny dojde na den modelu a rozdíl dat je rozdíl pořadových čísel', () => {
		assert(
			property(dayInRange, dayInRange, (from, to) => {
				expect(addDays(dateOfDay(from), to - from)).toBe(dateOfDay(to));
				expect(daysBetween(dateOfDay(from), dateOfDay(to))).toBe(to - from);
			}),
		);
	});

	it('posun o dny za hranici let 1000–9999 se odmítne', () => {
		assert(
			property(dayOutside, ([n, days]) => {
				expect(() => addDays(dateOfDay(n), days)).toThrow(new RangeError('Datum je mimo rozsah RRRR-MM-DD.'));
			}),
		);
	});

	it('posun o měsíce dojde na období modelu', () => {
		assert(
			property(monthInRange, monthInRange, (from, to) => {
				expect(canShiftMonth(periodOfMonth(from), to - from)).toBe(true);
				expect(shiftMonth(periodOfMonth(from), to - from)).toBe(periodOfMonth(to));
				expect(monthsBetween(periodOfMonth(from), periodOfMonth(to))).toBe(to - from);
			}),
		);
	});

	it('posun o měsíce za hranici let 1000–9999 se odmítne', () => {
		assert(
			property(monthOutside, ([index, months]) => {
				expect(canShiftMonth(periodOfMonth(index), months)).toBe(false);
				expect(() => shiftMonth(periodOfMonth(index), months)).toThrow(
					new RangeError('Období je mimo rozsah RRRR-MM.'),
				);
			}),
		);
	});
});
