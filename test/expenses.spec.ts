import { describe, expect, it } from 'vitest';

import { emptyExpense, emptyExpenses, expensesFileSchema } from '~/schemas/expenses';
import { periodOf, today, yearOf } from '~/utils/date';
import { checkRecipient, expenseFromReceived, expensesTotalCents, sameReceivedDocument } from '~/utils/expenses';

import { date, period } from './setup/dates';

import type { Expense } from '~/schemas/expenses';

function exp(partial: Partial<Expense>): Expense {
	return {
		id: 'x',
		supplier: 'Dodavatel',
		description: '',
		amountCents: 100_00,
		date: date('2026-01-15'),
		...partial,
	};
}

describe('validace příjemce u přijatého dokladu', () => {
	const our = '12345678';

	it('IČO sedí → doklad projde', () => {
		expect(checkRecipient(our, '12345678')).toEqual({ ok: true });
	});

	it('IČO nesedí → import se odmítne a hláška obě IČO pojmenuje', () => {
		expect(checkRecipient(' 12345678 ', ' 87654321 ')).toEqual({
			ok: false,
			reason: 'Doklad je vystavený na IČO 87654321, ne na tvoje 12345678.',
		});
	});

	it('IČO na dokladu chybí → projde s varováním', () => {
		expect(checkRecipient(our, '')).toEqual({
			ok: true,
			warning: 'Doklad neuvádí IČO odběratele — ověř, že je opravdu vystavený na tebe.',
		});
	});

	it('mezery a vedoucí nuly IČO nerozhodují, vnitřní ano', () => {
		expect(checkRecipient('12345678', ' 12345678 ').ok).toBe(true);
		expect(checkRecipient('00012345', '12345').ok).toBe(true);
		// Zahazují se jen nuly zleva: 10000000 a 1 jsou dvě různá IČO.
		expect(checkRecipient('10000000', '1').ok).toBe(false);
	});

	it('bez našeho IČO se jen varuje', () => {
		expect(checkRecipient('', '87654321')).toEqual({
			ok: true,
			warning: 'Nemáš vyplněné vlastní IČO, takže příjemce nejde ověřit.',
		});
	});
});

describe('součet výdajů za období', () => {
	const expenses: Expense[] = [
		exp({
			id: 'claude',
			amountCents: 500_00,
			date: date('2026-01-05'),
		}),
		exp({
			id: 'domena',
			amountCents: 300_00,
			date: date('2026-03-20'),
		}),
		exp({
			id: 'notebook',
			amountCents: 45_000_00,
			date: date('2026-02-01'),
		}),
	];

	it('předplatné zapsané jednou se počítá jen v měsíci svého data, nic se nedopočítává', () => {
		expect(expensesTotalCents(expenses, (d) => periodOf(d) === period('2026-01'))).toBe(500_00);
		expect(expensesTotalCents(expenses, (d) => periodOf(d) === period('2026-03'))).toBe(300_00);
		expect(expensesTotalCents(expenses, (d) => periodOf(d) === period('2026-04'))).toBe(0);
	});

	it('jednorázový doklad se počítá v měsíci, kdy je datovaný', () => {
		expect(expensesTotalCents(expenses, (d) => periodOf(d) === period('2026-02'))).toBe(45_000_00);
	});

	it('stejný měsíc jiného roku se nepočítá', () => {
		expect(expensesTotalCents(expenses, (d) => periodOf(d) === period('2025-01'))).toBe(0);
		expect(expensesTotalCents(expenses, (d) => periodOf(d) === period('2027-03'))).toBe(0);
	});

	it('celý rok sečte všechny jeho měsíce', () => {
		expect(expensesTotalCents(expenses, (d) => yearOf(d) === 2026)).toBe(500_00 + 300_00 + 45_000_00);
	});

	it('víc výdajů v jednom měsíci se sečte', () => {
		const march = [
			...expenses,
			exp({
				id: 'licence',
				amountCents: 1_200_00,
				date: date('2026-03-01'),
			}),
		];
		expect(expensesTotalCents(march, (d) => periodOf(d) === period('2026-03'))).toBe(300_00 + 1_200_00);
	});
});

