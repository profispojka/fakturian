import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentKind } from '~/constants/invoice';
import { newInvoice } from '~/schemas/invoices';
import { emptySupplier } from '~/schemas/suppliers';
import {
	creditNoteFrom,
	creditNotesOf,
	creditTargetOf,
	deletionQuestion,
	invoiceState,
	invoiceTotalCents,
	lineTotalCents,
	matchesDateFilter,
	matchesStateFilter,
	contactToParty,
	partyToContact,
	supplierToParty,
	variableSymbolFor,
	yearFilter,
} from '~/utils/invoice';

import { date } from './setup/dates';
import { summary } from './setup/fixtures';

import type { InvoiceSummary } from '~/schemas/invoices';
import type { Supplier } from '~/schemas/suppliers';
import type { DateString } from '~/utils/date';

describe('lineTotalCents / invoiceTotalCents', () => {
	it('řádkový a celkový součet v haléřích', () => {
		expect(
			lineTotalCents({
				quantity: 3,
				unitPriceCents: 120_000,
			}),
		).toBe(360000);
		expect(
			invoiceTotalCents({
				lines: [
					{
						quantity: 3,
						unitPriceCents: 120_000,
					},
					{
						quantity: 1.5,
						unitPriceCents: 800_000,
					},
				],
			}),
		).toBe(1560000);
	});

	it('desetinné množství a ceny nezanáší nepřesnost plovoucí čárky', () => {
		// 3 × 19,99 = 59,97 Kč přesně; klasické f64 by dalo 59.970000000000006
		expect(
			lineTotalCents({
				quantity: 3,
				unitPriceCents: 1_999,
			}),
		).toBe(5997);
		expect(
			invoiceTotalCents({
				lines: [
					{
						quantity: 1,
						unitPriceCents: 10,
					},
					{
						quantity: 1,
						unitPriceCents: 20,
					},
				],
			}),
		).toBe(30);
	});
});

describe('newInvoice', () => {
	const supplier: Supplier = {
		name: 'Jan',
		ico: '123',
		address: {
			street: 'Ulice 1',
			city: 'Praha',
			zip: '11000',
		},
		registration: 'Fyzická osoba zapsaná v živnostenském rejstříku, Živnostenský úřad Praha 1',
		bankAccount: '2000145399',
		bankCode: '0800',
		iban: 'CZ65',
		email: 'jan@x.cz',
		defaultDueDays: 30,
		invoiceNumberFormat: '{RRRR}{NNNN}',
	};

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime('2026-03-01T10:00');
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('předvyplní dodavatele a VS, splatnost dle dní', () => {
		const inv = newInvoice(supplier, '20260001');
		expect(inv.number).toBe('20260001');
		expect(inv.variableSymbol).toBe('20260001');
		expect(inv.supplier).toEqual(supplierToParty(supplier));
		expect(inv.bankAccount).toBe('2000145399');
		expect(inv.lines).toHaveLength(1);
		expect(inv.issueDate).toBe('2026-03-01');
		expect(inv.dueDate).toBe('2026-03-31');
	});

	it('bez dodavatele má prázdnou stranu a 14 dní splatnost', () => {
		const inv = newInvoice(null, '20260001');
		expect(inv.supplier.name).toBe('');
		expect(inv.issueDate).toBe('2026-03-01');
		expect(inv.dueDate).toBe('2026-03-15');
		expect(inv.vatNote).toBe('Nejsem plátce DPH.');
	});
});

describe('creditNoteFrom', () => {
	const original = newInvoice(null, '20260001');
	original.customer.name = 'Acme';
	original.lines = [
		{
			id: 'r1',
			description: 'Práce',
			quantity: 2,
			unit: 'ks',
			unitPriceCents: 50_000,
		},
	];

	it('vytvoří dobropis se zápornou částkou a odkazem', () => {
		const cn = creditNoteFrom(original, '20260002');
		expect(cn.documentType).toBe(2);
		expect(cn.originalInvoice).toBe('20260001');
		expect(cn.originalIssueDate).toBe(original.issueDate);
		expect(cn.originalUuid).toBe(original.uuid);
		expect(cn.number).toBe('20260002');
		expect(cn.variableSymbol).toBe('20260002');
		expect(cn.customer.name).toBe('Acme');
		expect(invoiceTotalCents(cn)).toBe(-100000);
	});

	it('slevu z faktury vrátí s opačným znaménkem', () => {
		const discounted = {
			...original,
			lines: [
				{
					id: 'r1',
					description: 'Práce',
					quantity: 2,
					unit: 'ks',
					unitPriceCents: 50_000,
				},
				{
					id: 'r2',
					description: 'Sleva',
					quantity: 1,
					unit: 'ks',
					unitPriceCents: -20_000,
				},
			],
		};
		const cn = creditNoteFrom(discounted, '20260002');
		expect(cn.lines.map((l) => l.unitPriceCents)).toEqual([-50_000, 20_000]);
		expect(invoiceTotalCents(cn)).toBe(-80_000);
	});

	it('nepřebírá UUID původní faktury — je to samostatný doklad', () => {
		const issued = {
			...original,
			uuid: 'a8438851-4b4e-5ece-96ac-c34ae2f4a74c',
		};
		expect(creditNoteFrom(issued, '20260002').uuid).toBe('');
	});

	it('nepřebírá poznámku původní faktury', () => {
		const issued = {
			...original,
			note: 'Objednávka 42/2026',
		};
		const cn = creditNoteFrom(issued, '20260002');
		expect(cn.note).toBe('');
	});
});

