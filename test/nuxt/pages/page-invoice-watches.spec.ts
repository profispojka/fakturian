import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import { canDiscardUnsaved } from '~/composables/useForm';

import { backend } from '../setup/backend';
import { contact, mountInvoice, prepareInvoicePage, state } from '../setup/invoice-page';
import { answerDialog, layer } from '../setup/mount';

beforeEach(async () => {
	await prepareInvoicePage();
});

describe('zavření okna', () => {
	it('rozepsaná faktura se před zavřením okna zeptá a okno nechá otevřené', async () => {
		const c = await mountInvoice();
		await c.find('[data-testid="item-label"]').setValue('Rozepsaná práce');
		await flushPromises();

		const closing = canDiscardUnsaved();
		await flushPromises();
		expect(layer().find('[data-testid="dialog-confirm"]').text()).toBe('Zahodit');

		await answerDialog(false);

		expect(await closing).toBe(false);
	});

	it('bez změn se okno zavře bez ptaní', async () => {
		await mountInvoice();

		expect(await canDiscardUnsaved()).toBe(true);
		expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(false);
	});

	it('potvrzením se zavření pustí', async () => {
		const c = await mountInvoice();
		await c.find('[data-testid="item-label"]').setValue('Rozepsaná práce');
		await flushPromises();

		const closing = canDiscardUnsaved();
		await flushPromises();
		await answerDialog(true);

		expect(await closing).toBe(true);
	});
});

describe('variabilní symbol', () => {
	it('nečíselný variabilní symbol fakturu neuloží', async () => {
		const c = await mountInvoice();
		state.contacts.value.push(contact('k1'));
		await flushPromises();
		await c.find('[data-testid="choose-customer"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="customer-picker-item"]').trigger('click');
		await flushPromises();
		await c.find('[data-testid="item-label"]').setValue('Práce');
		await c.find('[data-testid="item-quantity"]').setValue('10');
		await c.find('[data-testid="item-quantity"]').trigger('blur');
		await c.find('[data-testid="item-price"]').setValue('1000');
		await c.find('[data-testid="item-price"]').trigger('blur');
		await flushPromises();
		await c.find('[name="variableSymbol"]').setValue('FA-2026-7');
		await c.find('[data-testid="action-save"]').trigger('click');
		await flushPromises();

		expect(backend.args('save_invoice')).toEqual([]);
		expect(c.find('[name="variableSymbol"]').attributes('aria-invalid')).toBe('true');
	});

	it('prázdný variabilní symbol uložení nezablokuje', async () => {
		const c = await mountInvoice();
		state.contacts.value.push(contact('k1'));
		await flushPromises();
		await c.find('[data-testid="choose-customer"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="customer-picker-item"]').trigger('click');
		await flushPromises();
		await c.find('[data-testid="item-label"]').setValue('Práce');
		await c.find('[data-testid="item-quantity"]').setValue('10');
		await c.find('[data-testid="item-quantity"]').trigger('blur');
		await c.find('[data-testid="item-price"]').setValue('1000');
		await c.find('[data-testid="item-price"]').trigger('blur');
		await flushPromises();
		await c.find('[name="variableSymbol"]').setValue('');
		await c.find('[data-testid="action-save"]').trigger('click');
		await flushPromises();

		expect(backend.args('save_invoice')).toHaveLength(1);
	});
});
