import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PricePicker from '~/components/invoice/PricePicker.vue';

import { layer, mountUi } from '../setup/mount';

describe('PricePicker', () => {
	it('vloží stejnou položku opakovaně kliknutím na řádek', async () => {
		const item = {
			id: 'p1',
			name: 'Konzultace',
			priceCents: 150000,
			unit: 'hod',
		};
		const c = mountUi(PricePicker, {
			props: {
				open: true,
				pricelist: [item],
				lines: [],
				remaining: () => 0,
			},
		});
		await flushPromises();

		await layer().find('[data-testid="pricelist-insert"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="pricelist-insert"]').trigger('click');
		await flushPromises();

		expect(c.emitted('add')).toEqual([[item], [item]]);
		expect(layer().find('[data-testid="pricelist-pick"]').exists()).toBe(true);
	});
});