describe('creditTargetOf / creditNotesOf', () => {
	const credit = (number: string, over: Partial<InvoiceSummary> = {}) =>
		summary(number, {
			documentType: DocumentKind.CreditNote,
			totalCents: -121_000,
			originalInvoice: '20260001',
			...over,
		});
	const draft = {
		documentType: DocumentKind.CreditNote,
		number: '20260009',
		originalInvoice: '20260001',
	};

	it('u faktury nic nehledá', () => {
		expect(
			creditTargetOf(
				{
					...draft,
					documentType: DocumentKind.Invoice,
				},
				[summary('20260001')],
			),
		).toBeUndefined();
	});

	const archive = [
		summary('20260000'),
		summary('20260001'),
		credit('20260002'),
		credit('20260003'),
		credit('20260004', { originalInvoice: '20260008' }),
		credit('20260009'),
		summary('20260005', { originalInvoice: '20260001' }),
	];

	it('najde fakturu a ostatní dobropisy k ní', () => {
		expect(creditTargetOf(draft, archive)).toEqual({
			number: '20260001',
			totalCents: 121_000,
			otherCreditNotes: ['20260002', '20260003'],
		});
	});

	it('vypíše všechny dobropisy k faktuře a nic jiného', () => {
		expect(creditNotesOf('20260001', archive)).toEqual(['20260002', '20260003', '20260009']);
		expect(creditNotesOf('20260000', archive)).toEqual([]);
	});

	it('bez faktury v archivu vrátí null', () => {
		expect(creditTargetOf(draft, [credit('20260001')])).toBeNull();
	});
});

describe('deletionQuestion', () => {
	const invoice = {
		number: '20260001',
		documentType: DocumentKind.Invoice,
	};

	it('u samotné faktury řekne jen, kam PDF odejde', () => {
		expect(deletionQuestion(invoice, 0)).toEqual({
			title: 'Smazat fakturu?',
			message: 'Opravdu chceš smazat fakturu 20260001? PDF se přesune do Koše a číslo dokladu se uvolní.',
		});
	});

	it('zmíní platby, které zmizí s dokladem', () => {
		expect(deletionQuestion(invoice, 1).message).toBe(
			'Opravdu chceš smazat fakturu 20260001? PDF se přesune do Koše a číslo dokladu se uvolní. Spolu s dokladem zmizí zapsané platby (1).',
		);
	});

	it('dobropis nazve dobropisem', () => {
		expect(
			deletionQuestion(
				{
					number: '20260002',
					documentType: DocumentKind.CreditNote,
				},
				0,
			),
		).toEqual({
			title: 'Smazat dobropis?',
			message: 'Opravdu chceš smazat dobropis 20260002? PDF se přesune do Koše a číslo dokladu se uvolní.',
		});
	});
});

