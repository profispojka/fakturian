import { describe, expect, it } from 'vitest';

import { mountPage } from '../setup/mount';
import { prepareVault } from '../setup/vault';

describe('tlačítko palety v hlavičce výpisu', () => {
	it.each([
		{
			route: '/customers',
			button: 'customer-palette',
		},
		{
			route: '/expense',
			button: 'expense-palette',
		},
		{
			route: '/invoice',
			button: 'invoice-palette',
		},
		{
			route: '/pricelist',
			button: 'price-palette',
		},
	])('$route otevře paletu příkazů', async ({ route, button }) => {
		await prepareVault({
			'nastaveni.json': {
				supplier: null,
				contacts: [],
				pricelist: [],
			},
		});
		const c = await mountPage(route);

		await c.find(`[data-testid="${button}"]`).trigger('click');

		expect(useState<boolean>('paletteOpen', () => false).value).toBe(true);
	});
});
