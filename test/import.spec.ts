import { describe, expect, it } from 'vitest';

import { adoptedSupplierSchema, importedCustomerSchema } from '~/schemas/import';
import { contactFromImported, newContactsFromImport } from '~/utils/import';

function customer(over: Record<string, string> = {}) {
	return {
		name: 'Acme s.r.o.',
		ico: '25596641',
		dic: 'CZ25596641',
		address: {
			street: 'Dlouhá 1',
			city: 'Praha',
			zip: '11000',
		},
		email: 'fakturace@acme.cz',
		...over,
	};
}

describe('IČO a DIČ z cizího dokladu', () => {
	it('IČO se ukládá bez mezer', () => {
		expect(contactFromImported(customer({ ico: '123 45 679' })).ico).toBe('12345679');
	});

	it('DIČ se ukládá bez mezer a prázdné chybí', () => {
		expect(contactFromImported(customer({ dic: 'CZ 123 456 79' })).dic).toBe('CZ12345679');
		expect(contactFromImported(customer({ dic: ' ' })).dic).toBeUndefined();
	});

	it('odběratel s IČO, které neprojde mod-11, se nezaloží', () => {
		expect(newContactsFromImport([], [customer({ ico: '123 45 678' })])).toEqual({
			contacts: [],
			refused: [
				{
					name: 'Acme s.r.o.',
					reason: 'ico: Neplatné IČO (8 číslic).',
				},
			],
		});
	});
});

describe('adresa z cizího dokladu', () => {
	it('ukládá se bez okrajových mezer', () => {
		const contact = contactFromImported({
			...customer(),
			address: {
				street: ' Dlouhá 1 ',
				city: ' Praha ',
				zip: ' 11000 ',
			},
		});

		expect(contact.address).toEqual({
			street: 'Dlouhá 1',
			city: 'Praha',
			zip: '11000',
		});
	});
});

describe('klíč navíc v odpovědi backendu', () => {
	it('odběratel s neznámým polem se odmítne', () => {
		expect(
			importedCustomerSchema.safeParse({
				...customer(),
				phone: '+420 111 222 333',
			}).error?.issues,
		).toEqual([
			{
				code: 'unrecognized_keys',
				keys: ['phone'],
				path: [],
				message: 'Neznámé klíče: "phone"',
			},
		]);
	});

	it('dodavatel s neznámým polem se odmítne', () => {
		const d = {
			name: 'Jan Novák',
			ico: '87654321',
			address: {
				street: 'Krátká 2',
				city: 'Brno',
				zip: '60200',
			},
			email: 'jan@novak.cz',
			registration: '',
			bankAccount: '123456789',
			bankCode: '0800',
			iban: 'CZ6508000000192000145399',
			invoiceNumberFormat: '{RRRR}{NNNN}',
			defaultDueDays: 30,
		};

		expect(() => adoptedSupplierSchema.parse(d)).not.toThrow();
		expect(
			adoptedSupplierSchema.safeParse({
				...d,
				swift: 'GIBACZPX',
			}).error?.issues,
		).toEqual([
			{
				code: 'unrecognized_keys',
				keys: ['swift'],
				path: [],
				message: 'Neznámé klíče: "swift"',
			},
		]);
	});
});