describe('invoiceState', () => {
	const unpaid = {
		outstandingCents: 100,
		paidCents: 0,
		credited: false,
	};
	const invoice = (dueDate: DateString | undefined) => ({
		documentType: DocumentKind.Invoice,
		dueDate,
	});
	const credit = {
		documentType: DocumentKind.CreditNote,
		dueDate: date('2026-01-01'),
	};
	const today = date('2026-05-29');

	it('zaplaceno má přednost', () => {
		expect(
			invoiceState(
				invoice(date('2026-01-01')),
				{
					...unpaid,
					outstandingCents: 0,
					paidCents: 100,
				},
				today,
			),
		).toBe('paid');
	});
	it('nezaplacená po splatnosti', () => {
		expect(invoiceState(invoice(date('2026-05-01')), unpaid, today)).toBe('overdue');
	});
	it('nezaplacená před splatností = vystaveno', () => {
		expect(invoiceState(invoice(date('2026-06-30')), unpaid, today)).toBe('issued');
	});
	it('v den splatnosti ještě po splatnosti není', () => {
		expect(invoiceState(invoice(today), unpaid, today)).toBe('issued');
	});
	it('bez splatnosti je vystavená, ne po splatnosti', () => {
		expect(invoiceState(invoice(undefined), unpaid, today)).toBe('issued');
	});
	it('zčásti uhrazená před splatností je zčásti uhrazená', () => {
		expect(
			invoiceState(
				invoice(date('2026-06-30')),
				{
					...unpaid,
					paidCents: 50,
				},
				today,
			),
		).toBe('partial');
	});
	it('zčásti uhrazená po splatnosti je po splatnosti', () => {
		expect(
			invoiceState(
				invoice(date('2026-05-01')),
				{
					...unpaid,
					paidCents: 50,
				},
				today,
			),
		).toBe('overdue');
	});
	it('dobropisovaná faktura není po splatnosti ani zaplacená', () => {
		const credited = {
			outstandingCents: 0,
			paidCents: 50,
			credited: true,
		};
		expect(invoiceState(invoice(date('2026-05-01')), credited, today)).toBe('credited');
	});
	it('dobropis po splatnosti nikdy není', () => {
		expect(
			invoiceState(
				credit,
				{
					...unpaid,
					outstandingCents: -100,
				},
				today,
			),
		).toBe('refund');
		expect(
			invoiceState(
				credit,
				{
					...unpaid,
					outstandingCents: -50,
					paidCents: -50,
				},
				today,
			),
		).toBe('refunding');
		expect(
			invoiceState(
				credit,
				{
					...unpaid,
					outstandingCents: 0,
					paidCents: -50,
				},
				today,
			),
		).toBe('refunded');
		expect(
			invoiceState(
				credit,
				{
					...unpaid,
					outstandingCents: 0,
				},
				today,
			),
		).toBe('settled');
	});
});

describe('matchesStateFilter', () => {
	it('„Všechny" propustí každý stav', () => {
		expect(matchesStateFilter('paid', 'all')).toBe(true);
		expect(matchesStateFilter('partial', 'all')).toBe(true);
		expect(matchesStateFilter('issued', 'all')).toBe(true);
		expect(matchesStateFilter('overdue', 'all')).toBe(true);
	});
	it('„Uhrazené" jen zaplacené', () => {
		expect(matchesStateFilter('paid', 'paid')).toBe(true);
		expect(matchesStateFilter('partial', 'paid')).toBe(false);
		expect(matchesStateFilter('overdue', 'paid')).toBe(false);
	});
	it('„Neuhrazené" zahrnují i doklady zčásti uhrazené a po splatnosti', () => {
		expect(matchesStateFilter('issued', 'unpaid')).toBe(true);
		expect(matchesStateFilter('partial', 'unpaid')).toBe(true);
		expect(matchesStateFilter('overdue', 'unpaid')).toBe(true);
		expect(matchesStateFilter('paid', 'unpaid')).toBe(false);
	});
	it('dobropisovaná faktura a vypořádaný dobropis jsou uhrazené, čekající vratka ne', () => {
		for (const closed of ['credited', 'refunded', 'settled'] as const) {
			expect([matchesStateFilter(closed, 'paid'), matchesStateFilter(closed, 'unpaid')]).toEqual([true, false]);
		}
		for (const open of ['refund', 'refunding'] as const) {
			expect([matchesStateFilter(open, 'paid'), matchesStateFilter(open, 'unpaid')]).toEqual([false, true]);
			expect(matchesStateFilter(open, 'overdue')).toBe(false);
		}
	});
	it('„Po splatnosti" je užší podmnožina neuhrazených', () => {
		expect(matchesStateFilter('overdue', 'overdue')).toBe(true);
		expect(matchesStateFilter('partial', 'overdue')).toBe(false);
		expect(matchesStateFilter('issued', 'overdue')).toBe(false);
	});
});

