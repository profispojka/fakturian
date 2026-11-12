import { DEFAULT_DUE_DAYS, DocumentKind, NON_VAT_PAYER_NOTE } from '~/constants/invoice';
import { today, addDays, MIN_YEAR, MAX_YEAR } from '~/utils/date';
import { invoiceTotalCents, supplierToParty, variableSymbolFor, type CreditTarget } from '~/utils/invoice';
import { czechList } from '~/utils/locales';
import { czkFromCents } from '~/utils/money';
import { fitsTemplate, validateNumber } from '~/utils/numbering';
import { formatAmount, type LimitOverflow, type UsageLine } from '~/utils/pricelist';
import { isValidDic, isValidIco, isValidZip } from '~/utils/validators';
import { z, type Zod } from '~/utils/zod';

import type {
	BrokenInvoice as WireBrokenInvoice,
	Invoice as WireInvoice,
	InvoiceLine as WireInvoiceLine,
	InvoiceParty as WireInvoiceParty,
	InvoiceSummary as WireInvoiceSummary,
} from '~/bindings';
import type { DocumentType } from '~/constants/invoice';
import type { Supplier } from '~/schemas/suppliers';
import type { DateString } from '~/utils/date';

// IPC vede chybějící rok čerpání i jako `null`; formulář nepovinnou hodnotu vede jako `undefined`.
// `id` zná jen formulář: tabulka podle něj klíčuje řádky, do dokladu nejde.
export interface InvoiceLine extends Omit<WireInvoiceLine, 'usageYear'> {
	id: string;
	usageYear?: number;
}

export type InvoiceParty = Required<WireInvoiceParty>;

type WireDateFields = 'issueDate' | 'dueDate' | 'originalIssueDate';

export interface InvoiceSummary extends Required<
	Omit<WireInvoiceSummary, 'documentType' | 'issueDate' | 'dueDate' | 'usageLines'>
> {
	documentType: DocumentType;
	issueDate: DateString;
	dueDate?: DateString;
	usageLines: UsageLine[];
}

export type BrokenInvoice = WireBrokenInvoice;

export interface InvoiceList {
	items: InvoiceSummary[];
	broken: BrokenInvoice[];
}

export interface Invoice extends Required<
	Omit<WireInvoice, 'supplier' | 'customer' | 'lines' | 'documentType' | WireDateFields>
> {
	documentType: DocumentType;
	lines: InvoiceLine[];
	supplier: InvoiceParty;
	customer: InvoiceParty;
	issueDate: DateString;
	dueDate?: DateString;
	originalIssueDate?: DateString;
}

/** Rozepsaný doklad: datum vystavení je povinné, ale než ho uživatel zadá, chybí. */
export type InvoiceForm = Omit<Invoice, 'issueDate'> & { issueDate?: DateString };

const documentTypeSchema = z.enum(DocumentKind);

export function emptyParty(): InvoiceParty {
	return {
		name: '',
		ico: '',
		dic: '',
		address: {
			street: '',
			city: '',
			zip: '',
		},
		email: '',
		registration: '',
	};
}

export function emptyLine(): InvoiceLine {
	return {
		id: crypto.randomUUID(),
		description: '',
		quantity: 1,
		unit: 'ks',
		unitPriceCents: 0,
	};
}

export function newInvoice(supplier: Supplier | null, number: string): Invoice {
	const issue = today();
	const dueDays = supplier?.defaultDueDays ?? DEFAULT_DUE_DAYS;
	let supplierParty = emptyParty();
	if (supplier) supplierParty = supplierToParty(supplier);
	return {
		number,
		uuid: '',
		documentType: DocumentKind.Invoice,
		originalInvoice: '',
		originalUuid: '',
		issueDate: issue,
		dueDate: addDays(issue, dueDays),
		supplier: supplierParty,
		customer: emptyParty(),
		vatNote: NON_VAT_PAYER_NOTE,
		bankAccount: supplier?.bankAccount ?? '',
		bankCode: supplier?.bankCode ?? '',
		iban: supplier?.iban ?? '',
		variableSymbol: variableSymbolFor(number),
		note: '',
		lines: [emptyLine()],
	};
}

