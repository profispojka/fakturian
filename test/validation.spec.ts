import { afterEach, describe, expect, it, vi } from 'vitest';

import { contactSchema } from '~/schemas/customers';
import { invoiceLineSchema, invoiceSchema, newInvoice } from '~/schemas/invoices';
import { priceItemSchema } from '~/schemas/pricelist';
import {
	defaultDueDaysSchema,
	supplierReadyForInvoicing,
	supplierSchema,
	supplierSettingsSchema,
} from '~/schemas/suppliers';
import { emptyVaultData, vaultDataSchema } from '~/schemas/vault-data';
import { czkFromCents } from '~/utils/money';
import {
	ibanMatchesAccount,
	isValidBankAccount,
	isValidBankCode,
	isValidDic,
	isValidIco,
	isValidZip,
} from '~/utils/validators';
import { z, type Zod } from '~/utils/zod';

import { date } from './setup/dates';

import type { Contact } from '~/schemas/customers';
import type { Invoice, InvoiceContext } from '~/schemas/invoices';
import type { PriceItem } from '~/schemas/pricelist';
import type { Supplier } from '~/schemas/suppliers';

// Který údaj a jakou hláškou neprošel.
function issuesOf(schema: Zod.ZodType, value: unknown) {
	return (schema.safeParse(value).error?.issues ?? []).map((issue) => ({
		path: issue.path,
		message: issue.message,
	}));
}

describe('rok čerpání položky', () => {
	const line = {
		description: 'Práce',
		quantity: 8,
		unit: 'hod',
		unitPriceCents: 100_000,
	};

	it.each([undefined, 1000, 2025, 9999])('přijme platný rok %s nebo implicitní rok', (usageYear) => {
		expect(
			invoiceLineSchema.parse({
				...line,
				usageYear,
			}),
		).toEqual({
			...line,
			usageYear,
		});
	});

	it.each([
		['2025', 'Zadej číslo.'],
		[2025.5, 'Zadej celé číslo.'],
		[999, 'Zadej číslo ≥ 1000.'],
		[10000, 'Zadej číslo ≤ 9999.'],
	])('odmítne rok %s u pole roku', (usageYear, message) => {
		expect(
			issuesOf(invoiceLineSchema, {
				...line,
				usageYear,
			}),
		).toEqual([
			{
				path: ['usageYear'],
				message,
			},
		]);
		const invoice = buildInvoice();
		expect(
			issuesOf(invoiceSchema(), {
				...invoice,
				lines: [
					{
						...line,
						usageYear,
					},
				],
			}),
		).toEqual([
			{
				path: ['lines', 0, 'usageYear'],
				message,
			},
		]);
	});

	it.each([
		[4, 'Položka „Práce" překračuje roční limit pro rok 2025 — zbývá 4 hod.'],
		[0, 'Položka „Práce" má vyčerpaný roční limit pro rok 2025.'],
	])('chyba limitu určí konkrétní rok při zbytku %s', (remaining, message) => {
		const schema = invoiceSchema({
			limitOverflows: [
				{
					label: 'Práce',
					unit: 'hod',
					year: 2025,
					remaining,
				},
			],
		});
		expect(issuesOf(schema, buildInvoice())).toEqual([
			{
				path: ['lines'],
				message,
			},
		]);
	});
});

function invalidFields(schema: Zod.ZodType, value: unknown): string[] {
	const result = schema.safeParse(value);
	return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
}

describe('isValidIco', () => {
	it('platné IČO (kontrolní číslice)', () => {
		expect(isValidIco('27082440')).toBe(true);
		expect(isValidIco('25596641')).toBe(true);
	});
	it('neplatné IČO', () => {
		expect(isValidIco('12345678')).toBe(false);
		expect(isValidIco('1234567')).toBe(false);
		expect(isValidIco('abc12345')).toBe(false);
		expect(isValidIco('')).toBe(false);
	});
	it('toleruje mezery', () => {
		expect(isValidIco('270 824 40')).toBe(true);
	});
});

describe('isValidDic', () => {
	it('platné DIČ', () => {
		expect(isValidDic('CZ27082440')).toBe(true);
		expect(isValidDic('CZ1234567890')).toBe(true);
		expect(isValidDic('cz27082440')).toBe(true);
	});
	it('neplatné DIČ', () => {
		expect(isValidDic('27082440')).toBe(false);
		expect(isValidDic('SK27082440')).toBe(false);
		expect(isValidDic('CZ123')).toBe(false);
	});
});

