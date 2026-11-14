import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mountPage } from '../setup/mount';
import { prepareVault } from '../setup/vault';

beforeEach(async () => {
	await prepareVault();
});

describe('filtry seznamů', () => {
	it('hledání odběratelů snese nevyplněné nepovinné údaje', async () => {
		await prepareVault({
			'nastaveni.json': {
				supplier: null,
				contacts: [
					{
						id: 'a',
						name: 'Firma',
						ico: '27082440',
						address: {
							street: 'Dlouhá 1',
							city: 'Praha',
							zip: '11000',
						},
					},
				],
				pricelist: [],
			},
		});
		const c = await mountPage('/customers');
		await c.find('[data-testid="customer-search"]').setValue('Nenalezeno');
		await vi.waitFor(() => expect(c.find('[data-testid="customer-table"]').exists()).toBe(false));
	});
});
