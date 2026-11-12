import { describe, expect, it } from 'vitest';

import { contactSchema } from '~/schemas/customers';
import { adoptedSupplierSchema, importedCustomerSchema } from '~/schemas/import';
import { supplierReadyForInvoicing } from '~/schemas/suppliers';
import { balance, dashboardStats, periodSeries, topCustomers, topDebtors, vatLimit } from '~/utils/dashboard';
import { contactFromImported, newContactsFromImport, supplierFromAdopted } from '~/utils/import';
import { nextNumber } from '~/utils/numbering';
import { z } from '~/utils/zod';

import { date } from './setup/dates';

import type { ImportedCustomer } from '~/schemas/import';
import type { InvoiceSummary } from '~/schemas/invoices';

const contract = await import('~/utils/fixtures/adopt-folder.json').then((m) => m.default ?? m);

const today = date(contract.today);
const invoices: InvoiceSummary[] = contract.invoices.map((i) => ({
	...i,
	issueDate: date(i.issueDate),
	dueDate: date(i.dueDate),
	documentType: z.literal([1, 2]).parse(i.documentType),
	sentAt: null,
	path: '',
}));
const withoutPayments = {};

describe('převzetí složky → fakturační údaje', () => {
	it('z dokladů se vyčte IČO, adresa, účet i zápis do rejstříku, takže dodavatel je hned připravený', () => {
		const d = adoptedSupplierSchema.parse(contract.supplier);
		const supplier = supplierFromAdopted(d);

		expect(supplier.ico).toBe('12345679');
		expect(supplier.name).toBe('Testovací dodavatel s.r.o.');
		expect(supplier.bankAccount).toBe('19-2000145399');
		expect(supplier.bankCode).toBe('0800');
		expect(supplier.address).toEqual({
			street: 'Zkušební 1',
			city: 'Praha 10',
			zip: '10000',
		});
		expect(supplier.registration).toBe('Zapsáno u Zkušebního soudu, oddíl C, vložka 0000');
		expect(supplierReadyForInvoicing(supplier)).toBe(true);
	});

	it('IBAN z dokladů převezme, jen když patří k jejich účtu', () => {
		const d = adoptedSupplierSchema.parse(contract.supplier);

		expect(supplierFromAdopted(d).iban).toBe('CZ6508000000192000145399');
		expect(
			supplierFromAdopted({
				...d,
				iban: 'CZ7908000000002000145399',
			}).iban,
		).toBe(undefined);
		expect(
			supplierFromAdopted({
				...d,
				iban: '',
			}).iban,
		).toBe(undefined);
	});

	it('řada i splatnost pokračují tak, jak je uživatel měl jinde', () => {
		const supplier = supplierFromAdopted(adoptedSupplierSchema.parse(contract.supplier));
		// Sedmimístné `2026022` z cizí řady → `{RRRR}{NNN}`, ne výchozí `{RRRR}{NNNN}`.
		expect(supplier.invoiceNumberFormat).toBe('{RRRR}{NNN}');
		expect(supplier.defaultDueDays).toBe(14);
	});

	it('příští faktura naváže na cizí řadu i pořadím', () => {
		const supplier = supplierFromAdopted(adoptedSupplierSchema.parse(contract.supplier));
		const used = invoices.map((f) => f.number);

		expect(nextNumber(used, 2026, supplier.invoiceNumberFormat, '')).toBe('2026023');
	});
});

describe('převzetí složky → odběratelé', () => {
	it('z dokladů se založí odběratelé s IČO, adresou i e-mailem', () => {
		const contacts = contract.customers.map((c) => importedCustomerSchema.parse(c)).map(contactFromImported);

		expect(contacts).toHaveLength(2);
		expect(contacts.map((k) => k.name)).toEqual(['Zkušební odběratel s.r.o.', 'Ukázková firma a.s.']);
		expect(contacts[0]?.ico).toBe('20000006');
		expect(contacts[0]?.email).toBe('fakturace@zkusebni-odberatel.example');
		expect(contacts[1]?.address.city).toBe('Ostrava');
		// Každý z nich musí projít týmž schématem jako ručně zadaný odběratel — jinak by šel založit, ale
		// ne uložit po první editaci.
		expect(contacts.find((k) => !contactSchema.safeParse(k).success)?.name).toBeUndefined();
		// Identita: bez ní by se dva odběratelé slili v jednoho.
		expect(new Set(contacts.map((k) => k.id)).size).toBe(2);
	});
});