describe('isValidZip / isValidBankCode / isValidBankAccount', () => {
	it('PSČ 5 číslic, povolí mezeru', () => {
		expect(isValidZip('11000')).toBe(true);
		expect(isValidZip('110 00')).toBe(true);
		expect(isValidZip('1100')).toBe(false);
	});
	it('kód banky', () => {
		expect(isValidBankCode('0800')).toBe(true);
		expect(isValidBankCode('800')).toBe(false);
	});
	it('číslo účtu s předčíslím i bez', () => {
		expect(isValidBankAccount('2000145399')).toBe(true);
		expect(isValidBankAccount('19-2000145399')).toBe(true);
		expect(isValidBankAccount('1')).toBe(false);
		expect(isValidBankAccount('abc')).toBe(false);
	});
	it('mod-11 odhalí překlep v poslední číslici hlavní části i předčíslí', () => {
		expect(isValidBankAccount('2000145398')).toBe(false);
		expect(isValidBankAccount('18-2000145399')).toBe(false);
	});
	it.each(['0000000000', '00', '19-0000000000', '000000-00'])('účet z nul %s neprojde', (account) => {
		expect(isValidBankAccount(account)).toBe(false);
	});
	it('IBAN patří k účtu jen se stejným kódem banky, předčíslím i číslem', () => {
		expect(ibanMatchesAccount('CZ6508000000192000145399', '19-2000145399', '0800')).toBe(true);
		expect(ibanMatchesAccount('cz65 0800 0000 1920 0014 5399', ' 19-2000145399 ', '08 00')).toBe(true);
		expect(ibanMatchesAccount('CZ7908000000002000145399', '2000145399', '0800')).toBe(true);
		expect(ibanMatchesAccount('CZ7908000000002000145399', '19-2000145399', '0800')).toBe(false);
		expect(ibanMatchesAccount('CZ6508000000192000145399', '19-2000145398', '0800')).toBe(false);
		expect(ibanMatchesAccount('CZ6508000000192000145399', '19-2000145399', '0100')).toBe(false);
		expect(ibanMatchesAccount('SK6508000000192000145399', '19-2000145399', '0800')).toBe(false);
		expect(ibanMatchesAccount('CZ6508000000192000145399', 'abc', '0800')).toBe(false);
		expect(ibanMatchesAccount('', '19-2000145399', '0800')).toBe(false);
	});
});

describe('datum na hranici', () => {
	const badDate = 'Datum musí být ve tvaru RRRR-MM-DD.';

	it('z.dateString() vydá datum', () => {
		expect(String(z.dateString().parse('2026-05-29'))).toBe('2026-05-29');
	});

	it('z.isdocDate() převede časový posun na kalendářní datum', () => {
		expect(String(z.isdocDate().parse('2026-03-01+14:00'))).toBe('2026-03-01');
		expect(String(z.isdocDate().parse('2026-03-01-14:00'))).toBe('2026-03-01');
	});

	it('z.isdocDate() odmítne neplatný den, neplatný posun i prázdno', () => {
		expect(issuesOf(z.isdocDate(), '2026-02-30Z')).toEqual([
			{
				path: [],
				message: badDate,
			},
		]);
		expect(issuesOf(z.isdocDate(), '2026-03-01+14:01')).toEqual([
			{
				path: [],
				message: badDate,
			},
		]);
		expect(issuesOf(z.isdocDate(), '')).toEqual([
			{
				path: [],
				message: badDate,
			},
		]);
	});

	it('z.dateString() vyžaduje datum bez posunu', () => {
		expect(issuesOf(z.dateString(), '2026-03-01Z')).toEqual([
			{
				path: [],
				message: badDate,
			},
		]);
	});

	it('z.dateString() odmítne nesmysl i prázdno, chybějící datum je povinné', () => {
		expect(issuesOf(z.dateString(), '2026-02-30')).toEqual([
			{
				path: [],
				message: badDate,
			},
		]);
		expect(issuesOf(z.dateString(), '')).toEqual([
			{
				path: [],
				message: badDate,
			},
		]);
		expect(issuesOf(z.dateString(), undefined)).toEqual([
			{
				path: [],
				message: 'Povinné pole.',
			},
		]);
	});

	it('…OrBlank bere prázdno jako chybějící datum, překlep ne', () => {
		expect(z.isdocDateOrBlank().parse('')).toBeUndefined();
		expect(z.isdocDateOrBlank().parse('  ')).toBeUndefined();
		expect(String(z.isdocDateOrBlank().parse('2026-03-01-14:00'))).toBe('2026-03-01');
		expect(issuesOf(z.isdocDateOrBlank(), '2026-03-01+14:01')).toEqual([
			{
				path: [],
				message: badDate,
			},
		]);
	});
});

describe('sdílené formáty', () => {
	it.each([
		[z.ico(), '12345678', 'Neplatné IČO (8 číslic).'],
		[z.ico(), '  ', 'Povinné pole.'],
		[z.zip(), '123', 'PSČ má 5 číslic.'],
		[z.zip(), '', 'Povinné pole.'],
	])('%# pojmenuje vadnou hodnotu jedinou hláškou', (schema, value, message) => {
		expect(issuesOf(schema, value)).toEqual([
			{
				path: [],
				message,
			},
		]);
	});
});

