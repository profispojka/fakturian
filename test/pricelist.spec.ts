import { array, assert, boolean, constantFrom, integer, option, property, record, tuple } from 'fast-check';
import { describe, expect, it } from 'vitest';

import { PRICE_ICONS } from '~/constants/icons';
import { DocumentKind } from '~/constants/invoice';
import { invoiceSchema, newInvoice } from '~/schemas/invoices';
import { emptyPriceItem, priceItemSchema } from '~/schemas/pricelist';
import {
	formatAmount,
	formatQuantity,
	hasLimit,
	itemForLine,
	itemLabel,
	itemsNearLimit,
	itemUsage,
	limitOverflows,
	pricelistLevelOf,
	recordsFor,
	remainingFor,
} from '~/utils/pricelist';

import type { DocumentType } from '~/constants/invoice';
import type { Invoice } from '~/schemas/invoices';
import type { PriceItem } from '~/schemas/pricelist';
import type { PriceUsageRecord } from '~/utils/pricelist';

const VACATION: PriceItem = {
	id: 'p-dov',
	name: 'Konzultační činnost',
	note: 'dovolená',
	priceCents: 120_000,
	unit: 'hod',
	icon: 'i-lucide-tree-palm',
	annualLimit: 160,
};

const PROGRAMMING: PriceItem = {
	id: 'p-dev',
	name: 'Programování',
	priceCents: 140_000,
	unit: 'hod',
};

const PRICELIST = [VACATION, PROGRAMMING];

describe('čerpání stejné položky v různých letech', () => {
	const line = {
		id: 'r1',
		itemId: VACATION.id,
		description: VACATION.name,
		quantity: 8,
		unit: 'hod',
		unitPriceCents: 120_000,
	};
	const inv = {
		number: '20260001',
		documentType: 1 as const,
		lines: [
			{
				...line,
				usageYear: 2025,
			},
			{
				...line,
				quantity: 4,
			},
		],
	};

	it('sečte řádky podle položky i roku, implicitní rok dodá vystavení', () => {
		expect(recordsFor(inv, 2026)).toEqual([
			{
				invoiceNumber: '20260001',
				year: 2025,
				itemId: VACATION.id,
				quantity: 8,
			},
			{
				invoiceNumber: '20260001',
				year: 2026,
				itemId: VACATION.id,
				quantity: 4,
			},
		]);
	});

	it('vyčerpaný rok nezablokuje jiný a hláška určí rok překročení', () => {
		const records = [
			{
				invoiceNumber: 'other',
				year: 2025,
				itemId: VACATION.id,
				quantity: 156,
			},
		];
		expect(limitOverflows(inv, PRICELIST, records, 2026)).toEqual([
			{
				label: 'dovolená',
				unit: 'hod',
				remaining: 4,
				year: 2025,
			},
		]);
		expect(
			limitOverflows(
				{
					...inv,
					lines: [
						{
							...line,
							usageYear: 2026,
						},
					],
				},
				PRICELIST,
				records,
				2026,
			),
		).toEqual([]);
	});

	it('dobropis vrátí množství odděleně do každého roku', () => {
		expect(
			recordsFor(
				{
					...inv,
					documentType: 2,
				},
				2026,
			).map((r) => [r.year, r.quantity]),
		).toEqual([
			[2025, -8],
			[2026, -4],
		]);
	});
});

function speech(invoiceNumber: string, year: number, quantity: number, itemId = VACATION.id): PriceUsageRecord {
	return {
		invoiceNumber,
		year,
		itemId,
		quantity,
	};
}

function invoiceWith(lines: Invoice['lines'], number = '20260001'): Invoice {
	return {
		...newInvoice(null, number),
		lines,
	};
}

