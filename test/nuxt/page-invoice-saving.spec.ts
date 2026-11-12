import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import { newInvoice } from '~/schemas/invoices';

import { backend } from '../setup/backend';
import { completeSupplier } from '../setup/fixtures';
import {
	invoiceInVault,
	contact,
	mountInvoice,
	prepareInvoicePage,
	state,
	savedInvoice,
	savedAsNew,
	previewInvoice,
	save,
	savedDocuments,
} from '../setup/invoice-page';
import { answerDialog, currentPath, goto, layer } from '../setup/mount';

import type { VueWrapper } from '@vue/test-utils';

beforeEach(async () => {
	await prepareInvoicePage();
});

/** Načtená (už vystavená) faktura — uložení ji nesmí brát jako novou. */
function loadedInvoice(): Promise<VueWrapper> {
	invoiceInVault('20260001');
	return mountInvoice('20260001');
}

describe('uložení', () => {
	it('kliknutí na „Uložit" doklad vystaví', async () => {
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

		await c.find('[data-testid="action-save"]').trigger('click');
		await flushPromises();

		expect(backend.args('save_invoice')).toHaveLength(1);
		expect(savedInvoice(0).number).toBe('20260001');
		// Doklad je ve složce, ne jen ohlášený jako uložený.
		expect(savedDocuments().has('20260001')).toBe(true);
	});

	it('Uložit je tlačítko, které mačká ⌘S', async () => {
		const c = await mountInvoice();

		expect(c.find('[data-testid="action-save"]').attributes('data-save')).toBe('');
	});

	it('novou fakturu ukládá jako novou', async () => {
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

		await save(c);

		expect(savedAsNew(0)).toBe(true);
	});

	it('načtenou fakturu ukládá jako existující', async () => {
		const c = await loadedInvoice();

		await save(c);

		expect(savedAsNew(0)).toBe(false);
	});

	it('druhé uložení téže faktury už není nové', async () => {
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
		await save(c);

		await save(c);

		expect(savedAsNew(1)).toBe(false);
	});

	it('selhání přenačtení po uložení nezpůsobí druhé číslo', async () => {
		await prepareInvoicePage({
			pricelist: [
				{
					id: 'p1',
					name: 'Práce',
					priceCents: 100_000,
					unit: 'ks',
				},
			],
		});
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
		await c.find('[data-testid="insert-from-pricelist"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="pricelist-insert"]').trigger('click');
		await flushPromises();
		await c.find('[data-testid="item-remove-0"]').trigger('click');
		await flushPromises();
		// Archiv před kontrolou limitu se přečte; selže až přenačtení po uložení.
		let reads = 0;
		backend.fault = (command) => {
			if (command !== 'list_invoices') return null;
			reads += 1;
			return reads === 2 ? 'složka je nedostupná' : null;
		};

		await save(c);
		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Doklady se nepodařilo načíst',
				description: 'složka je nedostupná',
				color: 'error',
			}),
		);

		await save(c);

		expect(savedAsNew(1)).toBe(false);
	});

	it('nečitelný archiv uložení odmítne, protože bez něj nejde ohlídat limit', async () => {
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
		backend.breaks('list_invoices', 'složka je nedostupná');

		await save(c);

		expect(backend.args('save_invoice')).toEqual([]);
		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Fakturu se nepodařilo uložit',
				description: 'složka je nedostupná',
				color: 'error',
			}),
		);
	});

	it('po uložení přepočítá čísla v panelu', async () => {
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

		backend.forgetCalls();

		await save(c);

		// Jednou před kontrolou limitu, jednou pro panel po uložení.
		expect(backend.args('list_invoices')).toEqual([{ vaultPath: '/vault' }, { vaultPath: '/vault' }]);
	});

	it('pruh „Uloženo" nese cestu k vystavenému PDF', async () => {
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

		await save(c);

		const banner = c.find('[data-testid="saved"]');
		expect(banner?.text()).toContain('/vault/faktury/20260001.pdf');
		expect(c.find('[data-testid="statusbar"]').text()).toContain('Uloženo');
	});

	it('po zásahu do formuláře pruh „Uloženo" zmizí', async () => {
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
		await save(c);

		await c.find('[data-testid="field-note"]').setValue('Dodatek k faktuře');
		await flushPromises();

		expect(c.find('[data-testid="saved"]').exists()).toBe(false);
		expect(c.find('[data-testid="statusbar"]').text()).not.toContain('Uloženo');
	});

	it('chybu při ukládání ukáže', async () => {
		backend.breaks('save_invoice', 'číslo už existuje');
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

		await save(c);

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Fakturu se nepodařilo uložit',
				description: 'číslo už existuje',
				color: 'error',
			}),
		);
	});

	it('po uložení se odchod neptá', async () => {
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
		await save(c);

		await goto('/invoice');

		expect(currentPath()).toBe('/invoice');
	});

	it('prázdný variabilní symbol se doplní z čísla dokladu', async () => {
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

		await save(c);

		expect(savedInvoice(0).variableSymbol).toBe('20260001');
	});

	it('druhé odeslání během ukládání nic nespustí', async () => {
		backend.postpone('save_invoice');
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

		const saveButton = c.find('[data-testid="action-save"]');
		void saveButton.trigger('click');
		await saveButton.trigger('click');
		await flushPromises();

		expect(backend.args('save_invoice')).toHaveLength(1);
	});
});