const goodSupplier = (): Supplier => ({
	name: 'Jan Dodavatel',
	ico: '27082440',
	address: {
		street: 'Ulice 1',
		city: 'Praha',
		zip: '11000',
	},
	registration: 'Fyzická osoba zapsaná v živnostenském rejstříku, Živnostenský úřad Praha 1',
	bankAccount: '2000145399',
	bankCode: '0800',
	iban: 'CZ7908000000002000145399',
	email: 'jan@x.cz',
	defaultDueDays: 14,
	invoiceNumberFormat: '{RRRR}{NNNN}',
});

describe('supplierReadyForInvoicing', () => {
	it('kompletní dodavatel je připraven, null a nekompletní ne', () => {
		expect(supplierReadyForInvoicing(goodSupplier())).toBe(true);
		expect(supplierReadyForInvoicing(null)).toBe(false);
		const s = goodSupplier();
		s.bankAccount = '';
		expect(supplierReadyForInvoicing(s)).toBe(false);
	});
});

describe('supplierSchema', () => {
	it('platný dodavatel nemá chyby', () => {
		expect(invalidFields(supplierSchema, goodSupplier())).toEqual([]);
	});
	it('hlásí chybějící povinná pole', () => {
		const s = goodSupplier();
		s.name = '';
		s.ico = '';
		s.address.street = '';
		s.address.zip = '';
		s.bankAccount = '';
		s.bankCode = '';
		expect(invalidFields(supplierSchema, s)).toEqual(
			expect.arrayContaining(['name', 'ico', 'address.street', 'address.zip', 'bankAccount', 'bankCode']),
		);
	});
	it('zápis do rejstříku vyžaduje jen Nastavení, k fakturaci připraví dodavatele i bez něj', () => {
		const s = goodSupplier();
		s.registration = '  ';
		expect(supplierReadyForInvoicing(s)).toBe(true);
		expect(invalidFields(supplierSettingsSchema, s)).toEqual(['registration']);
	});

	it('IBAN jiného účtu Nastavení odmítne, prázdný i shodný pustí a k fakturaci nebrání', () => {
		const mismatched = {
			...goodSupplier(),
			iban: 'CZ6508000000192000145399',
		};
		const { iban: _iban, ...withoutIban } = goodSupplier();

		expect(issuesOf(supplierSettingsSchema, mismatched)).toEqual([
			{
				path: ['iban'],
				message: 'IBAN nepatří k zadanému číslu účtu. Oprav ho, nebo pole nech prázdné.',
			},
		]);
		expect(issuesOf(supplierSettingsSchema, goodSupplier())).toEqual([]);
		expect(issuesOf(supplierSettingsSchema, withoutIban)).toEqual([]);
		expect(supplierReadyForInvoicing(mismatched)).toBe(true);
	});

	describe('navázání na řadu', () => {
		afterEach(() => {
			vi.useRealTimers();
		});

		function startIssues(format: string, start: string | undefined) {
			return issuesOf(supplierSettingsSchema, {
				...goodSupplier(),
				invoiceNumberFormat: format,
				invoiceNumberStart: start,
			});
		}

		it.each([
			['{RRRR}{NNNN}', '20260137'],
			['{RRRR}{NNNN}', ' 20260137 '],
			['{RRRR}{NNNN}', '20250200'],
			['F{RRRR}-{NNN}', 'F2026-041'],
			['', '20260137'],
			['{RRRR}{NNNN}', ''],
			['{RRRR}{NNNN}', '   '],
			['{RRRR}{NNNN}', undefined],
			['bez roku', '137'],
		])('šablona %s přijme navázání %s', (format, start) => {
			expect(startIssues(format, start)).toEqual([]);
		});

		it.each([
			['{RRRR}{NNNN}', '137', '{RRRR}{NNNN}', '20270137'],
			['{RRRR}-{NNNN}', '20270137', '{RRRR}-{NNNN}', '2027-0137'],
			['  ', '2026-0137', '{RRRR}{NNNN}', '20270137'],
			['{RRRR}{NNNN}', '20264294967296', '{RRRR}{NNNN}', '20270137'],
		])('šablona %s odmítne navázání %s', (format, start, template, example) => {
			vi.useFakeTimers();
			vi.setSystemTime('2027-01-05T10:00');

			expect(startIssues(format, start)).toEqual([
				{
					path: ['invoiceNumberStart'],
					message: `Číslo neodpovídá formátu ${template} — zadej ho celé, např. ${example}.`,
				},
			]);
		});

		it('nečitelné navázání nebrání fakturaci, hlídá ho jen formulář Nastavení', () => {
			expect(
				supplierReadyForInvoicing({
					...goodSupplier(),
					invoiceNumberStart: '137',
				}),
			).toBe(true);
		});

		it('ostatní pole dodavatele hlídá formulář Nastavení stejně', () => {
			expect(
				invalidFields(supplierSettingsSchema, {
					...goodSupplier(),
					ico: '',
				}),
			).toEqual(['ico']);
		});
	});

	it('hlásí neplatný IBAN / e-mail', () => {
		const s = goodSupplier();
		s.iban = 'CZ00';
		s.email = 'nope';
		expect(invalidFields(supplierSchema, s)).toEqual(expect.arrayContaining(['iban', 'email']));
	});
	it('přijme IBAN v elektronickém formátu i dodavatele bez IBANu', () => {
		const electronic = goodSupplier();
		const { iban: _iban, ...without } = goodSupplier();

		expect(invalidFields(supplierSchema, electronic)).not.toContain('iban');
		expect(invalidFields(supplierSchema, without)).not.toContain('iban');
	});
	it('prázdný text místo IBANu odmítne', () => {
		const blank = goodSupplier();
		blank.iban = '';

		expect(invalidFields(supplierSchema, blank)).toEqual(['iban']);
	});
	it.each(['CZ65 0800 0000 1920 0014 5399', 'cz65 0800 0000 1920 0014 5399', ' CZ6508000000192000145399 '])(
		'IBAN %s vložený z banky vydá v elektronickém tvaru',
		(iban) => {
			const s = goodSupplier();
			s.iban = iban;

			expect(supplierSchema.parse(s).iban).toBe('CZ6508000000192000145399');
		},
	);
	it('IČO s mezerami vydá bez nich', () => {
		const s = goodSupplier();
		s.ico = '270 82 440';

		expect(supplierSchema.parse(s).ico).toBe('27082440');
	});
	it.each([
		'CZ6508000000192000145398',
		'CZ6508000',
		`CZ65${'0'.repeat(31)}`,
		'DE00000000000000000066',
		'CZ65 0800 0000 1920 0014 5398',
	])('odmítne neplatný IBAN %s', (iban) => {
		const s = goodSupplier();
		s.iban = iban;

		expect(issuesOf(supplierSchema, s)).toEqual([
			{
				path: ['iban'],
				message: 'Neplatný IBAN.',
			},
		]);
	});
	it('hlásí záporné defaultDueDays', () => {
		const s = goodSupplier();
		s.defaultDueDays = -1;
		expect(invalidFields(supplierSchema, s)).toContain('defaultDueDays');
	});

	it('chybějící kód banky je chyba stejně jako prázdný', () => {
		const { bankCode: _bankCode, ...withoutCode } = goodSupplier();

		expect(invalidFields(supplierSchema, withoutCode)).toContain('bankCode');
		expect(
			invalidFields(supplierSchema, {
				...withoutCode,
				bankCode: '',
			}),
		).toContain('bankCode');
	});

	it('hlásí kód banky, který není čtyřmístný', () => {
		const s = goodSupplier();
		s.bankCode = '80';
		expect(invalidFields(supplierSchema, s)).toContain('bankCode');
	});
});