describe('spárování řádku s položkou ceníku', () => {
	it('řádek bez itemId neukazuje položku ceníku', () => {
		expect(
			itemForLine(
				{
					id: 'r1',
					description: VACATION.name,
					quantity: 1,
					unit: 'hod',
					unitPriceCents: 0,
				},
				PRICELIST,
			),
		).toBeNull();
	});

	it('řádek si najde jen položku určenou itemId', () => {
		expect(
			itemForLine(
				{
					id: 'r1',
					description: ' konzultační ČINNOST ',
					quantity: 8,
					unit: 'HOD',
					unitPriceCents: 120_000,
					itemId: ` ${VACATION.id} `,
				},
				PRICELIST,
			),
		).toBe(VACATION);
		expect(
			itemForLine(
				{
					id: 'r1',
					description: VACATION.name,
					quantity: 1,
					unit: 'hod',
					unitPriceCents: 120_000,
				},
				PRICELIST,
			),
		).toBeNull();
	});

	it('neznámé itemId neukazuje jinou položku ceníku', () => {
		expect(
			itemForLine(
				{
					id: 'r1',
					description: VACATION.name,
					quantity: 1,
					unit: VACATION.unit,
					unitPriceCents: VACATION.priceCents,
					itemId: 'neznámá',
				},
				PRICELIST,
			),
		).toBeNull();
	});

	it('roční strop se hlídá jen tam, kde je zadaný', () => {
		expect(hasLimit(VACATION)).toBe(true);
		expect(hasLimit(PROGRAMMING)).toBe(false);
	});
});

describe('vykázání položky za rok', () => {
	const records = [
		speech('20260001', 2026, 40),
		speech('20260002', 2026, 24),
		speech('20250009', 2025, 80),
		speech('20260001', 2026, 16, PROGRAMMING.id),
	];

	it('počítá se jen v rámci jednoho roku a jedné položky', () => {
		const u = itemUsage(VACATION, records, 2026);
		expect(u.used).toBe(64);
		expect(u.remaining).toBe(96);
		expect(u.limit).toBe(160);

		expect(itemUsage(VACATION, records, 2025).used).toBe(80);
		expect(itemUsage(PROGRAMMING, records, 2026).used).toBe(16);
	});

	it('ukáže, na kterých fakturách položka je', () => {
		const u = itemUsage(VACATION, records, 2026);
		expect(u.invoices.map((i) => i.invoiceNumber)).toEqual(['20260001', '20260002']);
		expect(u.invoices[0]!.quantity).toBe(40);
	});

	it('doklady v přehledu řadí podle čísla', () => {
		const u = itemUsage(VACATION, [speech('20260002', 2026, 24), speech('20260001', 2026, 40)], 2026);
		expect(u.invoices.map((i) => i.invoiceNumber)).toEqual(['20260001', '20260002']);
	});

	it('položka bez limitu se eviduje, ale nic nezbývá k rozdělování', () => {
		const u = itemUsage(PROGRAMMING, records, 2026);
		expect(u.limit).toBe(0);
		expect(u.remaining).toBe(0);
		expect(u.used).toBe(16);
		expect(u.invoices).toHaveLength(1);
	});
});

describe('barevná úroveň a položky blízko limitu', () => {
	it('do 80 % je klid, pak varování, na 100 % a výš je vyčerpáno', () => {
		expect(pricelistLevelOf(0)).toBe('ok');
		expect(pricelistLevelOf(0.7999)).toBe('ok');
		expect(pricelistLevelOf(0.8)).toBe('warn');
		expect(pricelistLevelOf(0.9999)).toBe('warn');
		expect(pricelistLevelOf(1)).toBe('danger');
		expect(pricelistLevelOf(1.5)).toBe('danger');
	});

	it('vybere jen položku, která se limitu blíží', () => {
		const records = [speech('20260001', 2026, 144)]; // 144 ze 160 = 90 %
		const n = itemsNearLimit(PRICELIST, records, 2026);
		expect(n.map((x) => x.item.id)).toEqual([VACATION.id]);
		expect(n[0]!.ratio).toBeCloseTo(0.9);
	});

	it('položka bez limitu se nehlídá, i kdyby byla vykázaná hodně', () => {
		const records = [speech('20260001', 2026, 9999, PROGRAMMING.id)];
		expect(itemsNearLimit(PRICELIST, records, 2026)).toEqual([]);
	});

	it('položka pod prahem se do sady nedostane', () => {
		const records = [speech('20260001', 2026, 100)]; // 100 ze 160 = 62,5 %
		expect(itemsNearLimit(PRICELIST, records, 2026)).toEqual([]);
	});

	it('řadí od nejvíc vyčerpané', () => {
		const pricelist = [
			VACATION,
			{
				...PROGRAMMING,
				id: 'p-2',
				annualLimit: 10,
			},
		];
		const records = [speech('20260001', 2026, 130, VACATION.id), speech('20260002', 2026, 10, 'p-2')];
		expect(itemsNearLimit(pricelist, records, 2026).map((x) => x.item.id)).toEqual(['p-2', VACATION.id]);
	});
});