describe('výdaj z přijatého dokladu', () => {
	it('předvyplní výdaj z dokladu a doplní pouze chybějící údaje', () => {
		const doc = {
			file: 'doklad.pdf',
			supplier: 'Dodavatel',
			supplierIco: '12345679',
			number: '',
			uuid: '',
			description: 'Hosting',
			amountCents: 1200,
			date: date('2026-03-01'),
			recipientIco: '',
		};
		const expense = expenseFromReceived(doc);
		expect(expense).toEqual({
			id: expense.id,
			supplier: 'Dodavatel',
			supplierIco: '12345679',
			description: 'Hosting',
			amountCents: 1200,
			date: date('2026-03-01'),
			documentFile: 'doklad.pdf',
		});
		const withoutIco = expenseFromReceived({
			...doc,
			supplierIco: '',
		});
		expect(withoutIco).toEqual({
			...expense,
			id: withoutIco.id,
			supplierIco: undefined,
		});
		expect(withoutIco.id).not.toBe(expense.id);
	});
	it('číslo a UUID dokladu převezme jen vyplněné', () => {
		const doc = {
			file: 'doklad.pdf',
			supplier: 'Dodavatel',
			supplierIco: '',
			number: 'F2026-7',
			uuid: 'ABC-1',
			description: '',
			amountCents: 0,
			date: date('2026-03-01'),
			recipientIco: '',
		};
		expect(expenseFromReceived(doc)).toMatchObject({
			documentNumber: 'F2026-7',
			documentUuid: 'ABC-1',
		});
		expect(
			expenseFromReceived({
				...doc,
				number: '',
				uuid: '',
			}),
		).toMatchObject({
			documentNumber: undefined,
			documentUuid: undefined,
		});
	});
	it('týž přijatý doklad pozná podle UUID nebo dodavatele s číslem', () => {
		const doc = {
			file: 'prijate/a.pdf',
			supplier: 'Dodavatel',
			supplierIco: '0012345679',
			number: 'F2026-7',
			uuid: 'abc-1',
			description: '',
			amountCents: 0,
			date: date('2026-03-01'),
			recipientIco: '',
		};
		const base = {
			id: 'v1',
			supplier: 'X',
			description: '',
			amountCents: 0,
			date: today(),
		};
		const same = (expense: Partial<Expense>, over: Partial<typeof doc> = {}) =>
			sameReceivedDocument(
				{
					...base,
					...expense,
				},
				{
					...doc,
					...over,
				},
			);

		expect(
			same(
				{ documentFile: 'prijate/a.pdf' },
				{
					number: '',
					uuid: '',
				},
			),
		).toBe(false);
		expect(same({ documentUuid: 'ABC-1' })).toBe(true);
		expect(same({ documentUuid: 'ABC-2' }, { number: '' })).toBe(false);
		expect(same({}, { number: '' })).toBe(false);
		expect(
			same(
				{ documentUuid: '' },
				{
					uuid: '',
					number: '',
				},
			),
		).toBe(false);
		expect(
			same(
				{
					supplierIco: '12345679',
					documentNumber: 'F2026-7',
				},
				{ uuid: '' },
			),
		).toBe(true);
		expect(
			same(
				{
					supplierIco: '12345679',
					documentNumber: 'F2026-8',
				},
				{ uuid: '' },
			),
		).toBe(false);
		expect(
			same(
				{
					supplierIco: '99999999',
					documentNumber: 'F2026-7',
				},
				{ uuid: '' },
			),
		).toBe(false);
		expect(same({ documentNumber: 'F2026-7' }, { uuid: '' })).toBe(false);
		expect(
			same(
				{
					supplierIco: '12345679',
					documentNumber: '',
				},
				{
					uuid: '',
					number: '',
				},
			),
		).toBe(false);
		expect(
			same(
				{
					supplierIco: '',
					documentNumber: 'F2026-7',
				},
				{
					uuid: '',
					supplierIco: '',
				},
			),
		).toBe(false);
	});
});

describe('nový výdaj a soubor výdajů', () => {
	it('nový výdaj je prázdný s dnešním datem a vlastním id', () => {
		const expense = emptyExpense();
		expect(expense).toEqual({
			id: expense.id,
			supplier: '',
			description: '',
			amountCents: 0,
			date: today(),
		});
		expect(emptyExpense().id).not.toBe(expense.id);
	});
	it('chybějící soubor je prázdná evidence', () => {
		expect(expensesFileSchema.parse({})).toEqual(emptyExpenses());
	});
	it('výdaj bez dodavatele a popisu neprojde', () => {
		const result = expensesFileSchema.safeParse({
			expenses: [
				{
					id: 'e',
					amountCents: 123,
					date: '2026-03-01',
				},
			],
		});
		expect(result.error?.issues.map((issue) => issue.path)).toEqual([
			['expenses', 0, 'supplier'],
			['expenses', 0, 'description'],
		]);
	});
	it('částka výdaje musí být číslo', () => {
		expect(
			expensesFileSchema.safeParse({
				expenses: [
					{
						...emptyExpense(),
						amountCents: 'x',
					},
				],
			}).success,
		).toBe(false);
	});
});