// Import přinese doklady z cizího softwaru, proto striktní schémata: `z.object` by neznámý klíč tiše
// zahodil a s ním třeba `itemId` s vazbou na ceník.
// Stryker disable all: Deklarativní IPC schémata hlídají kontrakt přes přesné validní a chybné odpovědi.
const invoicePartySchema = z.strictObject({
	name: z.string(),
	ico: z.string(),
	dic: z.string(),
	address: z.strictObject({
		street: z.string(),
		city: z.string(),
		zip: z.string(),
	}),
	email: z.string(),
	registration: z.string(),
}) satisfies Zod.ZodType<InvoiceParty>;

export const invoiceFromVaultSchema = z.strictObject({
	number: z.string(),
	uuid: z.string(),
	documentType: documentTypeSchema,
	originalInvoice: z.string(),
	originalIssueDate: z.isdocDateOrBlank(),
	originalUuid: z.string(),
	issueDate: z.isdocDate(),
	dueDate: z.isdocDateOrBlank(),
	supplier: invoicePartySchema,
	customer: invoicePartySchema,
	vatNote: z.string(),
	bankAccount: z.string(),
	bankCode: z.string(),
	iban: z.string(),
	variableSymbol: z.string(),
	note: z.string(),
	lines: z.array(
		z
			.strictObject({
				description: z.string(),
				quantity: z.number(),
				unit: z.string(),
				unitPriceCents: z.number().int(),
				// Jediná vazba doklad ↔ položka ceníku; bez něj se řádek nezapočítá do vykázaného množství.
				itemId: z.string(),
				// Rok čerpání limitu drží doklad sám. Rozsah zrcadlí formulář i `lineUsageYear` v hlavním procesu.
				usageYear: z.number().int().min(MIN_YEAR).max(MAX_YEAR).optional(),
			})
			.transform((line) => ({
				id: crypto.randomUUID(),
				...line,
			})),
	),
}) satisfies Zod.ZodType<Invoice>;

const invoiceSummarySchema = z.strictObject({
	number: z.string(),
	customer: z.string(),
	issueDate: z.isdocDate(),
	dueDate: z.isdocDateOrBlank(),
	totalCents: z.number().int(),
	variableSymbol: z.string(),
	documentType: documentTypeSchema,
	originalInvoice: z.string(),
	sentAt: z.string().nullable(),
	// Vykázané množství se počítá z archivu, takže vazba na ceník i rok čerpání chodí s přehledem.
	usageLines: z.array(
		z.strictObject({
			itemId: z.string(),
			quantity: z.number(),
			usageYear: z.number().int().min(MIN_YEAR).max(MAX_YEAR).optional(),
		}),
	),
	path: z.string(),
}) satisfies Zod.ZodType<InvoiceSummary>;

const brokenInvoiceSchema = z.strictObject({
	fileName: z.string(),
	path: z.string(),
	reason: z.string(),
}) satisfies Zod.ZodType<BrokenInvoice>;

export const invoiceListSchema = z.strictObject({
	items: z.array(invoiceSummarySchema),
	broken: z.array(brokenInvoiceSchema),
}) satisfies Zod.ZodType<InvoiceList>;
// Stryker restore all