describe('blokace překročení limitu', () => {
	// Při 144 vykázaných ze 160 (18 z 20 dnů) nesmí projít další 4 dny.
	const records = [speech('20260001', 2026, 144)];

	function o(inv: Invoice, r: PriceUsageRecord[] = records) {
		return limitOverflows(inv, PRICELIST, r, 2026);
	}
	function vacation(hours: number, number = '20260002'): Invoice {
		return invoiceWith(
			[
				{
					id: 'r1',
					description: 'Konzultační činnost',
					quantity: hours,
					unit: 'hod',
					unitPriceCents: 120_000,
					itemId: VACATION.id,
				},
			],
			number,
		);
	}

	it('faktura přes limit neprojde a řekne, které položky se to týká', () => {
		const p = o(vacation(32));
		expect(p).toHaveLength(1);
		expect(p[0]!.label).toBe('dovolená');
		expect(p[0]!.unit).toBe('hod');
		expect(p[0]!.remaining).toBe(16);
	});

	it('faktura přesně na limit projde', () => {
		expect(o(vacation(16))).toEqual([]);
	});

	it('množství přesně na hranici tolerance projde', () => {
		expect(o(vacation(16.001))).toEqual([]);
	});

	it('nepovoluje se část — rozhoduje celé množství', () => {
		expect(o(vacation(20))).toHaveLength(1);
	});

	it('editace nezapočítá vlastní množství dvakrát', () => {
		expect(o(vacation(144, '20260001'))).toEqual([]);
		expect(o(vacation(160, '20260001'))).toEqual([]);
		expect(o(vacation(168, '20260001'))).toHaveLength(1);
	});

	it('položka bez stropu se neblokuje nikdy', () => {
		const inv = invoiceWith([
			{
				id: 'r1',
				description: 'Programování',
				quantity: 9999,
				unit: 'hod',
				unitPriceCents: 140_000,
				itemId: PROGRAMMING.id,
			},
		]);
		expect(o(inv)).toEqual([]);
	});

	it('limit platí po ročnících zvlášť', () => {
		expect(limitOverflows(vacation(160, '20270001'), PRICELIST, records, 2027)).toEqual([]);
	});

	it('řádek přesně na zbytek limitu projde i s desetinným součtem', () => {
		const pricelist = [
			{
				...VACATION,
				annualLimit: 8,
			},
		];
		const drive = [speech('20260001', 2026, 1.1), speech('20260002', 2026, 2.2)];
		expect(limitOverflows(vacation(4.7, '20260003'), pricelist, drive, 2026)).toEqual([]);
		expect(limitOverflows(vacation(4.8, '20260003'), pricelist, drive, 2026)).toHaveLength(1);
	});

	it('přeteklé položky se hlásí všechny naráz', () => {
		const pricelist = [
			VACATION,
			{
				...PROGRAMMING,
				annualLimit: 10,
			},
		];
		const inv = invoiceWith([
			{
				id: 'r1',
				description: 'Konzultační činnost',
				quantity: 200,
				unit: 'hod',
				unitPriceCents: 120_000,
				itemId: VACATION.id,
			},
			{
				id: 'r1',
				description: 'Programování',
				quantity: 40,
				unit: 'hod',
				unitPriceCents: 140_000,
				itemId: PROGRAMMING.id,
			},
		]);
		expect(limitOverflows(inv, pricelist, [], 2026).map((p) => p.label)).toEqual(['dovolená', 'Programování']);
	});
});

