import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import { newInvoice } from '~/schemas/invoices';

import { backend } from '../../setup/backend';
import { completeSupplier } from '../../setup/fixtures';
import {
	contact,
	invoiceInVault,
	mountInvoice,
	prepareInvoicePage,
	state,
	savedAsNew,
	save,
} from '../../setup/invoice-page';
import { answerDialog, currentPath, goto, layer, shortcut } from '../../setup/mount';

beforeEach(async () => {
	await prepareInvoicePage();
});

function palette() {
	return useState<boolean>('paletteOpen', () => false);
}

describe('klávesové zkratky', () => {
	it('⌘P náhled neotevírá a klávesu si nebere', async () => {
		const c = await mountInvoice();
		state.contacts.value.push(contact('k1'));
		await backend.settled();
		await c.find('[data-testid="choose-customer"]').trigger('click');
		await backend.settled();
		await layer().find('[data-testid="customer-picker-item"]').trigger('click');
		await backend.settled();
		await c.find('[data-testid="item-label"]').setValue('Práce');
		await c.find('[data-testid="item-quantity"]').setValue('10');
		await c.find('[data-testid="item-quantity"]').trigger('blur');
		await c.find('[data-testid="item-price"]').setValue('1000');
		await c.find('[data-testid="item-price"]').trigger('blur');
		await backend.settled();

		const e = await shortcut('p');

		expect(backend.args('preview_invoice')).toEqual([]);
		expect(e.defaultPrevented).toBe(false);
		expect(palette().value).toBe(false);
	});
});

describe('příchod na /invoice/new', () => {
	it('nad otevřeným dokladem založí čistý s dalším číslem v řadě', async () => {
		await invoiceInVault('20260001');
		await invoiceInVault('20260007');
		const c = await mountInvoice('20260001');

		await goto('/invoice/new');
		await backend.settled();

		expect(c.find('[data-testid="document-number"]').text()).toBe('20260008');
	});

	it('bez datové složky doklad nezakládá', async () => {
		const c = await mountInvoice();
		await goto('/invoice');
		state.vaultPath.value = null;

		await goto('/invoice/new');

		expect(c.find('[data-testid="document-number"]').text()).toBe('');
	});

	it('uložení doplní prázdný variabilní symbol z čísla', async () => {
		const c = await mountInvoice();
		state.contacts.value.push(contact('k1'));
		await backend.settled();
		await c.find('[data-testid="choose-customer"]').trigger('click');
		await backend.settled();
		await layer().find('[data-testid="customer-picker-item"]').trigger('click');
		await backend.settled();
		await c.find('[data-testid="item-label"]').setValue('Práce');
		await c.find('[data-testid="item-quantity"]').setValue('10');
		await c.find('[data-testid="item-quantity"]').trigger('blur');
		await c.find('[data-testid="item-price"]').setValue('1000');
		await c.find('[data-testid="item-price"]').trigger('blur');
		await backend.settled();
		await c.find('[name="variableSymbol"]').setValue('');
		await backend.settled();

		await c.find('[data-testid="action-save"]').trigger('click');
		await backend.settled();

		expect(c.find<HTMLInputElement>('[name="variableSymbol"]').element.value).toBe('20260001');
	});

	it('během ukládání je Uložit zamčené', async () => {
		backend.postpone('save_invoice');
		const c = await mountInvoice();
		state.contacts.value.push(contact('k1'));
		await backend.settled();
		await c.find('[data-testid="choose-customer"]').trigger('click');
		await backend.settled();
		await layer().find('[data-testid="customer-picker-item"]').trigger('click');
		await backend.settled();
		await c.find('[data-testid="item-label"]').setValue('Práce');
		await c.find('[data-testid="item-quantity"]').setValue('10');
		await c.find('[data-testid="item-quantity"]').trigger('blur');
		await c.find('[data-testid="item-price"]').setValue('1000');
		await c.find('[data-testid="item-price"]').trigger('blur');
		await backend.settled();
		await c.find('[data-testid="action-save"]').trigger('click');
		await backend.settled();

		expect(c.find('[data-testid="action-save"]').attributes('disabled')).toBe('');
	});

	it('Nová nad otevřeným dokladem přejde na čistý doklad', async () => {
		await invoiceInVault('20260001');
		const c = await mountInvoice('20260001');

		await c.find('[data-testid="action-new"]').trigger('click');

		await vi.waitFor(() => expect(currentPath()).toBe('/invoice/new'));
	});
});

