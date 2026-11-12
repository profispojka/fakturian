import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import { newInvoice } from '~/schemas/invoices';
import { czkFromCents } from '~/utils/money';

import { backend } from '../setup/backend';
import { completeSupplier } from '../setup/fixtures';
import {
	invoiceInVault,
	contact,
	mountInvoice,
	prepareInvoicePage,
	savedInvoice,
	state,
	save,
} from '../setup/invoice-page';
import { CHECKBOX, check, layer } from '../setup/mount';

import type { VueWrapper } from '@vue/test-utils';
import type { PriceItem } from '~/schemas/pricelist';

beforeEach(async () => {
	await prepareInvoicePage();
});

async function openPricelist(c: VueWrapper) {
	await c.find('[data-testid="insert-from-pricelist"]').trigger('click');
	await flushPromises();
}

async function insertFirst() {
	await layer().find('[data-testid="pricelist-insert"]').trigger('click');
	await flushPromises();
}

describe('odběratel', () => {
	it('vybraného odběratele jde odebrat', async () => {
		state.contacts.value = [contact('k1', 'Studio Mráz')];
		const c = await mountInvoice();
		await c.find('[data-testid="choose-customer"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="customer-picker-item"]').trigger('click');
		await flushPromises();

		await c.find('[data-testid="remove-customer"]').trigger('click');
		await flushPromises();

		expect(c.find('[data-testid="choose-customer"]').exists()).toBe(true);
		expect(c.find('[data-testid="customer-summary"]').exists()).toBe(false);
	});

	it('nabídka odběratelů ukáže IČO i město', async () => {
		state.contacts.value = [contact('k1', 'Studio Mráz')];
		const c = await mountInvoice();

		await c.find('[data-testid="choose-customer"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="customer-picker-subtitle"]').text()).toBe('IČO 27082440 · Praha');
	});

	it('bez odběratelů nabídka pošle do evidence', async () => {
		const c = await mountInvoice();

		await c.find('[data-testid="choose-customer"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="empty-state"]').text()).toContain('Zatím žádní odběratelé');
	});

	it('v nabídce odběratelů jde hledat', async () => {
		state.contacts.value = [contact('k1', 'Studio Mráz'), contact('k2', 'Ateliér Kovář')];
		const c = await mountInvoice();
		await c.find('[data-testid="choose-customer"]').trigger('click');
		await flushPromises();

		await layer().find('[data-testid="customer-picker-search"]').setValue('kovář');
		await flushPromises();

		expect(layer().findAll('[data-testid="customer-picker-item"]')).toHaveLength(1);

		await layer().find('[data-testid="customer-picker-search"]').setValue('nikdo takový');
		await flushPromises();

		expect(layer().text()).toContain('Žádné položky nenalezeny');
	});

	it('znovuotevřená nabídka odběratelů hledá od začátku', async () => {
		state.contacts.value = [contact('k1', 'Studio Mráz'), contact('k2', 'Ateliér Kovář')];
		const c = await mountInvoice();
		await c.find('[data-testid="choose-customer"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="customer-picker-search"]').setValue('kovář');
		await flushPromises();
		await layer().find('button[aria-label="Zavřít"]').trigger('click');
		await flushPromises();

		await c.find('[data-testid="choose-customer"]').trigger('click');
		await flushPromises();

		expect(layer().findAll('[data-testid="customer-picker-item"]')).toHaveLength(2);
	});

	it('nabídku odběratelů zavře křížek', async () => {
		state.contacts.value = [contact('k1', 'Studio Mráz')];
		const c = await mountInvoice();
		await c.find('[data-testid="choose-customer"]').trigger('click');
		await flushPromises();
		expect(layer().find('[data-testid="customer-picker-list"]').exists()).toBe(true);

		await layer().find('button[aria-label="Zavřít"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="customer-picker-list"]').exists()).toBe(false);
	});

	it('odběratele jde zadat přímo na faktuře a rovnou uložit do Odběratelů', async () => {
		const c = await mountInvoice();
		await c.find('[data-testid="enter-customer"]').trigger('click');
		await flushPromises();

		expect(layer().find(`[data-testid="customer-remember"]${CHECKBOX}`).attributes('aria-checked')).toBe('true');
		await layer().find('[data-testid="customer-field-name"]').setValue('Pekárna Novák');
		await layer().find('[data-testid="customer-field-ico"]').setValue('27082440');
		await layer().find('[data-testid="customer-field-dic"]').setValue('CZ27082440');
		await layer().find('[data-testid="customer-field-email"]').setValue('pekarna@novak.cz');
		await layer().find('[data-testid="customer-field-street"]').setValue('Pekařská 3');
		await layer().find('[data-testid="customer-field-city"]').setValue('Olomouc');
		await layer().find('[data-testid="customer-field-zip"]').setValue('77900');
		await layer().find('[data-testid="customer-dialog-confirm"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="customer-dialog-form"]').exists()).toBe(false);
		expect(c.find('[data-testid="customer-summary"]').text()).toContain('Pekárna Novák');
		expect(c.find('[data-testid="customer-summary"]').text()).toContain('IČO: 27082440');
		expect(state.contacts.value).toEqual([
			{
				id: expect.any(String),
				name: 'Pekárna Novák',
				ico: '27082440',
				dic: 'CZ27082440',
				address: {
					street: 'Pekařská 3',
					city: 'Olomouc',
					zip: '77900',
				},
				email: 'pekarna@novak.cz',
			},
		]);
	});

	it('bez zaškrtnutí zůstane odběratel jen na faktuře', async () => {
		const c = await mountInvoice();
		await c.find('[data-testid="enter-customer"]').trigger('click');
		await flushPromises();

		await check(layer().find(`[data-testid="customer-remember"]${CHECKBOX}`), false);
		await layer().find('[data-testid="customer-field-name"]').setValue('Jednorázový klient');
		await layer().find('[data-testid="customer-field-ico"]').setValue('27082440');
		await layer().find('[data-testid="customer-field-email"]').setValue('klient@example.cz');
		await layer().find('[data-testid="customer-field-street"]').setValue('Krátká 1');
		await layer().find('[data-testid="customer-field-city"]').setValue('Brno');
		await layer().find('[data-testid="customer-field-zip"]').setValue('60200');
		await layer().find('[data-testid="customer-dialog-confirm"]').trigger('click');
		await flushPromises();

		expect(c.find('[data-testid="customer-summary"]').text()).toContain('Jednorázový klient');
		expect(state.contacts.value).toEqual([]);
	});

	it('Escape dialog zavře a rozepsaného odběratele na fakturu nedá', async () => {
		const c = await mountInvoice();
		await c.find('[data-testid="enter-customer"]').trigger('click');
		await flushPromises();

		await layer().find('[data-testid="customer-field-name"]').setValue('Rozepsaná firma');
		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'Escape',
				bubbles: true,
				cancelable: true,
			}),
		);
		await flushPromises();

		expect(layer().find('[data-testid="customer-dialog-form"]').exists()).toBe(false);
		expect(c.find('[data-testid="customer-summary"]').exists()).toBe(false);
	});

	it('neúplné údaje dialog na fakturu nepustí', async () => {
		const c = await mountInvoice();
		await c.find('[data-testid="enter-customer"]').trigger('click');
		await flushPromises();

		await layer().find('[data-testid="customer-field-name"]').setValue('Jen jméno');
		await layer().find('[data-testid="customer-dialog-confirm"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="customer-field-ico"]').attributes('aria-invalid')).toBe('true');
		expect(layer().find('[data-testid="customer-field-name"]').attributes('aria-invalid')).toBe('false');
		expect(c.find('[data-testid="customer-summary"]').exists()).toBe(false);
	});

	it('„Upravit" změní údaje jen na faktuře, uloženého odběratele nechá být', async () => {
		state.contacts.value = [contact('k1', 'Studio Mráz')];
		const c = await mountInvoice();
		await c.find('[data-testid="choose-customer"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="customer-picker-item"]').trigger('click');
		await flushPromises();

		await c.find('[data-testid="edit-customer"]').trigger('click');
		await flushPromises();

		expect(layer().find<HTMLInputElement>('[data-testid="customer-field-name"]').element.value).toBe('Studio Mráz');
		expect(layer().find(`[data-testid="customer-remember"]${CHECKBOX}`).attributes('aria-checked')).toBe('false');
		await layer().find('[data-testid="customer-field-email"]').setValue('ucetni@studiomraz.cz');
		await layer().find('[data-testid="customer-dialog-confirm"]').trigger('click');
		await flushPromises();

		expect(c.find('[data-testid="customer-summary"]').text()).toContain('ucetni@studiomraz.cz');
		expect(state.contacts.value).toEqual([contact('k1', 'Studio Mráz')]);
	});

	it('úprava odběratele z importovaného dokladu nezahodí jeho zápis v rejstříku', async () => {
		state.pendingInvoice.value = {
			...newInvoice(completeSupplier(), '2026001'),
			customer: {
				name: 'Acme s.r.o.',
				ico: '27082440',
				dic: '',
				address: {
					street: 'Dlouhá 1',
					city: 'Praha',
					zip: '11000',
				},
				email: 'fakturace@acme.cz',
				registration: 'C 123 vedená u Městského soudu v Praze',
			},
			lines: [
				{
					id: 'r1',
					description: 'Práce',
					quantity: 1,
					unit: 'ks',
					unitPriceCents: 100_000,
				},
			],
		};
		const c = await mountInvoice();

		await c.find('[data-testid="edit-customer"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="customer-field-city"]').setValue('Praha 1');
		await layer().find('[data-testid="customer-dialog-confirm"]').trigger('click');
		await flushPromises();

		await save(c);
		expect(savedInvoice(0).customer).toEqual(
			expect.objectContaining({
				address: expect.objectContaining({ city: 'Praha 1' }),
				registration: 'C 123 vedená u Městského soudu v Praze',
			}),
		);
	});

	it('ARES v dialogu doplní firmu podle IČO', async () => {
		backend.ares.write({
			name: 'Alza.cz a.s.',
			ico: '27082440',
			dic: 'CZ27082440',
			address: {
				street: 'Jankovcova 1522/53',
				city: 'Praha',
				zip: '17000',
			},
		});
		const c = await mountInvoice();
		await c.find('[data-testid="enter-customer"]').trigger('click');
		await flushPromises();

		await layer().find('[data-testid="customer-field-ico"]').setValue('27082440');
		await layer().find('[data-testid="customer-ares"]').trigger('click');
		await flushPromises();

		expect(layer().find<HTMLInputElement>('[data-testid="customer-field-name"]').element.value).toBe(
			'Alza.cz a.s.',
		);
		expect(layer().find<HTMLInputElement>('[data-testid="customer-field-dic"]').element.value).toBe('CZ27082440');
		expect(layer().find<HTMLInputElement>('[data-testid="customer-field-street"]').element.value).toBe(
			'Jankovcova 1522/53',
		);
	});

	it('během dotazu do ARES je pole IČO v dialogu zamčené', async () => {
		backend.ares.write({
			name: 'Alza.cz a.s.',
			ico: '27082440',
			dic: 'CZ27082440',
			address: {
				street: 'Jankovcova 1522/53',
				city: 'Praha',
				zip: '17000',
			},
		});
		const query = backend.postpone('ares_subject');
		const c = await mountInvoice();
		await c.find('[data-testid="enter-customer"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="customer-field-ico"]').setValue('27082440');
		await layer().find('[data-testid="customer-ares"]').trigger('click');
		await nextTick();

		expect(layer().find<HTMLInputElement>('[data-testid="customer-field-ico"]').element.disabled).toBe(true);

		query.finish();
		await flushPromises();

		expect(layer().find<HTMLInputElement>('[data-testid="customer-field-ico"]').element.disabled).toBe(false);
		expect(layer().find<HTMLInputElement>('[data-testid="customer-field-name"]').element.value).toBe(
			'Alza.cz a.s.',
		);
	});

	it('pozdní odpověď ARESu nepřepíše dialog, který uživatel mezitím zavřel a otevřel znovu', async () => {
		backend.ares.write({
			name: 'Alza.cz a.s.',
			ico: '27082440',
			dic: 'CZ27082440',
			address: {
				street: 'Jankovcova 1522/53',
				city: 'Praha',
				zip: '17000',
			},
		});
		const query = backend.postpone('ares_subject');
		const c = await mountInvoice();
		await c.find('[data-testid="enter-customer"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="customer-field-ico"]').setValue('27082440');
		await layer().find('[data-testid="customer-ares"]').trigger('click');
		await nextTick();

		await layer().find('[data-testid="customer-dialog-cancel"]').trigger('click');
		await flushPromises();
		await c.find('[data-testid="enter-customer"]').trigger('click');
		await flushPromises();
		query.finish();
		await flushPromises();

		expect(layer().find<HTMLInputElement>('[data-testid="customer-field-name"]').element.value).toBe('');
		expect(layer().find<HTMLInputElement>('[data-testid="customer-field-ico"]').element.value).toBe('');
	});

	it('ARES bez IČO řekne proč a nic nevyplní; znovuotevřený dialog hlášku nedrží', async () => {
		const c = await mountInvoice();
		await c.find('[data-testid="enter-customer"]').trigger('click');
		await flushPromises();

		await layer().find('[data-testid="customer-ares"]').trigger('click');
		await flushPromises();
		expect(layer().find('[data-testid="customer-ares-error"]').text()).toBe('Zadej nejdřív IČO.');

		await layer().find('[data-testid="customer-dialog-cancel"]').trigger('click');
		await flushPromises();
		expect(layer().find('[data-testid="customer-dialog-form"]').exists()).toBe(false);
		expect(c.find('[data-testid="customer-summary"]').exists()).toBe(false);

		await c.find('[data-testid="enter-customer"]').trigger('click');
		await flushPromises();
		expect(layer().find('[data-testid="customer-ares-error"]').exists()).toBe(false);
	});

	it('když se odběratel do Odběratelů neuloží, řekne to a na faktuře zůstane', async () => {
		backend.fails('write_data_file', 'Disk je plný');
		const c = await mountInvoice();
		await c.find('[data-testid="enter-customer"]').trigger('click');
		await flushPromises();

		await layer().find('[data-testid="customer-field-name"]').setValue('Pekárna Novák');
		await layer().find('[data-testid="customer-field-ico"]').setValue('27082440');
		await layer().find('[data-testid="customer-field-email"]').setValue('pekarna@novak.cz');
		await layer().find('[data-testid="customer-field-street"]').setValue('Pekařská 3');
		await layer().find('[data-testid="customer-field-city"]').setValue('Olomouc');
		await layer().find('[data-testid="customer-field-zip"]').setValue('77900');
		await layer().find('[data-testid="customer-dialog-confirm"]').trigger('click');
		await flushPromises();

		expect(c.find('[data-testid="customer-summary"]').text()).toContain('Pekárna Novák');
		expect(state.contacts.value).toEqual([]);
		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Odběratele se nepodařilo uložit do Odběratelů',
				color: 'error',
			}),
		);
	});
});