describe('zápis vazby faktura ↔ položky', () => {
	const inv = invoiceWith([
		{
			id: 'r1',
			description: 'Konzultační činnost',
			quantity: 40,
			unit: 'hod',
			unitPriceCents: 120_000,
			itemId: VACATION.id,
		},
		{
			id: 'r1',
			description: 'Programování',
			quantity: 16,
			unit: 'hod',
			unitPriceCents: 140_000,
			itemId: PROGRAMMING.id,
		},
	]);

	it('doklad dostane záznam za každou položku ceníku, která na něm je', () => {
		const r = recordsFor(inv, 2026);
		expect(r).toEqual([speech('20260001', 2026, 40, 'p-dov'), speech('20260001', 2026, 16, 'p-dev')]);
	});

	it('ručně psaný řádek se nezapíše ani se stejným textem jako položka', () => {
		const other = invoiceWith([
			{
				id: 'r1',
				description: VACATION.name,
				quantity: 120,
				unit: VACATION.unit,
				unitPriceCents: 120_000,
			},
		]);
		expect(recordsFor(other, 2026)).toEqual([]);
	});

	it('řádky téže položky se sečtou, nulový součet záznam nedostane', () => {
		const twice = invoiceWith([
			{
				id: 'r1',
				description: 'Konzultační činnost',
				quantity: 16,
				unit: 'hod',
				unitPriceCents: 120_000,
				itemId: VACATION.id,
			},
			{
				id: 'r1',
				description: 'Konzultační činnost',
				quantity: 0,
				unit: 'hod',
				unitPriceCents: 120_000,
				itemId: VACATION.id,
			},
			{
				id: 'r1',
				description: 'Programování',
				quantity: 0,
				unit: 'hod',
				unitPriceCents: 140_000,
				itemId: PROGRAMMING.id,
			},
		]);
		expect(recordsFor(twice, 2026)).toEqual([speech('20260001', 2026, 16)]);
	});

	it('záznam nese rok fakturovaného období', () => {
		expect(recordsFor(inv, 2025).map((x) => x.year)).toEqual([2025, 2025]);
	});

	it('přejmenování položky vazbu nesené řádkem nerozbije', () => {
		const linked = invoiceWith([
			{
				id: 'r1',
				description: 'Konzultační činnost',
				quantity: 40,
				unit: 'hod',
				unitPriceCents: 120_000,
				itemId: 'p-dov',
			},
		]);
		expect(recordsFor(linked, 2026)).toEqual([speech('20260001', 2026, 40)]);
	});

	it('položka smazaná z ceníku o záznam nepřijde, dokud je řádek na faktuře', () => {
		const linked = invoiceWith([
			{
				id: 'r1',
				description: 'Konzultační činnost',
				quantity: 40,
				unit: 'hod',
				unitPriceCents: 120_000,
				itemId: 'p-dov',
			},
		]);
		expect(recordsFor(linked, 2026)).toEqual([speech('20260001', 2026, 40)]);
	});

	it('řádek bez vazby se nezapíše', () => {
		const manual = invoiceWith([
			{
				id: 'r1',
				description: VACATION.name,
				quantity: 40,
				unit: VACATION.unit,
				unitPriceCents: 120_000,
			},
		]);
		expect(recordsFor(manual, 2026)).toEqual([]);
	});

	it('vazba na řádku přebije název, který ukazuje jinam', () => {
		const confused = invoiceWith([
			{
				id: 'r1',
				description: 'Programování',
				quantity: 5,
				unit: 'hod',
				unitPriceCents: 140_000,
				itemId: 'p-dov',
			},
		]);
		expect(recordsFor(confused, 2026)).toEqual([speech('20260001', 2026, 5)]);
	});
});

