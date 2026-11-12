import { beforeEach, describe, expect, it } from 'vitest';

import Customers from '~/pages/customers.vue';
import CustomerForm from '~/pages/customers/[id].vue';
import Expense from '~/pages/expense.vue';
import ExpenseForm from '~/pages/expense/[id].vue';
import Invoice from '~/pages/invoice.vue';
import InvoiceForm from '~/pages/invoice/[id].vue';
import Pricelist from '~/pages/pricelist.vue';
import PriceForm from '~/pages/pricelist/[id].vue';

import { mountPage } from '../setup/mount';
import { prepareVault } from '../setup/vault';

beforeEach(async () => {
	await prepareVault();
});

describe('rodič sekce', () => {
	it.each([
		['/customers/new', Customers, CustomerForm],
		['/expense/new', Expense, ExpenseForm],
		['/invoice/new', Invoice, InvoiceForm],
		['/pricelist/new', Pricelist, PriceForm],
	])('%s vykreslí formulář uvnitř rodiče sekce', async (path, parent, form) => {
		const c = await mountPage(path);

		expect(c.findComponent(parent).findComponent(form).exists()).toBe(true);
	});
});