describe('contactSchema', () => {
	const c = (): Contact => ({
		id: 'x',
		name: 'Acme',
		ico: '27082440',
		dic: 'CZ27082440',
		address: {
			street: 'Ulice 1',
			city: 'Praha',
			zip: '11000',
		},
		email: 'a@b.cz',
	});
	it('platný kontakt', () => {
		expect(invalidFields(contactSchema, c())).toEqual([]);
	});
	it('chybějící jméno', () => {
		const x = c();
		x.name = '';
		expect(invalidFields(contactSchema, x)).toContain('name');
	});
	it('vadné IČO / PSČ / e-mail', () => {
		const x = c();
		x.ico = '12345678';
		x.address.zip = '12';
		x.email = 'foo';
		expect(invalidFields(contactSchema, x)).toEqual(expect.arrayContaining(['ico', 'address.zip', 'email']));
	});
	it('prázdné IČO a adresa se hlásí, DIČ ani e-mail chybět nevadí', () => {
		const x = c();
		x.ico = '';
		delete x.dic;
		delete x.email;
		x.address = {
			street: '',
			city: '',
			zip: '',
		};
		expect(invalidFields(contactSchema, x)).toEqual(['ico', 'address.street', 'address.city', 'address.zip']);
	});
});

describe('priceItemSchema', () => {
	const p = (): PriceItem => ({
		id: 'x',
		name: 'Práce',
		priceCents: 120_000,
		unit: 'hod',
	});
	it('platná položka', () => {
		expect(invalidFields(priceItemSchema, p())).toEqual([]);
	});
	it('chybějící jméno / jednotka', () => {
		const x = p();
		x.name = '';
		x.unit = '';
		expect(invalidFields(priceItemSchema, x)).toEqual(expect.arrayContaining(['name', 'unit']));
	});
	it('záporná cena', () => {
		const x = p();
		x.priceCents = -1;
		expect(invalidFields(priceItemSchema, x)).toContain('priceCents');
	});
});

