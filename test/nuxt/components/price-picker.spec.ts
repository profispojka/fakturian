import { flushPromises } from '@vue/test-utils';
import { DialogContent } from 'reka-ui';
import { describe, expect, it } from 'vitest';

import PricePicker from '~/components/invoice/PricePicker.vue';

import { mountUi, overlay } from '../../setup/mount';

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

		await overlay(DialogContent).find('[data-testid="pricelist-insert"]').trigger('click');
		await flushPromises();
		await overlay(DialogContent).find('[data-testid="pricelist-insert"]').trigger('click');
		await flushPromises();

		expect(c.emitted('add')).toEqual([[item], [item]]);
		expect(overlay(DialogContent).find('[data-testid="pricelist-pick"]').exists()).toBe(true);
	});
});
