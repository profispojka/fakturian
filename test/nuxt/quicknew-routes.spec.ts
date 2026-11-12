import { describe, expect, it } from 'vitest';

import { QUICK_NEW_ITEMS } from '~/constants/quicknew';

describe('stránky pro založení nové položky', () => {
	it.each(QUICK_NEW_ITEMS)('$label má vlastní adresu bez parametru záznamu', (item) => {
		const route = useNuxtApp().$router.resolve(item.to);

		expect(route.matched.at(-1)?.path).toBe(item.to);
		// Bez aliasu by `…/new` padlo do `[id].vue` s `id: 'new'` a formulář by hledal záznam „new".
		expect(route.params).toEqual({});
	});
});