describe('rozepsaná faktura', () => {
	it('odchod s rozepsanou fakturou se ptá', async () => {
		const c = await mountInvoice();
		await c.find('[data-testid="item-label"]').setValue('Rozepsaná práce');
		await backend.settled();

		const leaving = goto('/invoice');
		await answerDialog(true);
		await leaving;

		expect(currentPath()).toBe('/invoice');
	});

	it('odmítnutím se na stránce zůstane', async () => {
		const c = await mountInvoice();
		await c.find('[data-testid="item-label"]').setValue('Rozepsaná práce');
		await backend.settled();

		const leaving = goto('/invoice');
		await answerDialog(false);
		await leaving;

		expect(currentPath()).toBe('/invoice/new');
	});

	it('bez změn se odchod neptá', async () => {
		await mountInvoice();

		await goto('/invoice');

		expect(currentPath()).toBe('/invoice');
		expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(false);
	});

	it('výměna dokladu na téže stránce se ptá taky', async () => {
		await invoiceInVault('20260001');
		const c = await mountInvoice();
		await c.find('[data-testid="item-label"]').setValue('Rozepsaná práce');
		await backend.settled();

		const swapping = goto('/invoice/20260001');
		await answerDialog(true);
		await swapping;

		expect(currentPath()).toBe('/invoice/20260001');
	});

	it('„Nová" se nad rozepsanou fakturou ptá', async () => {
		const c = await mountInvoice();
		await c.find('[data-testid="item-label"]').setValue('Rozepsaná práce');
		await backend.settled();

		await c.find('[data-testid="action-new"]').trigger('click');
		await backend.settled();

		expect(layer().find('[data-testid="dialog-heading"]').text()).toBe('Zahodit neuložené změny?');
		await answerDialog(false);
	});

	it('odmítnutá „Nová" formulář nechá být', async () => {
		const c = await mountInvoice();
		await c.find('[data-testid="item-label"]').setValue('Rozepsaná práce');
		await backend.settled();
		backend.forgetCalls();

		await c.find('[data-testid="action-new"]').trigger('click');
		await answerDialog(false);
		await backend.settled();

		expect(backend.args('list_used_numbers')).toEqual([]);
		expect(c.find<HTMLInputElement>('[data-testid="item-label"]').element.value).toBe('Rozepsaná práce');
	});

	it('přeběhnutí po výměně dokladu samo zhasne', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const c = await mountInvoice();

		await c.find('[data-testid="action-new"]').trigger('click');
		await backend.settled();
		expect(c.find('[data-testid="body"]').attributes('data-swapping')).toBe('true');

		await vi.advanceTimersByTimeAsync(900);
		await nextTick();

		expect(c.find('[data-testid="body"]').attributes('data-swapping')).toBeUndefined();
	});
});

