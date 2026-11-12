import { today, type DateString } from '~/utils/date';
import { z, type Zod } from '~/utils/zod';

import type { BrokenReceived, ReceivedDocument as WireReceivedDocument } from '~/bindings';

const expenseShape = {
	id: z.string(),
	supplier: z.string(),
	supplierIco: z.string().optional(),
	description: z.string(),
	amountCents: z.number().int(),
	date: z.dateString(),
	documentFile: z.string().optional(),
	// Z ISDOC přijatého dokladu; podle nich se pozná, že týž doklad už ve výdajích je.
	documentNumber: z.string().optional(),
	documentUuid: z.string().optional(),
};

export const expensesFileSchema = z.looseObject({ expenses: z.array(z.looseObject(expenseShape)).default([]) });

// Typ bez indexové signatury `looseObject`: s ní by formulář výdaje četl každé pole jako `unknown`.
export type Expense = Zod.infer<Zod.ZodObject<typeof expenseShape>>;
export type ExpensesFile = { expenses: Expense[] };

export function emptyExpenses(): ExpensesFile {
	return { expenses: [] };
}

// Doklad psal někdo jiný, takže prázdné pole je běžný stav. `recipientIco` ale rozhoduje, jestli je
// doklad vystavený na nás, takže chybět nesmí ani jako klíč.
export const receivedDocumentSchema = z.strictObject({
	file: z.string(),
	supplier: z.string(),
	supplierIco: z.string(),
	number: z.string(),
	uuid: z.string(),
	description: z.string(),
	amountCents: z.number().int(),
	date: z.isdocDate(),
	recipientIco: z.string(),
}) satisfies Zod.ZodType<unknown, WireReceivedDocument>;

export type ReceivedDocument = Zod.infer<typeof receivedDocumentSchema>;

export const brokenReceivedListSchema = z.array(
	z.strictObject({
		file: z.string(),
		reason: z.string(),
	}) satisfies Zod.ZodType<BrokenReceived>,
);

export type { BrokenReceived };

export type ExpenseForm = Omit<Expense, 'date'> & { date?: DateString };

export const expenseFormSchema = z.object({
	supplier: z.string().trim().min(1, 'Povinné pole.'),
	amountCents: z
		.number('Zadej číslo.')
		.int('Zadej celé číslo.')
		.refine((cents) => cents !== 0, 'Vyplň částku.'),
	date: z.dateString(),
});

export type ValidExpenseForm = Zod.infer<typeof expenseFormSchema>;

export function emptyExpense(): Expense {
	return {
		id: crypto.randomUUID(),
		supplier: '',
		description: '',
		amountCents: 0,
		date: today(),
	};
}