describe('převzetí složky → přehled', () => {
	it('souhrny nejsou nulové a sedí na částky z dokladů', () => {
		const s = dashboardStats(invoices, withoutPayments, today);

		expect(balance(invoices, withoutPayments, 2026)).toEqual(
			expect.objectContaining({
				totalCents: 19_094_000,
				paidCents: 0,
				unpaidCents: 19_094_000,
			}),
		);
		expect(s.unpaid).toHaveLength(3);
		expect(s.overdueCount).toBe(2);
		expect(s.recent).toHaveLength(3);
	});

	it('graf fakturace má sloupce tam, kde se fakturovalo', () => {
		const series = periodSeries(invoices, 'month', today);

		expect(series).toHaveLength(12);
		const byKey = Object.fromEntries(series.map((b) => [b.key, b.salesCents]));
		expect(byKey['2026-07']).toBe(12_318_000);
		expect(byKey['2026-08']).toBe(6_776_000);
		// Součet sloupců = roční obrat; graf a číslo nad ním musí říkat totéž.
		expect(series.reduce((a, b) => a + b.salesCents, 0)).toBe(19_094_000);
		expect(series.filter((b) => b.salesCents > 0)).toHaveLength(2);
	});

	it('žebříčky odběratelů i hlídání limitu plátcovství počítají', () => {
		expect(topCustomers(invoices)).toEqual([
			{
				customer: 'Ukázková firma a.s.',
				amountCents: 12_318_000,
			},
			{
				customer: 'Zkušební odběratel s.r.o.',
				amountCents: 6_776_000,
			},
		]);
		expect(topDebtors(invoices, withoutPayments)).toEqual(topCustomers(invoices));

		const limit = vatLimit(invoices, today);
		expect(limit.turnoverCents).toBe(19_094_000);
		expect(limit.ratio).toBeCloseTo(0.09547, 5);
	});
});

describe('čištění údajů z cizího dokladu', () => {
	function customer(over: Partial<ImportedCustomer> = {}) {
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

	it('odběratel s neplatným údajem se nezaloží a řekne proč', () => {
		const refused = (over: Partial<ImportedCustomer>) =>
			newContactsFromImport([], [importedCustomerSchema.parse(customer(over))]);

		expect(
			refused({
				ico: '123',
				dic: 'nesmysl',
			}),
		).toEqual({
			contacts: [],
			refused: [
				{
					name: 'Acme s.r.o.',
					reason: 'ico: Neplatné IČO (8 číslic). a dic: DIČ má tvar „CZ12345678".',
				},
			],
		});
		expect(
			refused({
				address: {
					street: 'Dlouhá 1',
					city: 'Praha',
					zip: 'abc',
				},
			}).refused,
		).toEqual([
			{
				name: 'Acme s.r.o.',
				reason: 'address.zip: PSČ má 5 číslic.',
			},
		]);
		// `?bcc=` by se v `mailto:` stal další hlavičkou.
		expect(refused({ email: 'klient@firma.cz?bcc=utocnik@evil.example' }).refused).toEqual([
			{
				name: 'Acme s.r.o.',
				reason: 'email: Neplatný e-mail.',
			},
		]);
		expect(
			refused({
				name: ' ',
				ico: '',
			}).refused,
		).toEqual([
			{
				name: 'odběratel bez jména',
				reason: 'name: Povinné pole. a ico: Povinné pole.',
			},
		]);
		// E-mail ISDOC většinou nenese; odběratel bez něj se založit musí.
		expect(refused({ email: ' ' })).toEqual({
			contacts: [
				expect.objectContaining({
					name: 'Acme s.r.o.',
					email: undefined,
				}),
			],
			refused: [],
		});
	});

	it('platné údaje projdou beze změny', () => {
		const { contacts, refused } = newContactsFromImport([], [importedCustomerSchema.parse(customer())]);

		expect(refused).toEqual([]);
		expect(contacts).toEqual([
			{
				id: contacts[0]!.id,
				name: 'Acme s.r.o.',
				ico: '25596641',
				dic: 'CZ25596641',
				address: {
					street: 'Dlouhá 1',
					city: 'Praha',
					zip: '11000',
				},
				email: 'fakturace@acme.cz',
			},
		]);
	});
});

describe('dodavatel z převzatých dokladů', () => {
	function supplier(over: Record<string, unknown> = {}) {
		return {
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
			...over,
		};
	}

	it('prázdná pole nechá na výchozích hodnotách', () => {
		const s = supplierFromAdopted(
			adoptedSupplierSchema.parse(
				supplier({
					iban: '',
					email: '',
				}),
			),
		);

		expect(s.iban).toBeUndefined();
		expect(s.email).toBeUndefined();
	});

	it('prázdný formát řady nahradí výchozím, vyplněný zachová', () => {
		const empty = supplierFromAdopted(adoptedSupplierSchema.parse(supplier({ invoiceNumberFormat: '' })));
		const own = supplierFromAdopted(
			adoptedSupplierSchema.parse(supplier({ invoiceNumberFormat: 'F{RRRR}-{NNN}' })),
		);

		expect(empty.invoiceNumberFormat).toBe('{RRRR}{NNNN}');
		expect(own.invoiceNumberFormat).toBe('F{RRRR}-{NNN}');
	});

	it('chybějící splatnost vezme výchozí, vyplněnou zachová', () => {
		const without = supplierFromAdopted(adoptedSupplierSchema.parse(supplier({ defaultDueDays: null })));
		const s = supplierFromAdopted(adoptedSupplierSchema.parse(supplier({ defaultDueDays: 30 })));

		expect(without.defaultDueDays).toBe(14);
		expect(s.defaultDueDays).toBe(30);
	});

	it('necelou a zápornou splatnost odmítne na hranici backendu', () => {
		for (const defaultDueDays of [14.5, -1]) {
			const result = adoptedSupplierSchema.safeParse(supplier({ defaultDueDays }));
			expect(result.error?.issues.map((issue) => issue.path)).toEqual([['defaultDueDays']]);
		}
	});
});
