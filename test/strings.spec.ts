import { describe, expect, it } from 'vitest';

import { digitsOnly, isAsciiAlphaNumeric, isAsciiDigits, withoutLeadingZeros, withoutWhitespace } from '~/utils/strings';

describe('řetězcové kontroly', () => {
	it('odstraní jen ASCII číslice a zachová jejich pořadí', () => {
		expect(digitsOnly('A1٢-03')).toBe('103');
	});

	it('odstraní bílé znaky i mezi znaky', () => {
		expect(withoutWhitespace(' 1\t2\u00a03 ')).toBe('123');
	});

	it('odebere jen úvodní nuly', () => {
		expect(withoutLeadingZeros('00042')).toBe('42');
		expect(withoutLeadingZeros('000')).toBe('');
		expect(withoutLeadingZeros('42')).toBe('42');
	});

	it('rozlišuje prázdný řetězec, ASCII číslice a ASCII alfanumerické znaky', () => {
		expect(isAsciiDigits('')).toBe(true);
		expect(isAsciiDigits('0129')).toBe(true);
		expect(isAsciiDigits('１２')).toBe(false);
		expect(isAsciiAlphaNumeric('aZ09')).toBe(true);
		expect(isAsciiAlphaNumeric('é')).toBe(false);
	});
});
