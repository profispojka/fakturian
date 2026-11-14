import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ContactPicker from '~/components/invoice/ContactPicker.vue';

import { layer, mountUi } from '../setup/mount';

import type { Contact } from '~/schemas/customers';

function contact(over: Partial<Contact> = {}): Contact {
	return {
		id: 'k1',
		name: 'Studio Mráz',
		ico: '25596641',
		address: {
			street: 'Dlouhá 1',
			city: 'Praha',
			zip: '11000',
		},
		...over,
	};
}

async function openPicker(contacts: Contact[]) {
	const c = mountUi(ContactPicker, {
		props: {
			contacts,
			open: true,
		},
	});
	await flushPromises();
	return c;
}

describe('iniciály ve výběru klienta', () => {
	it('klient má u jména iniciály', async () => {
		await openPicker([contact({ email: 'mraz@seznam.cz' })]);

		expect(layer().find('[data-testid="customer-picker-avatar"]').attributes('src')).toBeUndefined();
		expect(layer().find('[data-testid="customer-picker-avatar"]').text()).toBe('SM');
	});
});

describe('podtitulek ve výběru', () => {
	it('ukáže IČO a město', async () => {
		await openPicker([contact()]);

		expect(layer().find('[data-testid="customer-picker-subtitle"]').text()).toBe('IČO 25596641 · Praha');
	});
});
