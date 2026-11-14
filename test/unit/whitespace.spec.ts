import { describe, expect, it } from 'vitest';

import { newContactsFromImport, supplierFromAdopted } from '~/utils/import';
import { z } from '~/utils/zod';

describe('normalizace mezer na vstupu', () => {
	it('převzatý dodavatel má PSČ a bankovní spojení bez mezer', () => {
		const supplier = supplierFromAdopted({
			name: 'Jan Novák',
			ico: '27082440',
			address: {
				street: 'Dlouhá 1',
				city: 'Praha',
				zip: '110\u00a000',
			},
			registration: '',
			bankAccount: '19 - 2000 145399',
			bankCode: '08\t00',
			email: '',
			defaultDueDays: null,
			invoiceNumberFormat: '',
		});
		expect(supplier.address.zip).toBe('11000');
		expect(supplier.bankAccount).toBe('19-2000145399');
		expect(supplier.bankCode).toBe('0800');
	});

	it.each([
		[z.zip(), ' 110\u00a000\t', '11000'],
		[z.bankAccount(), ' 000019 - 2000\t145399 ', '000019-2000145399'],
		[z.bankCode(), '\t08\u00a000 ', '0800'],
		[z.dic(), ' cz\u00a0270 82440\t', 'CZ27082440'],
	])('%# vydá ověřenou hodnotu bez bílých znaků', (schema, input, expected) => {
		expect(schema.safeParse(input)).toEqual({
			success: true,
			data: expected,
		});
	});

	it.each([
		[z.zip(), ' １１0 00 ', 'PSČ má 5 číslic.'],
		[z.bankAccount(), ' 19 - 2000145398 ', 'Neplatné číslo účtu, např. 19-2000145399.'],
		[z.bankCode(), ' 08A0 ', 'Kód banky má 4 číslice.'],
		[z.dic(), ' CZ 270８2440 ', 'DIČ má tvar „CZ12345678".'],
		[z.zip(), ' \t\u00a0', 'Povinné pole.'],
		[z.bankAccount(), '', 'Povinné pole.'],
		[z.bankCode(), ' \t', 'Povinné pole.'],
		[z.dic(), ' ', 'DIČ má tvar „CZ12345678".'],
	])('%# neplatnou hodnotu odmítne celou', (schema, input, message) => {
		expect(schema.safeParse(input).error?.issues.map((issue) => issue.message)).toEqual([message]);
	});

	it('import kontaktu použije normalizovaný výstup schématu', () => {
		const result = newContactsFromImport(
			[],
			[
				{
					name: 'Firma',
					ico: '27082440',
					dic: ' cz 27082440 ',
					address: {
						street: 'Dlouhá 1',
						city: 'Praha',
						zip: '110\u00a000',
					},
					email: '',
				},
			],
		);
		expect(result.refused).toEqual([]);
		expect(result.contacts).toEqual([
			expect.objectContaining({
				dic: 'CZ27082440',
				address: {
					street: 'Dlouhá 1',
					city: 'Praha',
					zip: '11000',
				},
			}),
		]);
	});
});
