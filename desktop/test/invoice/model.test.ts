import { describe, expect, it } from 'vitest';

import { fmtnum } from '../../invoice/model.ts';

describe('číslo do dokladu', () => {
	it('celé číslo píše bez desetinné části a zlomek nejkratším zápisem', () => {
		expect(fmtnum(3)).toBe('3');
		expect(fmtnum(6.5)).toBe('6.5');
		expect(fmtnum(0.1)).toBe('0.1');
		expect(fmtnum(-2.25)).toBe('-2.25');
	});

	it('nikdy nepíše exponent', () => {
		expect(fmtnum(1e21)).toBe('1000000000000000000000');
		expect(fmtnum(-1.25e22)).toBe('-12500000000000000000000');
		expect(fmtnum(1e-7)).toBe('0.0000001');
		expect(fmtnum(-1.5e-7)).toBe('-0.00000015');
	});
});
