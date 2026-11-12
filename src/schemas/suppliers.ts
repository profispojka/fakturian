import { DEFAULT_DUE_DAYS } from '~/constants/invoice';
import { DEFAULT_TEMPLATE } from '~/constants/numbering';
import { today, yearOf } from '~/utils/date';
import { fitsTemplate, formatNumber, validateTemplate } from '~/utils/numbering';
import { ibanMatchesAccount } from '~/utils/validators';
import { z, type Zod } from '~/utils/zod';

// Musí sedět s `deriveDueDays` v `desktop/adopt.ts`.
const MAX_DUE_DAYS = 365;
export const defaultDueDaysSchema = z
	.number('Zadej číslo.')
	.int('Zadej celé číslo.')
	.min(0, 'Zadej číslo ≥ 0.')
	.max(MAX_DUE_DAYS, `Zadej číslo ≤ ${MAX_DUE_DAYS}.`);

// Uložený dodavatel smí být neúplný (převzetí vyplní, co najde), `supplierSchema` ho pak nepustí
// k fakturaci. Klíče ale v souboru být musí.
export const supplierStoredSchema = z.looseObject({
	name: z.string(),
	ico: z.string(),
	address: z.looseObject({
		street: z.string(),
		city: z.string(),
		zip: z.string(),
	}),
	registration: z.string(),
	bankAccount: z.string(),
	bankCode: z.string(),
	iban: z.string().optional(),
	email: z.string().optional(),
	defaultDueDays: defaultDueDaysSchema,
	invoiceNumberFormat: z.string(),
	invoiceNumberStart: z.string().optional(),
});

export type Supplier = Zod.infer<typeof supplierStoredSchema>;

export function emptySupplier(): Supplier {
	return {
		name: '',
		ico: '',
		address: {
			street: '',
			city: '',
			zip: '',
		},
		registration: '',
		bankAccount: '',
		bankCode: '',
		defaultDueDays: DEFAULT_DUE_DAYS,
		invoiceNumberFormat: DEFAULT_TEMPLATE,
	};
}

export const supplierSchema = z.object({
	name: z.string().trim().min(1, 'Povinné pole.'),
	ico: z.ico().transform((ico) => ico.replace(/\s+/g, '')),
	registration: z.string(),
	address: z.object({
		street: z.string().trim().min(1, 'Povinné pole.'),
		city: z.string().trim().min(1, 'Povinné pole.'),
		zip: z.zip(),
	}),
	bankAccount: z.bankAccount(),
	bankCode: z.bankCode(),
	// Banka IBAN ukazuje po čtveřicích; ISDOC a QR platba chtějí elektronický tvar bez mezer.
	iban: z
		.string()
		.transform((iban) => iban.replace(/\s+/g, '').toUpperCase())
		.pipe(z.iban('Neplatný IBAN.'))
		.optional(),
	email: z.email('Neplatný e-mail.').optional(),
	defaultDueDays: defaultDueDaysSchema,
});

export type ValidSupplier = Zod.infer<typeof supplierSchema>;

// Jen formulář v Nastavení, ne připravenost k fakturaci: průvodce navázání nenabízí, takže by v něm
// uživatel s vadnou hodnotou uvízl.
export const supplierSettingsSchema = supplierSchema
	.extend({
		// Bez zápisu do rejstříku nebo evidence je faktura neúplná obchodní listina (§ 435 odst. 1 OZ).
		// Průvodce ho nechává na ARES, doplní se tady.
		registration: z.string().trim().min(1, 'Povinné pole.'),
		invoiceNumberFormat: z.string(),
		invoiceNumberStart: z.string().optional(),
	})
	// Číslo mimo šablonu `nextNumber` nepřečte a řada by tiše začala od jedničky — tedy čísly, která
	// klient už má. Rok se nehlídá: navázání platí jen pro svůj rok a loňské se v lednu nerozbije.
	.superRefine((supplier, checks) => {
		if (supplier.iban && !ibanMatchesAccount(supplier.iban, supplier.bankAccount, supplier.bankCode)) {
			checks.addIssue({
				code: 'custom',
				path: ['iban'],
				message: 'IBAN nepatří k zadanému číslu účtu. Oprav ho, nebo pole nech prázdné.',
			});
		}
		const start = supplier.invoiceNumberStart?.trim();
		const template = supplier.invoiceNumberFormat.trim() || DEFAULT_TEMPLATE;
		if (!start || validateTemplate(template) || fitsTemplate(template, start)) return;
		const example = formatNumber(template, yearOf(today()), 137);
		checks.addIssue({
			code: 'custom',
			path: ['invoiceNumberStart'],
			message: `Číslo neodpovídá formátu ${template} — zadej ho celé, např. ${example}.`,
		});
	});

export function supplierReadyForInvoicing(supplier: Supplier | null): boolean {
	return supplier !== null && supplierSchema.safeParse(supplier).success;
}
