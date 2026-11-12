import { defaultDueDaysSchema } from '~/schemas/suppliers';
import { z, type Zod } from '~/utils/zod';

import type {
	AdoptCandidate as WireAdoptCandidate,
	AdoptedSupplier as WireAdoptedSupplier,
	AdoptScan as WireAdoptScan,
	ImportedCustomer as WireImportedCustomer,
	ImportReport as WireImportReport,
} from '~/bindings';

// Údaje odběratele tak, jak je doklad nese. Jestli z nich vznikne kontakt, rozhoduje až
// `newContactsFromImport` stejným schématem jako formulář.
export const importedCustomerSchema = z.strictObject({
	name: z.string(),
	ico: z.string(),
	dic: z.string(),
	address: z.strictObject({
		street: z.string(),
		city: z.string(),
		zip: z.string(),
	}),
	email: z.string(),
}) satisfies Zod.ZodType<WireImportedCustomer>;

export type ImportedCustomer = Zod.infer<typeof importedCustomerSchema>;

export const adoptedSupplierSchema = z.strictObject({
	name: z.string(),
	ico: z.string(),
	address: z.strictObject({
		street: z.string(),
		city: z.string(),
		zip: z.string(),
	}),
	email: z.string(),
	registration: z.string(),
	bankAccount: z.string(),
	bankCode: z.string(),
	iban: z.string(),
	invoiceNumberFormat: z.string(),
	defaultDueDays: defaultDueDaysSchema.nullable(),
}) satisfies Zod.ZodType<WireAdoptedSupplier>;

export type AdoptedSupplier = Zod.infer<typeof adoptedSupplierSchema>;

// Stryker disable all: Deklarativní IPC schémata hlídají přesné validní a chybné odpovědi.
export const importReportSchema = z.strictObject({
	imported: z.array(
		z.strictObject({
			number: z.string(),
			customer: z.string(),
			issueDate: z.isdocDate(),
			totalCents: z.number().int(),
		}),
	),
	skipped: z.array(
		z.strictObject({
			file: z.string(),
			reason: z.string(),
		}),
	),
	customers: z.array(importedCustomerSchema),
}) satisfies Zod.ZodType<unknown, WireImportReport>;

export type ImportReport = Zod.infer<typeof importReportSchema>;

const adoptCandidateSchema = z.strictObject({
	path: z.string(),
	file: z.string(),
	number: z.string(),
	customer: z.string(),
	issueDate: z.isdocDate(),
	totalCents: z.number().int(),
}) satisfies Zod.ZodType<unknown, WireAdoptCandidate>;

// Druhý parametr `ZodType` je vstup: schéma datum transformuje, takže se odpovědi IPC podobá to, co
// přijde, ne to, co vyleze.
export const adoptScanSchema = z.strictObject({
	candidates: z.array(adoptCandidateSchema),
	skipped: z.array(
		z.strictObject({
			file: z.string(),
			reason: z.string(),
		}),
	),
	supplier: adoptedSupplierSchema.nullable(),
	truncated: z.boolean(),
}) satisfies Zod.ZodType<unknown, WireAdoptScan>;

export type AdoptScan = Zod.infer<typeof adoptScanSchema>;
// Stryker restore all