describe('položky faktury', () => {
	it('řádek jde přidat a smazat', async () => {
		const c = await mountInvoice();
		expect(c.findAll('[data-testid="item-label"]')).toHaveLength(1);

		await c.find('[data-testid="add-item"]').trigger('click');
		await flushPromises();
		expect(c.findAll('[data-testid="item-label"]')).toHaveLength(2);

		await c.find('[data-testid="item-remove-1"]').trigger('click');
		await flushPromises();
		expect(c.findAll('[data-testid="item-label"]')).toHaveLength(1);
	});

	it('smazání prostředního řádku nechá následujícímu řádku jeho prvky', async () => {
		const c = await mountInvoice();
		await c.find('[data-testid="add-item"]').trigger('click');
		await c.find('[data-testid="add-item"]').trigger('click');
		await flushPromises();
		const thirdRowRemove = c.find('[data-testid="item-remove-2"]').element;

		await c.find('[data-testid="item-remove-1"]').trigger('click');
		await flushPromises();

		expect(c.find('[data-testid="item-remove-1"]').element).toBe(thirdRowRemove);
	});

	it('u jediného řádku je křížek vypnutý', async () => {
		const c = await mountInvoice();

		expect(c.find('[data-testid="item-remove-0"]').attributes('disabled')).toBe('');

		await c.find('[data-testid="add-item"]').trigger('click');
		await flushPromises();

		expect(c.find('[data-testid="item-remove-0"]').attributes('disabled')).toBeUndefined();
	});

	it('křížek u řádku má přístupný název', async () => {
		const c = await mountInvoice();

		expect(c.find('[data-testid="item-remove-0"]').attributes('aria-label')).toBe('Odebrat položku 1');
	});

	it('buňky řádku mají přístupný název i s pořadím řádku', async () => {
		const c = await mountInvoice();
		await c.find('[data-testid="add-item"]').trigger('click');
		await flushPromises();

		expect(c.find('[data-testid="item-label"]').attributes('aria-label')).toBe('Popis položky 1');
		expect(c.find('[data-testid="item-quantity"]').attributes('aria-label')).toBe('Množství u položky 1');
		expect(c.find('[data-testid="item-unit"]').attributes('aria-label')).toBe('Jednotka u položky 1');
		expect(c.find('[data-testid="item-price"]').attributes('aria-label')).toBe('Cena za jednotku u položky 1');
		expect(c.findAll('[data-testid="item-label"]').map((cell) => cell.attributes('aria-label'))).toEqual([
			'Popis položky 1',
			'Popis položky 2',
		]);
	});

	it('položka z ceníku se přidá i s cenou', async () => {
		state.pricelist.value = [
			{
				id: 'p1',
				name: 'Konzultace',
				priceCents: 120_000,
				unit: 'hod',
			},
		];
		const c = await mountInvoice();

		await openPricelist(c);
		await insertFirst();

		const labels = c.findAll<HTMLInputElement>('[data-testid="item-label"]').map((i) => i.element.value);
		const prices = c.findAll<HTMLInputElement>('[data-testid="item-price"]').map((i) => i.element.value);
		expect(labels).toContain('Konzultace');
		expect(prices).toContain('1\u00A0200');
	});

	it('do dobropisu se cena z ceníku vloží záporná', async () => {
		state.pricelist.value = [
			{
				id: 'p1',
				name: 'Konzultace',
				priceCents: 120_000,
				unit: 'hod',
			},
		];
		state.pendingInvoice.value = {
			...newInvoice(completeSupplier(), '20260009'),
			documentType: 2,
			originalInvoice: '20260001',
		};
		const c = await mountInvoice();

		await openPricelist(c);
		await insertFirst();

		const prices = c.findAll<HTMLInputElement>('[data-testid="item-price"]').map((i) => i.element.value);
		expect(prices).toContain('-1\u00A0200');
	});

	it('s prázdným ceníkem je „Vložit z ceníku…" vypnuté', async () => {
		const c = await mountInvoice();

		expect(c.find('[data-testid="insert-from-pricelist"]').attributes('disabled')).toBe('');
	});

	it('nabídka ceníku ukáže cenu, jednotku i odlišnou poznámku', async () => {
		state.pricelist.value = [
			{
				id: 'p1',
				name: 'Konzultace',
				note: 'jen pro stálé klienty',
				priceCents: 120_000,
				unit: 'hod',
			},
			{
				id: 'p2',
				name: 'Školení',
				note: 'Školení',
				priceCents: 800_000,
				unit: 'den',
			},
			{
				id: 'p3',
				name: 'Analýza',
				priceCents: 1_500_000,
				unit: 'ks',
			},
		];
		const c = await mountInvoice();

		await openPricelist(c);

		const menu = layer().find('[data-testid="pricelist-pick"]').text();
		expect(menu).toContain('jen pro stálé klienty');
		expect(menu).toContain(czkFromCents(1200_00));
		expect(menu).toContain('hod');
		// Poznámka shodná s názvem se nekreslí, stejně jako chybějící.
		expect(layer().findAll('[data-testid="pricelist-note"]')).toHaveLength(1);
	});

	it('v nabídce ceníku jde hledat podle poznámky', async () => {
		state.pricelist.value = [
			{
				id: 'p1',
				name: 'Konzultace',
				note: 'grafika',
				priceCents: 120_000,
				unit: 'hod',
			},
			{
				id: 'p2',
				name: 'Školení',
				priceCents: 800_000,
				unit: 'den',
			},
		];
		const c = await mountInvoice();
		await openPricelist(c);

		await layer().find('[data-testid="pricelist-search"]').setValue('grafika');
		await flushPromises();

		expect(layer().findAll('[data-testid="pricelist-insert"]')).toHaveLength(1);
		expect(layer().text()).toContain('Konzultace');
	});

	it('vyprázdněný ceník nabídka pošle do Ceníku', async () => {
		state.pricelist.value = [
			{
				id: 'p1',
				name: 'Konzultace',
				priceCents: 120_000,
				unit: 'hod',
			},
		];
		const c = await mountInvoice();
		await openPricelist(c);

		state.pricelist.value = [];
		await flushPromises();

		expect(layer().find('[data-testid="empty-state"]').text()).toContain('Ceník je zatím prázdný');
	});

	it('nabídku ceníku zavře křížek', async () => {
		state.pricelist.value = [
			{
				id: 'p1',
				name: 'Konzultace',
				priceCents: 120_000,
				unit: 'hod',
			},
		];
		const c = await mountInvoice();
		await openPricelist(c);
		expect(layer().find('[data-testid="pricelist-pick"]').exists()).toBe(true);

		await layer().find('button[aria-label="Zavřít"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="pricelist-pick"]').exists()).toBe(false);
	});

	it('bez shody to nabídka ceníku řekne', async () => {
		state.pricelist.value = [
			{
				id: 'p1',
				name: 'Konzultace',
				priceCents: 120_000,
				unit: 'hod',
			},
		];
		const c = await mountInvoice();
		await openPricelist(c);

		await layer().find('[data-testid="pricelist-search"]').setValue('nic takového');
		await flushPromises();

		expect(layer().text()).toContain('Žádné položky nenalezeny');
	});

	it('nabídka ceníku hlásí, kolikrát je položka na dokladu', async () => {
		state.pricelist.value = [
			{
				id: 'p1',
				name: '  Konzultáce ',
				priceCents: 120_000,
				unit: 'hod',
			},
		];
		state.pendingInvoice.value = {
			...newInvoice(completeSupplier(), '20260009'),
			lines: [
				{
					id: 'r1',
					description: 'Konzultace',
					quantity: 1,
					unit: 'hod',
					unitPriceCents: 120_000,
				},
			],
		};
		const c = await mountInvoice();
		await openPricelist(c);

		expect(layer().find('[data-testid="pricelist-on-invoice"]').text()).toBe('na faktuře');

		await insertFirst();
		expect(layer().find('[data-testid="pricelist-on-invoice"]').text()).toBe('2× na faktuře');
	});

	it('součet se přepočítá podle řádků', async () => {
		const c = await mountInvoice();
		await c.find('[data-testid="item-quantity"]').setValue('10');
		await c.find('[data-testid="item-quantity"]').trigger('blur');
		await c.find('[data-testid="item-price"]').setValue('1000');
		await c.find('[data-testid="item-price"]').trigger('blur');
		await flushPromises();

		expect(c.find('[data-testid="total"]').text()).toBe(czkFromCents(1_000_000));
	});
});