describe('náhled', () => {
	it('vyrenderuje i nevyplněnou fakturu, bez ukládání', async () => {
		const c = await mountInvoice();

		await c.find('[data-testid="action-show"]').trigger('click');
		await flushPromises();

		expect(backend.args('preview_invoice')).toHaveLength(1);
		expect(backend.args('save_invoice')).toEqual([]);
		expect(layer().find('[data-testid="invoice-preview-page"]').attributes('src')).toBe(
			`data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg data-number="20260001"/>')}`,
		);
	});

	it('zavřený náhled zmizí', async () => {
		const c = await mountInvoice();
		await c.find('[data-testid="action-show"]').trigger('click');
		await flushPromises();

		await layer().find('[data-testid="invoice-preview-close"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="invoice-preview-heading"]').exists()).toBe(false);
	});

	it('selhání náhledu se ohlásí', async () => {
		backend.breaks('preview_invoice', 'Typst spadl');
		const c = await mountInvoice();

		await c.find('[data-testid="action-show"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Náhled se nepodařilo otevřít',
				description: 'Typst spadl',
				color: 'error',
			}),
		);
	});

	it('dvojklik na náhled renderuje jen jednou', async () => {
		backend.postpone('preview_invoice');
		const c = await mountInvoice();

		const show = c.find('[data-testid="action-show"]');
		void show.trigger('click');
		await show.trigger('click');
		await flushPromises();

		expect(backend.args('preview_invoice')).toHaveLength(1);
	});

	it('prázdný variabilní symbol doplní i pro náhled', async () => {
		const c = await mountInvoice();
		await c.find('[name="variableSymbol"]').setValue('');
		await flushPromises();

		await c.find('[data-testid="action-show"]').trigger('click');
		await flushPromises();

		expect(previewInvoice().variableSymbol).toBe('20260001');
	});
});

