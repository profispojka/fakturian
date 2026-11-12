import { z, type Zod } from '~/utils/zod';

export const priceItemStoredSchema = z.looseObject({
	id: z.string(),
	name: z.string(),
	note: z.string().optional(),
	priceCents: z.number().int(),
	unit: z.string(),
	icon: z.string().optional(),
	annualLimit: z.number().positive().optional(),
});

export type PriceItem = Zod.infer<typeof priceItemStoredSchema>;

export function emptyPriceItem(): PriceItem {
	return {
		id: crypto.randomUUID(),
		name: '',
		priceCents: 0,
		unit: 'ks',
	};
}

export const priceItemSchema = z.object({
	name: z.string().trim().min(1, 'Povinné pole.'),
	// Cena ceníku se na faktuře stává `unitPriceCents`, a ta musí být celý haléř.
	priceCents: z.number('Zadej číslo.').int('Zadej celé číslo.').min(0, 'Zadej číslo ≥ 0.'),
	unit: z.string().trim().min(1, 'Povinné pole.'),
	annualLimit: z.number('Zadej číslo.').positive('Zadej číslo > 0.').optional(),
});