describe('matchesDateFilter', () => {
	it('celý rok pustí každý den toho roku a nic z jiného', () => {
		const yearOnly = yearFilter(2026);
		expect(matchesDateFilter(date('2026-01-01'), yearOnly)).toBe(true);
		expect(matchesDateFilter(date('2026-12-31'), yearOnly)).toBe(true);
		expect(matchesDateFilter(date('2025-12-31'), yearOnly)).toBe(false);
		expect(matchesDateFilter(date('2027-01-01'), yearOnly)).toBe(false);
	});

	it('měsíc rok dál zužuje', () => {
		expect(
			matchesDateFilter(date('2026-03-14'), {
				year: 2026,
				month: 3,
			}),
		).toBe(true);
		expect(
			matchesDateFilter(date('2026-04-14'), {
				year: 2026,
				month: 3,
			}),
		).toBe(false);
	});
});

describe('roky čerpání', () => {
	it('nová faktura nepotřebuje období ani ručně zadaný rok čerpání', () => {
		const inv = newInvoice(null, '20260001');
		expect(inv).not.toHaveProperty('period');
		expect(inv.lines[0]?.usageYear).toBeUndefined();
	});
	it('dobropis vrací každý řádek do jeho původního roku', () => {
		const original = newInvoice(null, '20260001');
		original.issueDate = date('2026-01-10');
		original.lines = [
			{
				id: 'r1',
				description: 'Práce',
				quantity: 8,
				unit: 'hod',
				unitPriceCents: 100_000,
				usageYear: 2025,
			},
			{
				id: 'r2',
				description: 'Práce',
				quantity: 4,
				unit: 'hod',
				unitPriceCents: 100_000,
			},
		];
		const credit = creditNoteFrom(original, '20260002');
		expect(credit.lines.map((line) => [line.usageYear, line.unitPriceCents])).toEqual([
			[2025, -100_000],
			[2026, -100_000],
		]);
	});
});

describe('variabilní symbol', () => {
	it('z čísla se vezmou jen číslice', () => {
		expect(variableSymbolFor('20260001')).toBe('20260001');
		expect(variableSymbolFor('F2026-007')).toBe('2026007');
		expect(variableSymbolFor('FA-00003-2026')).toBe('000032026');
	});

	it('nová faktura i dobropis dostanou číselný VS', () => {
		expect(newInvoice(null, 'F2026-007').variableSymbol).toBe('2026007');
		const cn = creditNoteFrom(newInvoice(null, 'F2026-007'), 'F2026-008');
		expect(cn.variableSymbol).toBe('2026008');
	});

	it('nepřeteče deset číslic', () => {
		expect(variableSymbolFor('123456789012345').length).toBe(10);
	});
});

describe('převod na stranu dokladu', () => {
	it('dodavatel bez nepovinných polí dá prázdné řetězce', () => {
		const s = emptySupplier();
		s.name = 'Jan Novák';
		s.email = undefined;

		const side = supplierToParty(s);
		expect(side.dic).toBe('');
		expect(side.email).toBe('');
		expect(side.name).toBe('Jan Novák');
	});

	it('odběratel bez DIČ a e-mailu dá prázdné řetězce', () => {
		const side = contactToParty({
			id: 'k1',
			name: 'Acme',
			ico: '27082440',
			address: {
				street: 'Dlouhá 1',
				city: 'Praha',
				zip: '11000',
			},
		});

		expect(side.ico).toBe('27082440');
		expect(side.dic).toBe('');
		expect(side.email).toBe('');
	});

	it('vyplněná nepovinná pole se přenesou beze změny', () => {
		const s = emptySupplier();
		s.email = 'jan@novak.cz';

		const side = supplierToParty(s);
		expect(side.email).toBe('jan@novak.cz');
	});
});

describe('převod strany dokladu na odběratele', () => {
	const party = {
		name: 'Acme',
		ico: '27082440',
		dic: '',
		email: '',
		address: {
			street: 'Dlouhá 1',
			city: 'Praha',
			zip: '11000',
		},
		registration: '',
	};

	it('prázdné DIČ a e-mail do odběratele nepřenese', () => {
		expect(partyToContact(party)).toEqual({
			id: expect.any(String),
			name: 'Acme',
			ico: '27082440',
			address: {
				street: 'Dlouhá 1',
				city: 'Praha',
				zip: '11000',
			},
		});
	});

	it('vyplněné DIČ a e-mail přenese', () => {
		expect(
			partyToContact({
				...party,
				dic: 'CZ27082440',
				email: 'acme@acme.cz',
			}),
		).toEqual({
			id: expect.any(String),
			name: 'Acme',
			ico: '27082440',
			dic: 'CZ27082440',
			address: {
				street: 'Dlouhá 1',
				city: 'Praha',
				zip: '11000',
			},
			email: 'acme@acme.cz',
		});
	});
});
