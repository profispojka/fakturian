import { describe, expect, it } from 'vitest';

import Money from '~/components/Money.vue';

import { mountUi } from '../setup/mount';

describe('částka', () => {
	it('píše číslo a měnu stejně jako textová částka', () => {
		const c = mountUi(Money, {
			props: {
				cents: 1_234_500,
			},
		});

		expect(c.text()).toBe('12 345,00 Kč');
	});

	it('u celých korun haléře vynechá', () => {
		const c = mountUi(Money, {
			props: {
				cents: 1_234_567,
				whole: true,
			},
		});

		expect(c.text()).toBe('12 346 Kč');
	});

	it('zápornou částku píše s mínusem', () => {
		const c = mountUi(Money, {
			props: {
				cents: -250_000,
			},
		});

		expect(c.text()).toBe('-2 500,00 Kč');
	});

	it('bez částky nevykreslí nic', () => {
		const c = mountUi(Money, {
			props: {
				cents: undefined,
			},
		});

		expect(c.find('[data-testid="money"]').exists()).toBe(false);
	});
});