describe('invoiceLineSchema', () => {
	it('řádek povolí zápornou i nulovou cenu', () => {
		expect(
			invalidFields(invoiceLineSchema, {
				description: 'Sleva',
				quantity: 1,
				unit: 'ks',
				unitPriceCents: -100,
			}),
		).toEqual([]);
		expect(
			invalidFields(invoiceLineSchema, {
				description: 'X',
				quantity: 1,
				unit: 'ks',
				unitPriceCents: 0,
			}),
		).toEqual([]);
	});
	it('množství musí být > 0', () => {
		const e = invalidFields(invoiceLineSchema, {
			description: 'X',
			quantity: 0,
			unit: 'ks',
			unitPriceCents: 10_000,
		});
		expect(e).toContain('quantity');
	});
});

function buildInvoice(): Invoice {
	const inv = newInvoice(goodSupplier(), '20260001');
	inv.customer = {
		...inv.customer,
		name: 'Acme',
		ico: '27082440',
		address: {
			street: 'Ulice 1',
			city: 'Praha',
			zip: '11000',
		},
		email: 'fakturace@acme.cz',
	};
	inv.lines = [
		{
			id: 'r1',
			description: 'Práce',
			quantity: 1,
			unit: 'hod',
			unitPriceCents: 120_000,
		},
	];
	return inv;
}

