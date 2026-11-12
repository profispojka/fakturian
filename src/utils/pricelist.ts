import { DocumentKind } from '~/constants/invoice';
import { LOCALE } from '~/constants/locales';
import { PRICELIST_WARN_RATIO } from '~/constants/pricelist';
import { yearOf } from '~/utils/date';

import type { DocumentType } from '~/constants/invoice';
import type { Invoice, InvoiceLine, InvoiceSummary } from '~/schemas/invoices';
import type { PriceItem } from '~/schemas/pricelist';

/** Co z řádku potřebuje vykázané množství — sedí na rozepsaný doklad i na jeho přehled z archivu. */
export interface UsageLine {
	itemId?: string;
	quantity: number;
	usageYear?: number | undefined;
}

/** Kolik z položky ceníku ubral doklad za daný rok. Počítá se z archivu, ve vaultu neleží. */
export interface PriceUsageRecord {
	invoiceNumber: string;
	year: number;
	itemId: string;
	quantity: number;
}

// Proto se vrací id, ne položka — ta už v ceníku být nemusí.
function itemIdOf(line: UsageLine): string | null {
	return line.itemId?.trim() || null;
}

export function itemForLine(line: InvoiceLine, pricelist: PriceItem[]): PriceItem | null {
	const id = itemIdOf(line);
	if (!id) return null;
	return pricelist.find((p) => p.id === id) ?? null;
}

export function matchingItemForLine(line: InvoiceLine, pricelist: PriceItem[]): PriceItem | null {
	const description = line.description.trim();
	const unit = line.unit.trim();
	return pricelist.find((p) => p.name.trim() === description && p.unit.trim() === unit) ?? null;
}

// `quantity` chodí i z cizího dokladu; `NaN` by se sečetlo do `NaN` a shodilo celé vykázané
// množství.
function lineQuantity(line: UsageLine): number {
	if (Number.isFinite(line.quantity)) return line.quantity;
	return 0;
}

// Nulové součty vypadnou, ať vyhozená položka nevisí v evidenci. Dobropis množství vrací: zápornou
// částku na něm dělá cena, takže by jinak limit čerpal podruhé.
function quantitiesOn(lines: UsageLine[], creditNote: boolean): Map<string, number> {
	let sign = 1;
	if (creditNote) sign = -1;
	const totals = lines.reduce((acc, l) => {
		const id = itemIdOf(l);
		if (id) acc.set(id, (acc.get(id) ?? 0) + sign * lineQuantity(l));
		return acc;
	}, new Map<string, number>());
	return new Map([...totals].filter(([, q]) => q !== 0));
}

/** Sedí na rozepsanou fakturu i na přehled dokladu z archivu — obojí nese totéž. */
interface UsageSource {
	number: string;
	documentType: DocumentType;
	lines: UsageLine[];
}

export function recordsFor(inv: UsageSource, defaultYear: number): PriceUsageRecord[] {
	const linesByYear = Map.groupBy(inv.lines, (line) => line.usageYear ?? defaultYear);
	return [...linesByYear].flatMap(([year, lines]) =>
		[...quantitiesOn(lines, inv.documentType === DocumentKind.CreditNote)].map(([itemId, quantity]) => ({
			invoiceNumber: inv.number,
			year,
			itemId,
			quantity,
		})),
	);
}

/** Zdroj pravdy o vyčerpaných limitech je archiv: doklad nese vazbu na ceník i rok čerpání sám. */
export function usageRecords(invoices: InvoiceSummary[]): PriceUsageRecord[] {
	return invoices.flatMap((i) =>
		recordsFor(
			{
				number: i.number,
				documentType: i.documentType,
				lines: i.usageLines,
			},
			yearOf(i.issueDate),
		),
	);
}

export function hasLimit<T extends Pick<PriceItem, 'annualLimit'>>(item: T): item is T & { annualLimit: number } {
	return item.annualLimit !== undefined;
}

