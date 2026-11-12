import { DocumentKind, type DocumentType } from '~/constants/invoice';
import { issuesText } from '~/utils/errors';
import { z, type Zod } from '~/utils/zod';

import type { Invoice_Serialize, InvoiceLine_Serialize, InvoiceParty as WireParty } from '~/bindings';

export type InvoiceParty = Required<WireParty>;

export interface InvoiceLine extends Omit<InvoiceLine_Serialize, 'usageYear'> {
	usageYear?: number;
}

// Doklad, jak projde kontrolou na hranici: nepovinná pole jsou doplněná a druh dokladu je známý.
export interface Invoice extends Omit<Invoice_Serialize, 'documentType' | 'supplier' | 'customer' | 'lines'> {
	documentType: DocumentType;
	supplier: InvoiceParty;
	customer: InvoiceParty;
	lines: InvoiceLine[];
}

// Stryker disable next-line Regex: ekvivalentní mutant, `String(číslo)` s exponentem má tvar celý, takže kotvy nic nezmění.
const EXPONENT = /^(-?)(\d)\.?(\d*)e([+-]\d+)$/;

// Nejkratší zápis, který se přečte zpátky na totéž číslo, ale bez exponentu: `String(1e21)` ho
// napíše a `xs:decimal` ho nepovoluje.
export function fmtnum(value: number): string {
	const shortest = String(value);
	const match = EXPONENT.exec(shortest);
	if (!match) return shortest;
	const [, sign, lead, fraction, exponent] = match;
	const digits = `${lead}${fraction}`;
	const point = 1 + Number(exponent);
	// Stryker disable next-line EqualityOperator: ekvivalentní mutant, `String()` píše exponent až od 1e21 nebo pod 1e-6, takže `point` nulu nevyjde.
	if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
	return `${sign}${digits.padEnd(point, '0')}`;
}

const partySchema = z.strictObject({
	name: z.string(),
	ico: z.string().default(''),
	dic: z.string().default(''),
	address: z
		.strictObject({
			street: z.string(),
			city: z.string(),
			zip: z.string(),
		})
		.default(() => ({
			street: '',
			city: '',
			zip: '',
		})),
	email: z.string().default(''),
	registration: z.string().default(''),
});

const invoiceSchema = z.strictObject({
	number: z.string(),
	uuid: z.string().default(''),
	documentType: z
		.enum(DocumentKind, { error: (issue) => `Neznámý typ dokladu ${String(issue.input)}.` })
		.default(DocumentKind.Invoice),
	originalInvoice: z.string().default(''),
	// Nepovinné datum posílá frontend jako prázdný řetězec a tak ho vede i model.
	originalIssueDate: z
		.string()
		.transform((text) => text.trim() || undefined)
		.pipe(z.dateString().optional())
		.transform((date) => date ?? '')
		.default(''),
	originalUuid: z.string().default(''),
	issueDate: z.dateString(),
	// Prázdná splatnost by dala `PaymentDueDate`, který XSD odmítne.
	dueDate: z.dateString(),
	supplier: partySchema,
	customer: partySchema,
	vatNote: z.string().default(''),
	bankAccount: z.string().default(''),
	bankCode: z.string().default(''),
	iban: z.string().default(''),
	variableSymbol: z.string().default(''),
	note: z.string().default(''),
	lines: z.array(
		z.strictObject({
			description: z.string(),
			quantity: z.number(),
			unit: z.string(),
			unitPriceCents: z.int(),
			itemId: z.string().default(''),
			// Rozsah zrcadlí formulář i `lineUsageYear`: jiný rok by zapsal doklad, který pak nejde přečíst.
			usageYear: z
				.int()
				.min(1000)
				.max(9999)
				.nullish()
				.transform((year) => year ?? undefined),
		}),
	),
}) satisfies Zod.ZodType<Invoice>;

// Doklad z webview se ověří jednou, na vstupu příkazu; dál se mu věří.
export function invoiceArgument(value: unknown): Invoice {
	const invoice = invoiceSchema.safeParse(value);
	if (!invoice.success) throw new Error(`Doklad má neplatný tvar (${issuesText(invoice.error)}).`);
	return invoice.data;
}