describe('předvyplněný doklad ze seznamu', () => {
	it('„Nová" zahodí doklad, který seznam nechal viset', async () => {
		await invoiceInVault('20260007');
		const c = await mountInvoice();
		await c.find('[data-testid="item-label"]').setValue('Rozepsaná práce');
		await backend.settled();
		state.pendingInvoice.value = newInvoice(completeSupplier(), '20260001');

		await c.find('[data-testid="action-new"]').trigger('click');
		await answerDialog(true);
		await backend.settled();

		expect(state.pendingInvoice.value).toBeNull();
		expect(c.find('[data-testid="document-number"]').text()).toBe('20260008');
		state.contacts.value.push(contact('k1'));
		await backend.settled();
		await c.find('[data-testid="choose-customer"]').trigger('click');
		await backend.settled();
		await layer().find('[data-testid="customer-picker-item"]').trigger('click');
		await backend.settled();
		await c.find('[data-testid="item-label"]').setValue('Práce');
		await c.find('[data-testid="item-quantity"]').setValue('10');
		await c.find('[data-testid="item-quantity"]').trigger('blur');
		await c.find('[data-testid="item-price"]').setValue('1000');
		await c.find('[data-testid="item-price"]').trigger('blur');
		await backend.settled();
		await save(c);
		expect(savedAsNew(0)).toBe(true);
	});

	it('zamítnutá výměna dokladu čekající doklad zahodí', async () => {
		await invoiceInVault('20260001');
		const c = await mountInvoice();
		await c.find('[data-testid="item-label"]').setValue('Rozepsaná práce');
		await backend.settled();
		state.pendingInvoice.value = newInvoice(completeSupplier(), '20260005');

		const swapping = goto('/invoice/20260001');
		await answerDialog(false);
		await swapping;

		expect(currentPath()).toBe('/invoice/new');
		expect(state.pendingInvoice.value).toBeNull();
	});

	it('selhání načtení se ohlásí', async () => {
		await invoiceInVault('20260001');
		// Výpis doklad ještě přečetl; než si o něj stránka řekla, PDF se na disku poškodilo.
		const loading = backend.postpone('load_invoice');
		await mountInvoice('20260001');
		backend.writeBytes('/vault/faktury/20260001.pdf', new TextEncoder().encode('poškozené PDF'));
		loading.finish();
		await backend.settled();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Fakturu se nepodařilo otevřít',
				description: 'Doklad 20260001 nejde přečíst. Oprav nebo obnov PDF ze zálohy.',
				color: 'error',
			}),
		);
	});

	it('po selhání načtení je další otevření čistá nová faktura', async () => {
		await invoiceInVault('20260001');
		const loading = backend.postpone('load_invoice');
		const first = await mountInvoice('20260001');
		backend.writeBytes('/vault/faktury/20260001.pdf', new TextEncoder().encode('poškozené PDF'));
		loading.finish();
		await backend.settled();
		first.unmount();
		backend.forgetCalls();

		const c = await mountInvoice();

		expect(backend.args('load_invoice')).toEqual([]);
		expect(c.find('[data-testid="document-number"]').text()).toBe('20260002');
		state.contacts.value.push(contact('k1'));
		await backend.settled();
		await c.find('[data-testid="choose-customer"]').trigger('click');
		await backend.settled();
		await layer().find('[data-testid="customer-picker-item"]').trigger('click');
		await backend.settled();
		await c.find('[data-testid="item-label"]').setValue('Práce');
		await c.find('[data-testid="item-quantity"]').setValue('10');
		await c.find('[data-testid="item-quantity"]').trigger('blur');
		await c.find('[data-testid="item-price"]').setValue('1000');
		await c.find('[data-testid="item-price"]').trigger('blur');
		await backend.settled();
		await save(c);
		expect(savedAsNew(0)).toBe(true);
	});
});

describe('přepnutí dokladu dřív, než se načte', () => {
	it('pozdní odpověď dřív otevřeného dokladu nepřepíše ten, na který adresa přešla', async () => {
		await invoiceInVault('20260001');
		await invoiceInVault('20260002');
		const first = backend.postpone('load_invoice');
		const c = await mountInvoice('20260001');

		await goto('/invoice/20260002');
		first.finish();
		await backend.settled();

		expect(currentPath()).toBe('/invoice/20260002');
		expect(c.find<HTMLInputElement>('[data-testid="field-number"]').element.value).toBe('20260002');
	});

	it('pozdě přidělené číslo nového dokladu nepřepíše doklad, na který adresa přešla', async () => {
		await invoiceInVault('20260001');
		const numbering = backend.postpone('list_used_numbers');
		const c = await mountInvoice();

		await goto('/invoice/20260001');
		numbering.finish();
		await backend.settled();

		expect(currentPath()).toBe('/invoice/20260001');
		expect(c.find<HTMLInputElement>('[data-testid="field-number"]').element.value).toBe('20260001');
	});

	it('pozdní selhání číselné řady doklad, na který adresa přešla, nevyprázdní ani nehlásí', async () => {
		await invoiceInVault('20260001');
		const numbering = backend.postpone('list_used_numbers');
		backend.fails('list_used_numbers', 'Složku faktury/ nejde přečíst');
		const c = await mountInvoice();

		await goto('/invoice/20260001');
		numbering.finish();
		await backend.settled();

		expect(c.find<HTMLInputElement>('[data-testid="field-number"]').element.value).toBe('20260001');
		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toEqual([]);
	});
});