describe('blokace na úrovni validace faktury', () => {
	const inv: Invoice = {
		...newInvoice(null, '20260002'),
		customer: {
			...newInvoice(null, '').customer,
			name: 'Acme',
			ico: '27082440',
			address: {
				street: 'Dlouhá 1',
				city: 'Praha',
				zip: '11000',
			},
			email: 'fakturace@acme.cz',
		},
		bankAccount: '2000145399',
		bankCode: '0800',
		lines: [
			{
				id: 'r1',
				description: 'Konzultační činnost',
				quantity: 32,
				unit: 'hod',
				unitPriceCents: 120_000,
			},
		],
	};

	it('bez překročení faktura projde', () => {
		expect(invoiceSchema({ limitOverflows: [] }).safeParse(inv).success).toBe(true);
	});

	it('při překročení faktura neprojde a hláška řekne, kolik zbývá', () => {
		const e = invoiceSchema({
			limitOverflows: [
				{
					label: 'dovolená',
					unit: 'hod',
					remaining: 16,
					year: 2026,
				},
			],
		}).safeParse(inv);
		expect(e.success).toBe(false);
		const message = e.error?.issues.find((i) => i.path.join('.') === 'lines')?.message;
		expect(message).toContain('dovolená');
		expect(message).toContain('16 hod');
	});

	it('vyčerpaný limit se hlásí jako vyčerpaný, ne jako nula', () => {
		const e = invoiceSchema({
			limitOverflows: [
				{
					label: 'dovolená',
					unit: 'hod',
					remaining: 0,
					year: 2026,
				},
			],
		}).safeParse(inv);
		expect(e.error?.issues.find((i) => i.path.join('.') === 'lines')?.message).toContain('vyčerpaný');
	});

	it('každá přeteklá položka má vlastní hlášku', () => {
		const e = invoiceSchema({
			limitOverflows: [
				{
					label: 'dovolená',
					unit: 'hod',
					remaining: 16,
					year: 2026,
				},
				{
					label: 'Školení',
					unit: 'den',
					remaining: 0,
					year: 2026,
				},
			],
		}).safeParse(inv);
		expect(e.error?.issues.filter((i) => i.path.join('.') === 'lines')).toHaveLength(2);
	});
});

describe('dobropis vrací množství do limitu', () => {
	const lines = [
		{
			id: 'r1',
			description: 'Konzultační činnost',
			quantity: 40,
			unit: 'hod',
			unitPriceCents: 120_000,
			itemId: VACATION.id,
		},
	];

	it('záporný záznam vykázané množství sníží', () => {
		const r = [speech('20260001', 2026, 40), speech('20260002', 2026, -40)];
		expect(itemUsage(VACATION, r, 2026).used).toBe(0);
	});

	it('dobropis se nikdy neblokuje limitem', () => {
		const full = [speech('20260001', 2026, 160)];
		const creditNote: Invoice = {
			...invoiceWith(lines, '20260002'),
			documentType: 2,
		};
		expect(limitOverflows(creditNote, PRICELIST, full, 2026)).toEqual([]);
	});
});

describe('zbývající množství pro konkrétní doklad', () => {
	const records = [speech('20260001', 2026, 144)];

	it('vlastní množství faktury se odečítá — stejně jako u blokace', () => {
		expect(remainingFor(VACATION, records, 2026, '20260002')).toBe(16);
		expect(remainingFor(VACATION, records, 2026, '20260001')).toBe(160);
	});

	it('bez stropu nezbývá nic k rozdělování', () => {
		expect(remainingFor(PROGRAMMING, records, 2026, 'x')).toBe(0);
	});
});

describe('limit nikdy nepřeteče nahoru', () => {
	it('dobropis ke smazané faktuře nezvedne zbytek nad limit', () => {
		const records = [speech('20260002', 2026, -320)];
		const u = itemUsage(VACATION, records, 2026);
		expect(u.used).toBe(0);
		expect(u.remaining).toBe(160);
		expect(u.remaining).toBeLessThanOrEqual(u.limit);
	});

	it('zbývající množství se taky nepřetáhne přes limit', () => {
		expect(remainingFor(VACATION, [speech('20260002', 2026, -320)], 2026, '20260003')).toBe(160);
	});
});

describe('odolnost vůči rozbitým datům', () => {
	it('nečíselné množství na řádku se počítá jako nula', () => {
		const inv = invoiceWith([
			{
				id: 'r1',
				description: VACATION.name,
				quantity: Number.NaN,
				unit: 'hod',
				unitPriceCents: 100_000,
				itemId: VACATION.id,
			},
			{
				id: 'r1',
				description: VACATION.name,
				quantity: 8,
				unit: 'hod',
				unitPriceCents: 100_000,
				itemId: VACATION.id,
			},
		]);
		expect(recordsFor(inv, 2026)).toEqual([speech('20260001', 2026, 8)]);
	});
});