describe('odeslání e-mailem po uložení', () => {
	it('potvrzením se připraví zpráva s přílohou', async () => {
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
		await save(c);

		await layer().find('[data-testid="mail-send"]').trigger('click');
		await flushPromises();

		expect(backend.args('mail_compose_with_attachment')[0]).toEqual({
			vaultPath: '/vault',
			to: 'fakturace@acme.cz',
			subject: 'Faktura 20260001',
			body: 'Dobrý den,\n\nv příloze zasílám fakturu 20260001 na částku 10 000,00 Kč.\n\nS pozdravem',
			attachment: '/vault/faktury/20260001.pdf',
		});
	});

	it('odeslaná faktura se označí a další uložení se zeptá', async () => {
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
		await save(c);

		await layer().find('[data-testid="mail-send"]').trigger('click');
		await flushPromises();

		expect(backend.args('mark_invoice_sent')).toEqual([
			{
				vaultPath: '/vault',
				number: '20260001',
			},
		]);
		await c.find('[data-testid="action-save"]').trigger('click');
		await flushPromises();
		expect(layer().find('[data-testid="dialog-message"]').text()).toBe(
			'Doklad 20260001 už byl odeslaný a odběratel má u sebe původní verzi. Opravdu ho chceš upravit?',
		);
		await answerDialog(false);
	});

	it('selhání záznamu odeslání se ohlásí', async () => {
		backend.breaks('mark_invoice_sent', 'ISDOC nejde zapsat');
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
		await save(c);

		await layer().find('[data-testid="mail-send"]').trigger('click');
		await flushPromises();

		expect(backend.folder('/vault').sent.has('20260001')).toBe(false);
		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'E-mail se nepodařilo připravit',
				description: 'ISDOC nejde zapsat',
			}),
		);
	});

	it('odmítnutím se nabídka zavře a nic neodešle', async () => {
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
		await save(c);

		await layer().find('[data-testid="mail-no"]').trigger('click');
		await flushPromises();

		expect(backend.args('mail_compose_with_attachment')).toEqual([]);
		expect(layer().text()).not.toContain('Odeslat fakturu e-mailem');
	});

	it('odběratele s mezerami v údajích neuloží a řekne, co chybí', async () => {
		state.pendingInvoice.value = {
			...newInvoice(completeSupplier(), '20260001'),
			customer: {
				name: 'Acme s.r.o.',
				ico: '',
				dic: '',
				address: {
					street: 'Dlouhá 1',
					city: '  ',
					zip: '11000',
				},
				email: '',
				registration: '',
			},
		};
		const c = await mountInvoice();
		await c.find('[data-testid="item-label"]').setValue('Práce');
		await c.find('[data-testid="item-quantity"]').setValue('10');
		await c.find('[data-testid="item-price"]').setValue('1000');
		await flushPromises();
		await c.find('[data-testid="action-save"]').trigger('click');
		await flushPromises();

		expect(backend.args('save_invoice')).toEqual([]);
		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Odběrateli chybí IČO a\u00a0město — doplň je přes „Upravit".',
				color: 'error',
			}),
		);
	});

	it('u existující faktury se nabídka neukáže', async () => {
		const c = await loadedInvoice();
		await save(c);

		expect(layer().text()).not.toContain('Odeslat fakturu e-mailem');
	});
});

describe('úprava odeslaného dokladu', () => {
	it('uložení se nejdřív zeptá a po potvrzení doklad přepíše', async () => {
		invoiceInVault('20260001');
		backend.folder('/vault').sent.set('20260001', '2026-08-30T14:15:00Z');
		const c = await mountInvoice('20260001');

		await c.find('[data-testid="action-save"]').trigger('click');
		await flushPromises();
		expect(layer().find('[data-testid="dialog-message"]').text()).toBe(
			'Doklad 20260001 už byl odeslaný a odběratel má u sebe původní verzi. Opravdu ho chceš upravit?',
		);
		expect(backend.args('save_invoice')).toEqual([]);
		await answerDialog(true);
		await flushPromises();

		expect(savedAsNew(0)).toBe(false);
	});

	it('odmítnutí doklad nepřepíše', async () => {
		invoiceInVault('20260001');
		backend.folder('/vault').sent.set('20260001', '2026-08-30T14:15:00Z');
		const c = await mountInvoice('20260001');

		await c.find('[data-testid="action-save"]').trigger('click');
		await flushPromises();
		await answerDialog(false);
		await flushPromises();

		expect(backend.args('save_invoice')).toEqual([]);
	});

	it('neodeslaný doklad se před uložením neptá', async () => {
		const c = await loadedInvoice();

		await c.find('[data-testid="action-save"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="dialog-message"]').exists()).toBe(false);
		expect(savedAsNew(0)).toBe(false);
	});
});
