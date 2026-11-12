import { describe, expect, it } from 'vitest';

import { errorText, issuesText } from '~/utils/errors';
import { z } from '~/utils/zod';

describe('errorText', () => {
	it('řetězec z backendu vrací beze změny', () => {
		expect(errorText('Není zvolena datová složka')).toBe('Není zvolena datová složka');
	});

	it('z Error bere hlášku bez jména třídy', () => {
		expect(errorText(new Error('Doklad se nepodařilo otevřít'))).toBe('Doklad se nepodařilo otevřít');
	});

	it('jméno třídy nenechá ani u podtypů Error', () => {
		expect(errorText(new TypeError('x není funkce'))).toBe('x není funkce');
	});

	it('ze ZodError udělá větu, ne JSON', () => {
		const result = z.object({ ico: z.string() }).safeParse({ ico: 7 });
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(errorText(result.error)).toBe(`ico: ${result.error.issues[0]?.message}`);
	});

	it('na čemkoli jiném skončí u jeho textové podoby', () => {
		expect(errorText(undefined)).toBe('undefined');
		expect(errorText(404)).toBe('404');
	});
});

describe('issuesText', () => {
	it('problém bez cesty nechá bez dvojtečky', () => {
		const result = z.string().safeParse(7);
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(issuesText(result.error)).toBe(result.error.issues[0]?.message);
	});

	it('vypíše nejvýš tři problémy jako český výčet', () => {
		const schema = z.object({
			a: z.string(),
			b: z.string(),
			c: z.string(),
			d: z.string(),
		});
		const result = schema.safeParse({
			a: 1,
			b: 1,
			c: 1,
			d: 1,
		});
		expect(result.success).toBe(false);
		if (result.success) return;
		const [a, b, c] = result.error.issues.map((issue) => issue.message);
		expect(issuesText(result.error)).toBe(`a: ${a}, b: ${b} a c: ${c}`);
	});

	it('vnořené pole nese celou cestu', () => {
		const schema = z.object({
			address: z.object({
				zip: z.string(),
			}),
		});
		const result = schema.safeParse({
			address: {
				zip: 60_200,
			},
		});
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(issuesText(result.error)).toBe(`address.zip: ${result.error.issues[0]?.message}`);
	});
});