describe('položky s ročním limitem', () => {
	const VACATION: PriceItem = {
		id: 'p-dov',
		name: 'Konzultační činnost',
		note: 'dovolená',
		priceCents: 90_000,
		unit: 'hod',
		icon: 'i-lucide-tree-palm',
		annualLimit: 160,
	};

	it('řádek hlídané položky nese odznáček s ikonkou', async () => {
		state.pricelist.value = [VACATION];
		const c = await mountInvoice();
		await openPricelist(c);
		await insertFirst();

		const badge = c.find('[data-testid="item-mark"]');
		expect(badge.exists()).toBe(true);
		expect(badge.text()).toContain('dovolená');
		expect(badge.find('[data-testid="item-mark-icon"]').classes()).toContain('i-lucide:tree-palm');
	});

	it('hlídaná položka bez ikonky má odznáček bez obrázku', async () => {
		state.pricelist.value = [
			{
				...VACATION,
				icon: undefined,
			},
		];
		const c = await mountInvoice();
		await openPricelist(c);
		await insertFirst();

		const badge = c.find('[data-testid="item-mark"]');
		expect(badge.text()).toContain('dovolená');
		expect(badge.find('[data-testid="item-mark-icon"]').exists()).toBe(false);
	});

	it('položka bez limitu odznáček nemá', async () => {
		state.pricelist.value = [
			{
				id: 'p1',
				name: 'Programování',
				priceCents: 140_000,
				unit: 'hod',
			},
		];
		const c = await mountInvoice();
		await openPricelist(c);
		await insertFirst();

		expect(c.find('[data-testid="item-mark"]').exists()).toBe(false);
	});

	it('vypíše množství na faktuře i zbytek limitu', async () => {
		await prepareInvoicePage({
			pricelist: [VACATION],
			usage: [
				{
					invoiceNumber: '20259001',
					itemId: VACATION.id,
					quantity: 64,
				},
			],
		});
		invoiceInVault('20260002', {
			lines: [
				{
					description: VACATION.name,
					quantity: 16,
					unit: 'hod',
					unitPriceCents: 120_000,
					itemId: VACATION.id,
				},
			],
		});
		const c = await mountInvoice('20260002');

		expect(c.text()).toContain('dovolená na faktuře: 16 hod');
		expect(c.text()).toContain('zbývá 96 hod');
	});

	it('bez hlídané položky na dokladu se nic nevypisuje', async () => {
		await prepareInvoicePage({ pricelist: [VACATION] });
		const c = await mountInvoice();

		expect(c.text()).not.toContain('na faktuře: ');
	});

	it('nabídka z ceníku ukazuje zbývající limit', async () => {
		await prepareInvoicePage({
			pricelist: [VACATION],
			usage: [
				{
					invoiceNumber: '20259001',
					itemId: VACATION.id,
					quantity: 64,
				},
			],
		});
		const c = await mountInvoice();

		await openPricelist(c);

		expect(layer().text()).toContain('zbývá 96 hod');
	});

	it('změna roku čerpání se zapíše k položce', async () => {
		await prepareInvoicePage({ pricelist: [VACATION] });
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
		await openPricelist(c);
		await insertFirst();

		await c.find('[data-testid="item-usage-year-1"]').setValue('2024');
		await c.find('[data-testid="item-usage-year-1"]').trigger('blur');
		await save(c);

		expect(savedInvoice().lines).toContainEqual(
			expect.objectContaining({
				itemId: VACATION.id,
				quantity: 1,
				usageYear: 2024,
			}),
		);
	});

	it('překročený roční limit uložení zastaví', async () => {
		await prepareInvoicePage({
			pricelist: [VACATION],
			usage: [
				{
					invoiceNumber: '20259001',
					itemId: VACATION.id,
					quantity: 144,
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
		await openPricelist(c);
		await insertFirst();
		await c.find('[data-testid="item-remove-0"]').trigger('click');
		await c.find('[data-testid="item-quantity"]').setValue('160');
		await c.find('[data-testid="item-quantity"]').trigger('blur');
		await flushPromises();

		await save(c);

		expect(backend.args('save_invoice')).toEqual([]);
	});
});