// Stryker disable all: Formulářová schémata ověřují samostatné hraniční a chybové scénáře.
// Řádek dokladu je jeden řádek textu: řídicí znak by ISDOC zahodil a konec řádku nebo obrácení
// směru by v potvrzovací otázce agenta podvrhlo jiný řádek.
const lineTextSchema = z
	.string()
	.trim()
	.min(1, 'Povinné pole.')
	.refine(
		(text) => !/[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/u.test(text),
		'Bez konců řádků a řídicích znaků.',
	);

// Znaménko ceny se na řádku nehlídá: sleva je řádek se zápornou cenou. Hlídá se až součet dokladu.
export const invoiceLineSchema = z.object({
	usageYear: z
		.number('Zadej číslo.')
		.int('Zadej celé číslo.')
		.min(MIN_YEAR, `Zadej číslo ≥ ${MIN_YEAR}.`)
		.max(MAX_YEAR, `Zadej číslo ≤ ${MAX_YEAR}.`)
		.optional(),
	description: lineTextSchema,
	// Přesně na setiny, ne s tolerancí: PDF i ISDOC tisknou množství v plné přesnosti.
	quantity: z
		.number('Zadej číslo.')
		.gt(0, 'Zadej číslo > 0.')
		.refine((quantity) => Number(quantity.toFixed(2)) === quantity, 'Zadej nejvýš dvě desetinná místa.'),
	unit: lineTextSchema,
	// Celý haléř: doklad nese cenu v haléřích a `lineCents` s ní násobí přes `big.js`.
	unitPriceCents: z.number('Zadej číslo.').int('Zadej celé číslo.'),
});

const formLinesSchema = z
	// Zod neznámý klíč stripuje, takže by výstup schématu ztratil vazbu na ceník.
	.array(invoiceLineSchema.extend({ itemId: z.string().optional() }))
	.min(1, 'Přidej aspoň jednu položku.');

export interface InvoiceContext {
	limitOverflows?: LimitOverflow[];
	/** U dobropisu faktura, kterou opravuje; `null`, když ji archiv nezná. */
	creditTarget?: CreditTarget | null;
	/** Jen u zakládaného dokladu: vystavený doklad nese číslo, pod kterým už je v evidenci. */
	numberTemplate?: string;
}

const invoiceHeaderSchema = z.object({
	// Stejnou `validateNumber` kontroluje i backend; tady proto, aby chyba přišla u pole, ne až po „Uložit".
	number: z.string().superRefine((number, checks) => {
		const error = validateNumber(number);
		if (error)
			checks.addIssue({
				code: 'custom',
				message: error,
			});
	}),
	issueDate: z.dateString(),
	dueDate: z.dateString(),
	customer: z
		.object({
			name: z.string().trim().min(1, 'Vyber nebo zadej odběratele.'),
			ico: z.string(),
			dic: z.string(),
			address: z.object({
				street: z.string(),
				city: z.string(),
				zip: z.string(),
			}),
			email: z.string(),
		})
		.superRefine((customer, checks) => {
			// Hlášky musí pole pojmenovat samy: odběratel se upravuje v dialogu, takže se vypisují ve
			// stavové liště. Bez vybraného odběratele stačí jediná.
			if (!customer.name.trim()) return;
			// DIČ ani e-mail povinné nejsou: DIČ nemá neplátce DPH ani fyzická osoba a fakturu jde předat
			// i papírem.
			const missing = [
				!customer.ico.trim() && 'IČO',
				!customer.address.street.trim() && 'ulice',
				!customer.address.city.trim() && 'město',
				!customer.address.zip.trim() && 'PSČ',
			].filter((label) => label !== false);
			if (missing.length) {
				checks.addIssue({
					code: 'custom',
					message: `Odběrateli chybí ${czechList.format(missing)} — doplň je přes „Upravit".`,
				});
			}
			if (customer.ico.trim() && !isValidIco(customer.ico)) {
				checks.addIssue({
					code: 'custom',
					path: ['ico'],
					message: 'Neplatné IČO odběratele.',
				});
			}
			if (customer.dic.trim() && !isValidDic(customer.dic)) {
				checks.addIssue({
					code: 'custom',
					path: ['dic'],
					message: 'Neplatné DIČ odběratele.',
				});
			}
			if (customer.address.zip.trim() && !isValidZip(customer.address.zip)) {
				checks.addIssue({
					code: 'custom',
					path: ['address', 'zip'],
					message: 'Neplatné PSČ odběratele.',
				});
			}
			if (customer.email.trim() && !z.email().safeParse(customer.email).success) {
				checks.addIssue({
					code: 'custom',
					path: ['email'],
					message: 'Neplatný e-mail odběratele.',
				});
			}
		}),
	bankAccount: z.string(),
	bankCode: z.string(),
	iban: z.string(),
	// Jiný než číselný VS banka odmítne.
	variableSymbol: z.string().trim().max(10, 'Nejvýš 10 znaků.').regex(/^\d*$/, 'Jen číslice.'),
});

const invoiceFormSchema = invoiceHeaderSchema.extend({
	documentType: z.literal(DocumentKind.Invoice),
	note: z.string(),
	// Záporný součet by byl vratka, a ta patří na dobropis.
	lines: formLinesSchema.refine((lines) => invoiceTotalCents({ lines }) >= 0, 'Součet faktury nesmí být záporný.'),
});

const creditNoteFormSchema = invoiceHeaderSchema.extend({
	documentType: z.literal(DocumentKind.CreditNote),
	originalInvoice: z.string(),
	// Poznámka dobropisu je jeho důvod opravy: vysází se na doklad i do ISDOC `Note`.
	note: z.string().trim().min(1, 'Povinné pole.'),
	lines: formLinesSchema.refine((lines) => invoiceTotalCents({ lines }) <= 0, 'Součet dobropisu nesmí být kladný.'),
});

const invoiceBaseSchema = z.discriminatedUnion('documentType', [invoiceFormSchema, creditNoteFormSchema]);

function creditProblem(original: string, totalCents: number, target: CreditTarget | null): string | null {
	if (!target) {
		if (!original.trim()) return 'Dobropis musí odkazovat na fakturu, kterou opravuje.';
		return `Faktura ${original} v evidenci není — dobropis jde vystavit jen k existující faktuře.`;
	}
	if (target.otherCreditNotes.length) {
		return `Faktura ${target.number} už má dobropis ${czechList.format(target.otherCreditNotes)}.`;
	}
	if (totalCents !== -target.totalCents) {
		return `Dobropis musí vrátit celou fakturu ${target.number}, tedy ${czkFromCents(-target.totalCents)}.`;
	}
	return null;
}

// Továrna, ne konstanta: část pravidel závisí na kontextu.
export function invoiceSchema(ctx: InvoiceContext = {}) {
	return invoiceBaseSchema.superRefine((inv, checks) => {
		if (inv.dueDate < inv.issueDate) {
			checks.addIssue({
				code: 'custom',
				path: ['dueDate'],
				message: 'Splatnost před vystavením.',
			});
		}

		// Číslo mimo šablonu `parseSeq` nepřečte, takže by ho další doklad v řadě přeskočil.
		if (ctx.numberTemplate && inv.number.trim() && !fitsTemplate(ctx.numberTemplate, inv.number)) {
			checks.addIssue({
				code: 'custom',
				path: ['number'],
				message: `Číslo neodpovídá číselné řadě ${ctx.numberTemplate} z Nastavení.`,
			});
		}

		// Dobropis jde jen na celou fakturu a jen jednou; částečné vratky appka nevede.
		const credit = ctx.creditTarget;
		if (inv.documentType === DocumentKind.CreditNote && credit !== undefined) {
			const problem = creditProblem(inv.originalInvoice, invoiceTotalCents(inv), credit);
			if (problem)
				checks.addIssue({
					code: 'custom',
					path: ['lines'],
					message: problem,
				});
		}

		// Bankovní spojení se hlídá u zdroje: bez platného účtu `supplierSchema` neprojde a `app.vue`
		// otevře průvodce, který nejde zavřít.

		// Každá přetečená položka zvlášť — se souhrnnou hláškou by uživatel opravil první a o druhé se
		// dozvěděl až při dalším uložení.
		for (const p of ctx.limitOverflows ?? []) {
			let message = `Položka „${p.label}" má vyčerpaný roční limit pro rok ${p.year}.`;
			if (p.remaining > 0) {
				message = `Položka „${p.label}" překračuje roční limit pro rok ${p.year} — zbývá ${formatAmount(p.remaining, p.unit)}.`;
			}
			checks.addIssue({
				code: 'custom',
				path: ['lines'],
				message,
			});
		}
	});
}

export type ValidInvoiceForm = Zod.infer<ReturnType<typeof invoiceSchema>>;
// Stryker restore all