describe('invoiceSchema', () => {
	it('platná faktura', () => {
		expect(invalidFields(invoiceSchema(), buildInvoice())).toEqual([]);
	});
	it('chybí odběratel a hlavička', () => {
		const inv = buildInvoice();
		inv.number = '';
		inv.customer.name = '';
		expect(invalidFields(invoiceSchema(), inv)).toEqual(expect.arrayContaining(['number', 'customer.name']));
	});
	it('číslo, které backend na zápisu odmítne, se ohlásí u pole', () => {
		const inv = buildInvoice();
		inv.number = '2026/001';
		expect(issuesOf(invoiceSchema(), inv)).toEqual([
			{
				path: ['number'],
				message:
					'Číslo dokladu může mít nejvýš 64 znaků: písmena bez diakritiky, číslice, mezery, tečky, pomlčky a podtržítka, a musí začínat i končit písmenem nebo číslicí.',
			},
		]);
	});
	it('prázdné číslo nese jedinou hlášku', () => {
		const inv = buildInvoice();
		inv.number = '';
		expect(issuesOf(invoiceSchema({ numberTemplate: '{RRRR}{NNNN}' }), inv)).toEqual([
			{
				path: ['number'],
				message: 'Číslo dokladu je povinné.',
			},
		]);
	});
	it('zakládané číslo musí sedět na šablonu řady', () => {
		const inv = buildInvoice();
		inv.number = 'F2026-001';
		expect(invalidFields(invoiceSchema(), inv)).toEqual([]);
		expect(issuesOf(invoiceSchema({ numberTemplate: '{RRRR}{NNNN}' }), inv)).toEqual([
			{
				path: ['number'],
				message: 'Číslo neodpovídá číselné řadě {RRRR}{NNNN} z Nastavení.',
			},
		]);
		expect(invalidFields(invoiceSchema({ numberTemplate: 'F{RRRR}-{NNN}' }), inv)).toEqual([]);
	});
	it('splatnost před vystavením', () => {
		const inv = buildInvoice();
		inv.issueDate = date('2026-05-29');
		inv.dueDate = date('2026-05-01');
		expect(invalidFields(invoiceSchema(), inv)).toContain('dueDate');
	});
	it('faktura bez položek', () => {
		const inv = buildInvoice();
		inv.lines = [];
		expect(issuesOf(invoiceSchema(), inv)).toEqual([
			{
				path: ['lines'],
				message: 'Přidej aspoň jednu položku.',
			},
		]);
	});
	it('řádek s nulovou cenou projde', () => {
		const inv = buildInvoice();
		inv.lines = [
			{
				id: 'r1',
				description: 'X',
				quantity: 1,
				unit: 'ks',
				unitPriceCents: 0,
			},
		];
		expect(invalidFields(invoiceSchema(), inv)).toEqual([]);
	});
	it('faktura se slevou až na nulu projde', () => {
		const inv = buildInvoice();
		inv.lines = [
			{
				id: 'r1',
				description: 'Práce',
				quantity: 2,
				unit: 'hod',
				unitPriceCents: 50_000,
			},
			{
				id: 'r2',
				description: 'Sleva',
				quantity: 1,
				unit: 'ks',
				unitPriceCents: -100_000,
			},
		];
		expect(invalidFields(invoiceSchema(), inv)).toEqual([]);
	});
	it('faktura se záporným součtem neprojde', () => {
		const inv = buildInvoice();
		inv.lines = [
			{
				id: 'r1',
				description: 'Práce',
				quantity: 2,
				unit: 'hod',
				unitPriceCents: 50_000,
			},
			{
				id: 'r2',
				description: 'Sleva',
				quantity: 1,
				unit: 'ks',
				unitPriceCents: -100_001,
			},
		];
		expect(issuesOf(invoiceSchema(), inv)).toEqual([
			{
				path: ['lines'],
				message: 'Součet faktury nesmí být záporný.',
			},
		]);
	});
	it('dobropis s nulovým součtem projde', () => {
		const inv = buildInvoice();
		inv.documentType = 2;
		inv.note = 'Oprava ceny';
		inv.lines = [
			{
				id: 'r1',
				description: 'Vratka',
				quantity: 1,
				unit: 'ks',
				unitPriceCents: -50_000,
			},
			{
				id: 'r2',
				description: 'Doplatek',
				quantity: 1,
				unit: 'ks',
				unitPriceCents: 50_000,
			},
		];
		expect(invalidFields(invoiceSchema(), inv)).toEqual([]);
	});
	it('dobropis s kladným součtem neprojde', () => {
		const inv = buildInvoice();
		inv.documentType = 2;
		inv.note = 'Oprava ceny';
		inv.lines = [
			{
				id: 'r1',
				description: 'Vratka',
				quantity: 1,
				unit: 'ks',
				unitPriceCents: -50_000,
			},
			{
				id: 'r2',
				description: 'Doplatek',
				quantity: 1,
				unit: 'ks',
				unitPriceCents: 50_001,
			},
		];
		expect(issuesOf(invoiceSchema(), inv)).toEqual([
			{
				path: ['lines'],
				message: 'Součet dobropisu nesmí být kladný.',
			},
		]);
	});
	it('dobropis: záporné ceny OK', () => {
		const inv = buildInvoice();
		inv.documentType = 2;
		inv.note = 'Vrácení nevyužité licence';
		inv.lines = [
			{
				id: 'r1',
				description: 'X',
				quantity: 1,
				unit: 'ks',
				unitPriceCents: -50_000,
			},
		];
		expect(invalidFields(invoiceSchema(), inv)).toEqual([]);
	});
	it('dobropis bez důvodu opravy neprojde', () => {
		const inv = buildInvoice();
		inv.documentType = 2;
		inv.note = '  ';
		inv.lines = [
			{
				id: 'r1',
				description: 'Vratka',
				quantity: 1,
				unit: 'ks',
				unitPriceCents: -50_000,
			},
		];
		expect(issuesOf(invoiceSchema(), inv)).toEqual([
			{
				path: ['note'],
				message: 'Povinné pole.',
			},
		]);
	});
	describe('dobropis na celou fakturu', () => {
		function creditNote(unitPriceCents: number) {
			const inv = buildInvoice();
			inv.documentType = 2;
			inv.originalInvoice = '20260001';
			inv.note = 'Vrácení';
			inv.lines = [
				{
					id: 'r1',
					description: 'Vratka',
					quantity: 2,
					unit: 'ks',
					unitPriceCents,
				},
			];
			return inv;
		}
		const target = {
			number: '20260001',
			totalCents: 100_000,
			otherCreditNotes: [],
		};
		const issues = (inv: Invoice, creditTarget: InvoiceContext['creditTarget']) =>
			issuesOf(invoiceSchema({ creditTarget }), inv);

		it('dobropis na celou částku faktury projde a nese odkaz na fakturu', () => {
			const parsed = invoiceSchema({ creditTarget: target }).safeParse(creditNote(-50_000));
			expect(parsed.data).toEqual(
				expect.objectContaining({
					documentType: 2,
					originalInvoice: '20260001',
				}),
			);
		});

		it.each([
			[-49_999, target],
			[-50_001, target],
		])('částka %s mimo celou fakturu neprojde', (price, credit) => {
			expect(issues(creditNote(price), credit)).toEqual([
				{
					path: ['lines'],
					message: `Dobropis musí vrátit celou fakturu 20260001, tedy ${czkFromCents(-100_000)}.`,
				},
			]);
		});

		it('faktura s dobropisem další dobropis nedostane', () => {
			expect(
				issues(creditNote(-50_000), {
					...target,
					otherCreditNotes: ['20260005', '20260007'],
				}),
			).toEqual([
				{
					path: ['lines'],
					message: 'Faktura 20260001 už má dobropis 20260005 a\u00a020260007.',
				},
			]);
		});

		it('faktura mimo evidenci nebo chybějící odkaz neprojdou', () => {
			expect(issues(creditNote(-50_000), null)).toEqual([
				{
					path: ['lines'],
					message: 'Faktura 20260001 v evidenci není — dobropis jde vystavit jen k existující faktuře.',
				},
			]);
			const unlinked = {
				...creditNote(-50_000),
				originalInvoice: ' ',
			};
			expect(issues(unlinked, null)).toEqual([
				{
					path: ['lines'],
					message: 'Dobropis musí odkazovat na fakturu, kterou opravuje.',
				},
			]);
		});

		it('bez kontextu z archivu a u faktury se vazba nekontroluje', () => {
			expect(issues(creditNote(-1), undefined)).toEqual([]);
			const invoice = buildInvoice();
			expect(issues(invoice, null)).toEqual([]);
		});
	});
	it('faktura bez poznámky projde', () => {
		const inv = buildInvoice();
		inv.note = '';
		expect(invalidFields(invoiceSchema(), inv)).toEqual([]);
	});
	it('nečíselný nebo příliš dlouhý variabilní symbol neprojde', () => {
		const inv = buildInvoice();
		inv.variableSymbol = 'FA-2026-7';
		expect(issuesOf(invoiceSchema(), inv)).toEqual([
			{
				path: ['variableSymbol'],
				message: 'Jen číslice.',
			},
		]);

		inv.variableSymbol = '12345678901';
		expect(issuesOf(invoiceSchema(), inv)).toEqual([
			{
				path: ['variableSymbol'],
				message: 'Nejvýš 10 znaků.',
			},
		]);
	});
	it('prázdný variabilní symbol projde', () => {
		const inv = buildInvoice();
		inv.variableSymbol = '';
		expect(invalidFields(invoiceSchema(), inv)).toEqual([]);
	});
});

