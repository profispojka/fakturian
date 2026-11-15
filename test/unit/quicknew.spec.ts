import { describe, expect, it } from 'vitest';

import { QUICK_NEW_ITEMS } from '~/constants/quicknew';

describe('QUICK_NEW_ITEMS', () => {
	it('nabízí jen to, co appka umí založit', () => {
		expect(QUICK_NEW_ITEMS.map((i) => i.to)).toEqual([
			'/invoice/new',
			'/customers/new',
			'/pricelist/new',
			'/expense/new',
		]);
	});
	it('zkratku ⌘N ukazuje jen faktura', () => {
		expect(QUICK_NEW_ITEMS.map((i) => i.kbds)).toEqual([['meta', 'n'], undefined, undefined, undefined]);
	});
	it('značky položek sedí s tím, co zakládají', () => {
		expect(QUICK_NEW_ITEMS.map((i) => i['data-testid'])).toEqual([
			'menu-new-invoice',
			'menu-new-contact',
			'menu-new-price',
			'menu-new-expense',
		]);
	});
	it('každá položka má popisek a ikonu', () => {
		expect(QUICK_NEW_ITEMS.map((i) => [i.label, i.icon])).toEqual([
			['Faktura', 'i-lucide-file-text'],
			['Odběratel', 'i-lucide-user-plus'],
			['Položka ceníku', 'i-lucide-tag'],
			['Výdaj', 'i-lucide-receipt'],
		]);
	});
});