export interface ItemUsageInvoice {
	invoiceNumber: string;
	quantity: number;
}

export interface ItemUsage {
	limit: number;
	used: number;
	remaining: number;
	invoices: ItemUsageInvoice[];
}

export function itemUsage(item: PriceItem, records: PriceUsageRecord[], year: number): ItemUsage {
	const active = records.filter((r) => r.itemId === item.id && r.year === year);
	const limit = item.annualLimit ?? 0;
	const used = Math.max(
		0,
		active.reduce((sum, r) => sum + r.quantity, 0),
	);
	return {
		limit,
		used,
		remaining: Math.min(limit, Math.max(0, limit - used)),
		invoices: active
			.map(({ invoiceNumber, quantity }) => ({
				invoiceNumber,
				quantity,
			}))
			.toSorted((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber)),
	};
}

// Stav položky bez vlastního záznamu dokladu — jinak by už vystavená faktura neprošla validací při
// uložení beze změny.
export function remainingFor(
	item: PriceItem,
	records: PriceUsageRecord[],
	year: number,
	invoiceNumber: string,
): number {
	const others = records.filter((r) => r.invoiceNumber !== invoiceNumber);
	return itemUsage(item, others, year).remaining;
}

export interface LimitOverflow {
	label: string;
	unit: string;
	remaining: number;
	year: number;
}

// Součet desetinných množství se v plovoucí čárce netrefí přesně a řádek na přesný zbytek by se
// odmítl.
const TOLERANCE = 0.001;

// Položka bez limitu se nehlídá — kdo funkci nepoužívá, nesmí kvůli ní přijít o možnost fakturovat.
export function limitOverflows(
	inv: Pick<Invoice, 'lines' | 'documentType' | 'number'>,
	pricelist: PriceItem[],
	records: PriceUsageRecord[],
	year: number,
): LimitOverflow[] {
	return recordsFor(inv, year).flatMap((record) => {
		const onDocument = record.quantity;
		const item = pricelist.find((p) => p.id === record.itemId);
		if (!item || !hasLimit(item)) return [];
		const remaining = remainingFor(item, records, record.year, inv.number);
		if (onDocument > remaining + TOLERANCE) {
			return [
				{
					label: itemLabel(item),
					unit: item.unit,
					remaining,
					year: record.year,
				},
			];
		}
		return [];
	});
}

export type PricelistLevel = 'ok' | 'warn' | 'danger';

// Sdílené místo, protože práh i barvu ukazuje Ceník i Přehled.
export function pricelistLevelOf(ratio: number): PricelistLevel {
	if (ratio >= 1) return 'danger';
	if (ratio >= PRICELIST_WARN_RATIO) return 'warn';
	return 'ok';
}

export interface NearLimitItem {
	item: PriceItem;
	usage: ItemUsage;
	ratio: number;
}

export function itemsNearLimit(pricelist: PriceItem[], records: PriceUsageRecord[], year: number): NearLimitItem[] {
	return pricelist
		.filter(hasLimit)
		.map((item) => {
			const usage = itemUsage(item, records, year);
			return {
				item,
				usage,
				ratio: usage.used / usage.limit,
			};
		})
		.filter((n) => pricelistLevelOf(n.ratio) !== 'ok')
		.toSorted((a, b) => b.ratio - a.ratio);
}

export function itemLabel(item: Pick<PriceItem, 'name' | 'note'>): string {
	return item.note?.trim() || item.name.trim();
}

const QUANTITY = new Intl.NumberFormat(LOCALE, {
	maximumFractionDigits: 2,
	signDisplay: 'negative',
});

export function formatQuantity(n: number): string {
	if (!Number.isFinite(n)) return '—';
	return QUANTITY.format(n);
}

export function formatAmount(n: number, unit: string): string {
	const trimmed = unit.trim();
	if (trimmed) return `${formatQuantity(n)} ${trimmed}`;
	return formatQuantity(n);
}