describe('data na faktuře', () => {
	it('platná data projdou schématem', () => {
		const inv = buildInvoice();
		inv.issueDate = date('2026-05-29');
		inv.dueDate = date('2026-06-12');
		expect(invalidFields(invoiceSchema(), inv)).toEqual([]);
	});

	it('chybějící splatnost schéma odmítne', () => {
		const inv = buildInvoice();
		delete inv.dueDate;
		expect(invalidFields(invoiceSchema(), inv)).toEqual(['dueDate']);
	});

	it('formulář ověřuje existenci dne i tvar datových stringů', () => {
		const inv = buildInvoice();
		expect(
			invalidFields(invoiceSchema(), {
				...inv,
				dueDate: '2026-13-12',
			}),
		).toEqual(['dueDate']);
		expect(
			invalidFields(invoiceSchema(), {
				...inv,
				issueDate: '2026-02-30',
			}),
		).toEqual(['issueDate']);
	});
});

describe('roční limity ceníku', () => {
	it('překročený roční limit položky zablokuje uložení', () => {
		const inv = buildInvoice();
		const ctx = {
			limitOverflows: [
				{
					label: 'dovolená',
					unit: 'hod',
					remaining: 24,
					year: 2026,
				},
			],
		};

		expect(invalidFields(invoiceSchema(ctx), inv)).toContain('lines');
	});

	it('problém uvede položku i zbývající množství', () => {
		const schema = invoiceSchema({
			limitOverflows: [
				{
					label: 'dovolená',
					unit: 'hod',
					remaining: 24,
					year: 2026,
				},
			],
		});

		expect(issuesOf(schema, buildInvoice())).toEqual([
			{
				path: ['lines'],
				message: 'Položka „dovolená" překračuje roční limit pro rok 2026 — zbývá 24 hod.',
			},
		]);
	});

	it('vyčerpaný limit se hlásí jako vyčerpaný', () => {
		const schema = invoiceSchema({
			limitOverflows: [
				{
					label: 'Školení',
					unit: 'den',
					remaining: 0,
					year: 2026,
				},
			],
		});

		expect(issuesOf(schema, buildInvoice())).toEqual([
			{
				path: ['lines'],
				message: 'Položka „Školení" má vyčerpaný roční limit pro rok 2026.',
			},
		]);
	});

	it('prázdný seznam přeteklých položek fakturu nezastaví', () => {
		expect(invalidFields(invoiceSchema({ limitOverflows: [] }), buildInvoice())).not.toContain('lines');
	});
});