describe('jak se položka jmenuje a jakou nese ikonku', () => {
	it('vede interní poznámka, bez ní název', () => {
		expect(itemLabel(VACATION)).toBe('dovolená');
		expect(itemLabel(PROGRAMMING)).toBe('Programování');
		expect(
			itemLabel({
				name: 'Programování',
				note: '   ',
			}),
		).toBe('Programování');
		expect(itemLabel({ name: ' Programování ' })).toBe('Programování');
	});

	it('každá ikonka v nabídce má popisek pro čtečku', () => {
		expect(PRICE_ICONS).toHaveLength(22);
		expect(PRICE_ICONS.every((i) => i.key.startsWith('i-lucide-') && i.label.trim())).toBe(true);
		expect(new Set(PRICE_ICONS.map((i) => i.key)).size).toBe(PRICE_ICONS.length);
	});
});

describe('množství pro čtení', () => {
	it('desetinná čárka a žádné zbytečné nuly', () => {
		expect(formatQuantity(8)).toBe('8');
		expect(formatQuantity(2.5)).toBe('2,5');
		expect(formatQuantity(0.25)).toBe('0,25');
		expect(formatQuantity(160)).toBe('160');
		expect(formatQuantity(Number.NaN)).toBe('—');
	});

	it('jednotka se lepí za číslo s mezerou, prázdná se vynechá', () => {
		expect(formatAmount(160, 'hod')).toBe('160 hod');
		expect(formatAmount(2.5, ' den ')).toBe('2,5 den');
		expect(formatAmount(3, '')).toBe('3');
	});
});

describe('schéma položky ceníku', () => {
	const valid = {
		name: 'Konzultace',
		priceCents: 120_000,
		unit: 'hod',
	};

	it('limit je nepovinný — bez něj se nehlídá', () => {
		expect(priceItemSchema.safeParse(valid).success).toBe(true);
		expect(
			priceItemSchema.safeParse({
				...valid,
				annualLimit: 160,
			}).success,
		).toBe(true);
	});

	it.each([0, -1])('limit %d neprojde — „bez limitu" je prázdné pole', (annualLimit) => {
		const r = priceItemSchema.safeParse({
			...valid,
			annualLimit,
		});
		expect(r.success).toBe(false);
		expect(
			r.error?.issues.map((issue) => ({
				path: issue.path,
				message: issue.message,
			})),
		).toEqual([
			{
				path: ['annualLimit'],
				message: 'Zadej číslo > 0.',
			},
		]);
	});
});

const YEARS = [2025, 2026, 2027];
// Čtvrtiny jsou ve dvojkové soustavě přesné, takže součet modelu nezávisí na pořadí sčítání.
const quarters = (min: number, max: number) =>
	integer({
		min,
		max,
	}).map((n) => n / 4);
const usageYear = constantFrom(...YEARS);
const usageDocument = record({
	documentType: constantFrom(DocumentKind.Invoice, DocumentKind.CreditNote),
	issueYear: usageYear,
	lines: array(
		record({
			itemId: constantFrom('p0', 'p1', ' p1 ', 'p2', '', 'jinde'),
			quantity: quarters(-40, 400),
			usageYear: option(usageYear, {
				nil: undefined,
			}),
		}),
		{
			maxLength: 6,
		},
	),
});
const limitedPricelist = tuple(quarters(1, 200), quarters(1, 200)).map(([first, second]): PriceItem[] => [
	{
		id: 'p0',
		name: 'Konzultace',
		priceCents: 100_000,
		unit: 'hod',
		annualLimit: first,
	},
	{
		id: 'p1',
		name: 'Vývoj',
		note: 'dovolená',
		priceCents: 120_000,
		unit: 'den',
		annualLimit: second,
	},
	{
		id: 'p2',
		name: 'Licence',
		priceCents: 50_000,
		unit: 'ks',
	},
]);

interface UsageDocument {
	documentType: DocumentType;
	issueYear: number;
	lines: {
		itemId: string;
		quantity: number;
		usageYear?: number | undefined;
	}[];
}

