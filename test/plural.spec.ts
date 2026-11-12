import { describe, expect, it } from 'vitest';

import {
	czechList,
	czechPercent,
	czechSentence,
	formatCount,
	formatCountOutOf,
	formatPassiveCount,
	zeroPadded,
} from '~/utils/locales';

const NBSP = String.fromCharCode(0x00a0);

describe('czechList a czechPercent', () => {
	it('výčet spojí poslední dvě položky spojkou', () => {
		expect(czechList.format(['byly převzaty 2 doklady', 'byl přidán 1 odběratel', 'byl přeskočen 1 soubor'])).toBe(
			`byly převzaty 2 doklady, byl přidán 1 odběratel a${NBSP}byl přeskočen 1 soubor`,
		);
	});

	it('podíl ukáže v celých procentech', () => {
		expect(czechPercent.format(0.256)).toBe(`26${NBSP}%`);
	});
});

describe('formatCount', () => {
	it.each([
		[0, '0 dokladů'],
		[1, '1 doklad'],
		[2, '2 doklady'],
		[4, '4 doklady'],
		[5, '5 dokladů'],
		[11, '11 dokladů'],
		[12, '12 dokladů'],
		[14, '14 dokladů'],
		[21, '21 dokladů'],
		[22, '22 dokladů'],
		[25, '25 dokladů'],
		[1234, '1 234 dokladů'],
	])('pro %i vybere správný český tvar', (count, expected) => {
		expect(formatCount(count, 'document')).toBe(expected);
	});

	it.each([
		[0, '0 faktur'],
		[1, '1 faktura'],
		[3, '3 faktury'],
		[1.5, '1,5 faktury'],
		[20, '20 faktur'],
	])('fakturu počítá v ženském rodě (%d)', (count, expected) => {
		expect(formatCount(count, 'invoice')).toBe(expected);
	});
});

describe('formatPassiveCount', () => {
	it.each([
		[0, 'document', 'převzat', 'bylo převzato 0 dokladů'],
		[1, 'document', 'převzat', 'byl převzat 1 doklad'],
		[3, 'document', 'převzat', 'byly převzaty 3 doklady'],
		[5, 'document', 'převzat', 'bylo převzato 5 dokladů'],
		[1, 'customer', 'přidán', 'byl přidán 1 odběratel'],
		[2, 'customer', 'přidán', 'byli přidáni 2 odběratelé'],
		[7, 'customer', 'přidán', 'bylo přidáno 7 odběratelů'],
		[1, 'item', 'přidán', 'byla přidána 1 položka'],
		[4, 'item', 'přidán', 'byly přidány 4 položky'],
		[9, 'item', 'přidán', 'bylo přidáno 9 položek'],
	] as const)('pro %i (%s) shodne sloveso s počtem', (count, noun, participle, expected) => {
		expect(formatPassiveCount(count, noun, participle)).toBe(expected);
	});
});

describe('czechSentence', () => {
	it('výčet začne velkým písmenem a skončí tečkou', () => {
		expect(czechSentence(['byly převzaty 3 doklady', 'byli přidáni 2 odběratelé'])).toBe(
			`Byly převzaty 3 doklady a${NBSP}byli přidáni 2 odběratelé.`,
		);
	});
});

describe('formatCountOutOf', () => {
	it('skládá zúžený výpis z celkového počtu', () => {
		expect(formatCountOutOf(1, 1, 'document')).toBe('1 z 1 dokladu');
		expect(formatCountOutOf(1, 2, 'document')).toBe('1 z 2 dokladů');
		expect(formatCountOutOf(2, 21, 'document')).toBe('2 z 21 dokladů');
		expect(formatCountOutOf(1000, 1500, 'document')).toBe('1 000 z 1 500 dokladů');
	});
});

describe('zeroPadded', () => {
	it('doplní nuly zleva na zadanou šířku', () => {
		expect(zeroPadded(7, 4)).toBe('0007');
		expect(zeroPadded(0, 3)).toBe('000');
	});

	it('delší číslo nechá celé a bez oddělovače tisíců', () => {
		expect(zeroPadded(999_999_999, 4)).toBe('999999999');
	});
});