describe('nepovinná pole, která na vstupu vůbec nejsou', () => {
	it('kontakt bez DIČ a e-mailu projde, bez ostatních klíčů ne', () => {
		const address = {
			street: 'Ulice 1',
			city: 'Praha',
			zip: '11000',
		};
		expect(
			invalidFields(contactSchema, {
				name: 'Acme',
				ico: '27082440',
				address,
			}),
		).toEqual([]);
		expect(
			invalidFields(contactSchema, {
				name: 'Acme',
				address: {},
			}),
		).toEqual(['ico', 'address.street', 'address.city', 'address.zip']);
	});

	it('dodavatel bez nepovinných klíčů projde', () => {
		const { iban: _iban, email: _email, ...s } = goodSupplier();

		expect(invalidFields(supplierSchema, s)).toEqual([]);
	});

	it('chybějící klíč se pořád validuje, když se vyplní špatně', () => {
		expect(
			invalidFields(contactSchema, {
				name: 'Acme',
				ico: '123',
				address: {},
			}),
		).toContain('ico');
		expect(
			invalidFields(contactSchema, {
				name: 'Acme',
				address: {
					zip: 'abc',
				},
			}),
		).toContain('address.zip');
	});

	it('IČO, DIČ a PSČ odběratele se na faktuře kontrolují', () => {
		const inv = buildInvoice();
		inv.customer.ico = '12345678';
		inv.customer.dic = 'xx';
		inv.customer.address.zip = '12';
		expect(issuesOf(invoiceSchema(), inv)).toEqual([
			{
				path: ['customer', 'ico'],
				message: 'Neplatné IČO odběratele.',
			},
			{
				path: ['customer', 'dic'],
				message: 'Neplatné DIČ odběratele.',
			},
			{
				path: ['customer', 'address', 'zip'],
				message: 'Neplatné PSČ odběratele.',
			},
		]);

		inv.customer.dic = 'CZ27082440';
		inv.customer.ico = '27082440';
		inv.customer.address.zip = '110 00';
		expect(invalidFields(invoiceSchema(), inv)).toEqual([]);
	});

	it('vyplněný e-mail odběratele se na faktuře kontroluje', () => {
		const inv = buildInvoice();
		inv.customer.email = 'ucetni@acme.cz';
		expect(invalidFields(invoiceSchema(), inv)).toEqual([]);

		inv.customer.email = 'ucetni@acme.cz?bcc=kdosi@evil.example';
		expect(invalidFields(invoiceSchema(), inv)).toContain('customer.email');
	});

	it('odběratel na faktuře musí mít IČO a adresu, DIČ ani e-mail ne', () => {
		const inv = buildInvoice();
		inv.customer = {
			...inv.customer,
			ico: ' ',
			dic: '',
			address: {
				street: '',
				city: '',
				zip: '',
			},
			email: '',
		};

		expect(issuesOf(invoiceSchema(), inv)).toEqual([
			{
				path: ['customer'],
				message: 'Odběrateli chybí IČO, ulice, město a\u00a0PSČ — doplň je přes „Upravit".',
			},
		]);

		inv.customer = {
			...inv.customer,
			ico: '27082440',
			address: {
				street: 'Dlouhá 1',
				city: 'Praha',
				zip: '110 00',
			},
		};
		expect(invalidFields(invoiceSchema(), inv)).toEqual([]);
	});

	it('bez vybraného odběratele se hlásí jen to', () => {
		const inv = buildInvoice();
		inv.customer = {
			...inv.customer,
			name: '',
			ico: '',
			address: {
				street: '',
				city: '',
				zip: '',
			},
			email: '',
		};

		expect(invalidFields(invoiceSchema(), inv)).toEqual(['customer.name']);
	});
});

describe('chybějící vstup místo prázdného řetězce', () => {
	it('chybějící IČO, DIČ a PSČ jsou neplatné, ne pád', () => {
		expect(isValidIco(undefined)).toBe(false);
		expect(isValidDic(undefined)).toBe(false);
		expect(isValidZip(undefined)).toBe(false);
	});
});

describe('splatnost dodavatele je celé číslo', () => {
	it('odmítne necelé, záporné a nečíselné hodnoty', () => {
		expect(issuesOf(defaultDueDaysSchema, 14.5)).toEqual([
			{
				path: [],
				message: 'Zadej celé číslo.',
			},
		]);
		expect(issuesOf(defaultDueDaysSchema, -1)).toEqual([
			{
				path: [],
				message: 'Zadej číslo ≥ 0.',
			},
		]);
		expect(issuesOf(defaultDueDaysSchema, '14')).toEqual([
			{
				path: [],
				message: 'Zadej číslo.',
			},
		]);
	});

	it('celá splatnost projde', () => {
		const s = goodSupplier();
		s.defaultDueDays = 30;
		expect(invalidFields(supplierSchema, s)).toEqual([]);
	});

	it('splatnost je nejvýš rok, jako u převzatých dokladů', () => {
		expect(defaultDueDaysSchema.safeParse(365).data).toBe(365);
		expect(issuesOf(defaultDueDaysSchema, 366)).toEqual([
			{
				path: [],
				message: 'Zadej číslo ≤ 365.',
			},
		]);
		expect(defaultDueDaysSchema.safeParse(3_000_000).success).toBe(false);
	});
});

describe('vazba řádku na ceník ve schématu faktury', () => {
	it('řádek s itemId projde a vazbu si nechá', () => {
		const inv = buildInvoice();
		inv.lines = [
			{
				id: 'r1',
				description: 'Práce',
				quantity: 1,
				unit: 'hod',
				unitPriceCents: 120_000,
				itemId: 'p-1',
			},
		];

		expect(invalidFields(invoiceSchema(), inv)).toEqual([]);
		expect(invoiceSchema().parse(inv).lines[0]).toHaveProperty('itemId', 'p-1');
	});

	it('řádek bez itemId je pořád v pořádku — ručně psaný ho nemá', () => {
		const inv = buildInvoice();

		expect(invalidFields(invoiceSchema(), inv)).toEqual([]);
	});
});

describe('vaultDataSchema', () => {
	it('vault bez dodavatele je prázdná evidence', () => {
		expect(vaultDataSchema.parse({ supplier: null })).toEqual(emptyVaultData());
	});
});
