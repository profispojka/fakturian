import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { newInvoice } from '~/schemas/invoices';
import { emptySupplier } from '~/schemas/suppliers';
import { today } from '~/utils/date';
import { daysOverdue, duplicateFrom } from '~/utils/invoice';
import { reminderMail } from '~/utils/mail';

import { date } from './setup/dates';

import type { Supplier } from '~/schemas/suppliers';

describe('upomínka', () => {
	it('nese číslo, částku i počet dní po splatnosti', () => {
		const { subject, body } = reminderMail('20260001', 1_210_000, 14);
		expect(subject).toContain('20260001');
		expect(body).toContain('na částku 12 100,00 Kč, která');
		expect(body).toContain('14 dnů');
	});

	it('skloňuje dny česky', () => {
		expect(reminderMail('x', 100, 1).body).toContain('1 den ');
		expect(reminderMail('x', 100, 3).body).toContain('3 dny ');
		expect(reminderMail('x', 100, 30).body).toContain('30 dnů ');
		expect(reminderMail('x', 100, 2.5).body).toContain('2,5 dne ');
	});

	it('nabízí, že už mohla být zaplacená', () => {
		expect(reminderMail('x', 100, 5).body).toContain('bezpředmětnou');
	});
});

describe('po splatnosti', () => {
	it('spočítá dny', () => {
		expect(daysOverdue(date('2026-05-01'), date('2026-05-15'))).toBe(14);
		expect(daysOverdue(date('2026-05-15'), date('2026-05-15'))).toBe(0);
		expect(daysOverdue(date('2026-06-01'), date('2026-05-15'))).toBe(0);
	});

	it('bez splatnosti je nula', () => {
		expect(daysOverdue(undefined, date('2026-05-15'))).toBe(0);
	});
});

describe('duplikace faktury', () => {
	// Dnešek se zmrazí: duplikát ho dostává jako datum vystavení a test ho porovnává s očekávanou
	// hodnotou, ne s druhým voláním hodin.
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime('2026-05-29T10:00');
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	const supplier: Supplier = {
		...emptySupplier(),
		name: 'Nová firma s.r.o.',
		ico: '27082440',
		bankAccount: '2000145399',
		bankCode: '2010',
		iban: 'CZ6520100000002000145399',
		defaultDueDays: 30,
	};

	const original = {
		...newInvoice(null, '20260001'),
		uuid: 'a8438851-4b4e-5ece-96ac-c34ae2f4a74c',
		supplier: {
			...newInvoice(null, '').supplier,
			name: 'Stará firma s.r.o.',
			address: {
				street: 'Zrušená 1',
				city: '',
				zip: '',
			},
		},
		customer: {
			...newInvoice(null, '').customer,
			name: 'Acme',
		},
		vatNote: 'Starý text o DPH.',
		bankAccount: '19',
		bankCode: '0100',
		iban: 'CZ0001000000000000000019',
		note: 'Objednávka 42',
		lines: [
			{
				id: 'r1',
				description: 'Práce',
				quantity: 2,
				unit: 'hod',
				unitPriceCents: 120_000,
			},
		],
		issueDate: date('2025-03-01'),
		// `newInvoice` počítá splatnost z hodin a doklad vzniká dřív, než je `beforeEach` zmrazí.
		dueDate: date('2025-03-15'),
	};

	it('převezme odběratele, poznámku i položky', () => {
		const d = duplicateFrom(original, newInvoice(supplier, '20260002'));
		expect(d.customer.name).toBe('Acme');
		expect(d.note).toBe('Objednávka 42');
		expect(d.lines).toEqual(original.lines);
		expect(d.lines[0]).not.toBe(original.lines[0]);
	});

	it('dodavatele, účet a splatnost vezme z aktuálních údajů, ne z původního dokladu', () => {
		const d = duplicateFrom(original, newInvoice(supplier, '20260002'));
		expect(d.supplier.name).toBe('Nová firma s.r.o.');
		expect(d.supplier.ico).toBe('27082440');
		expect(d.supplier.address.street).toBe('');
		expect(d.vatNote).toBe('Nejsem plátce DPH.');
		expect(d.bankAccount).toBe('2000145399');
		expect(d.bankCode).toBe('2010');
		expect(d.iban).toBe('CZ6520100000002000145399');
		expect(d.dueDate).toBe('2026-06-28');
	});

	it('dostane nové číslo, dnešek a číselný VS', () => {
		const d = duplicateFrom(original, newInvoice(supplier, 'F2026-002'));
		expect(d.number).toBe('F2026-002');
		expect(String(d.issueDate)).toBe('2026-05-29');
		expect(d.issueDate).toBe(today());
		expect(d.variableSymbol).toBe('2026002');
	});

	it('nepřebírá UUID ani vazbu na dobropis', () => {
		const credited = {
			...original,
			documentType: 2,
			originalInvoice: '20250009',
			originalUuid: 'u9',
		};
		const d = duplicateFrom(credited, newInvoice(supplier, '20260002'));
		expect(d.uuid).toBe('');
		expect(d.documentType).toBe(1);
		expect(d.originalInvoice).toBe('');
		expect(d.originalUuid).toBe('');
	});

	it('duplikát nepřebírá rok čerpání původní položky', () => {
		const source = {
			...original,
			lines: original.lines.map((line) => ({
				...line,
				usageYear: 2024,
			})),
		};
		const copy = duplicateFrom(source, newInvoice(supplier, '20260002'));
		expect(copy.lines[0]).not.toHaveProperty('usageYear');
		expect(source.lines[0]?.usageYear).toBe(2024);
	});
});