/** Čerpání podle modelu: znaménko dokladu × množství na řádcích položky v daném roce, po dokladech. */
function modelUsage(documents: UsageDocument[], itemId: string, year: number): number[] {
	return documents.map((d) =>
		d.lines
			.filter((l) => l.itemId.trim() === itemId && (l.usageYear ?? d.issueYear) === year)
			.reduce((sum, l) => sum + (d.documentType === DocumentKind.CreditNote ? -l.quantity : l.quantity), 0),
	);
}

function modelRemaining(limit: number, perDocument: number[]): number {
	const used = Math.max(
		0,
		perDocument.reduce((sum, q) => sum + q, 0),
	);
	return Math.min(limit, Math.max(0, limit - used));
}

const documentNumber = (index: number) => `F${String(index).padStart(4, '0')}`;

function archiveRecords(documents: UsageDocument[]): PriceUsageRecord[] {
	return documents.flatMap((d, index) =>
		recordsFor(
			{
				number: documentNumber(index),
				documentType: d.documentType,
				lines: d.lines,
			},
			d.issueYear,
		),
	);
}

describe('čerpání limitů proti modelu', () => {
	it('vyčerpané, zbývající a doklady položky sedí se součtem z archivu', () => {
		assert(
			property(
				limitedPricelist,
				array(usageDocument, {
					maxLength: 8,
				}),
				usageYear,
				(pricelist, documents, year) => {
					const records = archiveRecords(documents);
					for (const item of pricelist) {
						const perDocument = modelUsage(documents, item.id, year);
						const limit = item.annualLimit ?? 0;
						expect(itemUsage(item, records, year)).toEqual({
							limit,
							used: Math.max(
								0,
								perDocument.reduce((sum, q) => sum + q, 0),
							),
							remaining: modelRemaining(limit, perDocument),
							invoices: perDocument
								.map((quantity, index) => ({
									invoiceNumber: documentNumber(index),
									quantity,
								}))
								.filter(({ quantity }) => quantity !== 0),
						});
					}
				},
			),
		);
	});

	it('rozepsaný doklad přetéká právě tam, kde chce víc, než zbývá bez jeho starší verze', () => {
		assert(
			property(
				limitedPricelist,
				array(usageDocument, {
					minLength: 1,
					maxLength: 6,
				}),
				usageDocument,
				boolean(),
				(pricelist, documents, draft, replacesFirst) => {
					const number = replacesFirst ? documentNumber(0) : 'F9999';
					const others = replacesFirst ? documents.slice(1) : documents;
					const expected = pricelist.flatMap((item) =>
						YEARS.flatMap((year) => {
							const limit = item.annualLimit ?? 0;
							const [onDraft] = modelUsage([draft], item.id, year);
							const remaining = modelRemaining(limit, modelUsage(others, item.id, year));
							if (limit === 0 || onDraft === 0 || onDraft === undefined || onDraft <= remaining + 0.001)
								return [];
							return [
								{
									label: item.note ?? item.name,
									unit: item.unit,
									remaining,
									year,
								},
							];
						}),
					);

					const overflows = limitOverflows(
						{
							number,
							documentType: draft.documentType,
							lines: draft.lines.map((l, index) => ({
								id: `r${index}`,
								description: 'Položka',
								unit: 'hod',
								unitPriceCents: 100,
								...l,
							})),
						},
						pricelist,
						archiveRecords(documents),
						draft.issueYear,
					);
					const byPlace = (a: { label: string; year: number }, b: { label: string; year: number }) =>
						a.label.localeCompare(b.label) || a.year - b.year;
					expect(overflows.toSorted(byPlace)).toEqual(expected.toSorted(byPlace));
				},
			),
		);
	});
});

describe('nová položka ceníku', () => {
	it('je prázdná, v kusech, bez limitu a s vlastním id', () => {
		const price = emptyPriceItem();
		expect(price).toEqual({
			id: price.id,
			name: '',
			priceCents: 0,
			unit: 'ks',
		});
		expect(emptyPriceItem().id).not.toBe(price.id);
	});
});
