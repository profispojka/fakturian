import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useContacts } from '~/composables/useContacts';
import { canDiscardUnsaved } from '~/composables/useForm';

import { backend } from '../setup/backend';
import { answerDialog, currentPath, goto, layer, mountPage } from '../setup/mount';
import { savedField, prepareVault } from '../setup/vault';

import type { Contact } from '~/schemas/customers';

function contact(id: string, over: Partial<Contact> = {}): Contact {
	return {
		id,
		name: `Firma ${id}`,
		ico: '25596641',
		dic: 'CZ25596641',
		address: {
			street: 'Dlouhá 1',
			city: 'Praha',
			zip: '11000',
		},
		email: 'fakturace@firma.cz',
		note: '',
		...over,
	};
}

async function vaultWithCustomers(...customers: Contact[]): Promise<void> {
	await prepareVault({
		'nastaveni.json': {
			supplier: null,
			contacts: customers,
			pricelist: [],
		},
	});
}

function savedCustomers(): Contact[] {
	return savedField('nastaveni.json', 'contacts');
}

beforeEach(async () => {
	await vaultWithCustomers();
});

describe('zakládání a úprava', () => {
	it('bez id zakládá nového odběratele', async () => {
		const c = await mountPage('/customers/new');

		expect(c.find('[data-testid="customer-page-title"]').text()).toBe('Nový odběratel');
		await c.find('[data-testid="field-name"]').setValue('Nová firma');
		await c.find('[data-testid="field-ico"]').setValue('25596641');
		await c.find('[data-testid="field-email"]').setValue('fakturace@firma.cz');
		await c.find('[data-testid="field-address-street"]').setValue('Dlouhá 1');
		await c.find('[data-testid="field-address-city"]').setValue('Praha');
		await c.find('[data-testid="field-address-zip"]').setValue('11000');
		await c.find('[data-testid="action-save"]').trigger('click');
		await vi.waitFor(() => expect(currentPath()).toBe('/customers'));

		expect(savedCustomers()).toEqual([expect.objectContaining({ name: 'Nová firma' })]);
	});

	it('id v adrese načte odběratele a uloží jeho úpravu', async () => {
		await vaultWithCustomers(contact('k1', { name: 'Studio Mráz' }));
		const c = await mountPage('/customers/k1');

		expect(c.find('[data-testid="customer-page-title"]').text()).toBe('Upravit odběratele');
		expect(c.find<HTMLInputElement>('[data-testid="field-name"]').element.value).toBe('Studio Mráz');
		await c.find('[data-testid="field-name"]').setValue('Studio Mráz s.r.o.');
		await c.find('[data-testid="action-save"]').trigger('click');
		await vi.waitFor(() => expect(currentPath()).toBe('/customers'));

		expect(savedCustomers()).toEqual([contact('k1', { name: 'Studio Mráz s.r.o.' })]);
	});

	it('ARES doplní název, DIČ a adresu podle zadaného IČO', async () => {
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
		const c = await mountPage('/customers/new');
		await c.find('[data-testid="field-ico"]').setValue('27082440');

		await c.find('[data-testid="ares"]').trigger('click');
		await flushPromises();

		expect(c.find<HTMLInputElement>('[data-testid="field-name"]').element.value).toBe('Alza.cz a.s.');
		expect(c.find<HTMLInputElement>('[data-testid="field-dic"]').element.value).toBe('CZ27082440');
		expect(c.find<HTMLInputElement>('[data-testid="field-address-city"]').element.value).toBe('Praha');
	});

	it('uloženému odběrateli ARES nenabízí', async () => {
		await vaultWithCustomers(contact('k1'));
		const c = await mountPage('/customers/k1');

		expect(c.find('[data-testid="field-ico"]').exists()).toBe(true);
		expect(c.find('[data-testid="ares"]').exists()).toBe(false);
	});

	it('odpověď ARESu bez názvu nic nepřepíše a řekne proč', async () => {
		backend.ares.writeLiteral('27082440', {
			ico: '27082440',
			sidlo: {
				nazevObce: 'Praha',
			},
		});
		const c = await mountPage('/customers/new');
		await c.find('[data-testid="field-name"]').setValue('Rozepsaná firma');
		await c.find('[data-testid="field-ico"]').setValue('27082440');
		await c.find('[data-testid="field-address-city"]').setValue('Brno');

		await c.find('[data-testid="ares"]').trigger('click');
		await flushPromises();

		expect(c.find<HTMLInputElement>('[data-testid="field-name"]').element.value).toBe('Rozepsaná firma');
		expect(c.find<HTMLInputElement>('[data-testid="field-address-city"]').element.value).toBe('Brno');
		expect(c.find('[data-testid="ares-error"]').text()).toBe(
			'ARES k tomuto IČO nevrátil název firmy, údaje doplň ručně.',
		);
	});

	it('IČO, které ARES nezná, rozepsaný název nepřepíše', async () => {
		const c = await mountPage('/customers/new');
		await c.find('[data-testid="field-name"]').setValue('Rozepsaná firma');
		await c.find('[data-testid="field-ico"]').setValue('27082440');

		await c.find('[data-testid="ares"]').trigger('click');
		await flushPromises();

		expect(c.find<HTMLInputElement>('[data-testid="field-name"]').element.value).toBe('Rozepsaná firma');
	});

	it('bez IČO ARES rozepsaný název nepřepíše', async () => {
		const c = await mountPage('/customers/new');
		await c.find('[data-testid="field-name"]').setValue('Rozepsaná firma');

		await c.find('[data-testid="ares"]').trigger('click');
		await flushPromises();

		expect(c.find<HTMLInputElement>('[data-testid="field-name"]').element.value).toBe('Rozepsaná firma');
		expect(c.find('[data-testid="ares-error"]').exists()).toBe(false);
	});

	it('neznámé id ohlásí jako smazaného odběratele', async () => {
		const c = await mountPage('/customers/neexistuje');

		expect(c.find('[data-testid="empty-state"]').text()).toContain('v seznamu není');
		expect(c.find('[data-testid="customer-fields"]').exists()).toBe(false);
	});

	it('rozepsaná úprava původní záznam nemění a „Zrušit" ji zahodí', async () => {
		await vaultWithCustomers(contact('k1', { name: 'Studio Mráz' }));
		const c = await mountPage('/customers/k1');
		await c.find('[data-testid="field-name"]').setValue('Neuložená firma');

		expect(savedCustomers()).toEqual([contact('k1', { name: 'Studio Mráz' })]);

		await c.find('[data-testid="customer-cancel"]').trigger('click');
		await answerDialog(true);
		await vi.waitFor(() => expect(currentPath()).toBe('/customers'));

		expect(savedCustomers()).toEqual([contact('k1', { name: 'Studio Mráz' })]);
	});

	it('nepovedené uložení ohlásí a nechá rozepsaný formulář otevřený', async () => {
		await vaultWithCustomers(contact('k1', { name: 'Studio Mráz' }));
		const c = await mountPage('/customers/k1');
		await c.find('[data-testid="field-name"]').setValue('Studio Mráz s.r.o.');
		backend.breaks('write_data_file', 'disk je plný');

		await c.find('[data-testid="action-save"]').trigger('click');
		await vi.waitFor(() =>
			expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
				expect.objectContaining({
					title: 'Odběratele se nepodařilo uložit',
					description: 'disk je plný',
					color: 'error',
				}),
			),
		);

		expect(currentPath()).toBe('/customers/k1');
		expect(c.find<HTMLInputElement>('[data-testid="field-name"]').element.value).toBe('Studio Mráz s.r.o.');
		expect(useNuxtApp().vueApp.runWithContext(useContacts).contacts.value).toEqual([
			contact('k1', { name: 'Studio Mráz' }),
		]);
	});

	it('odchod s rozepsaným odběratelem se ptá a odmítnutím se zůstane', async () => {
		const c = await mountPage('/customers/new');
		await c.find('[data-testid="field-name"]').setValue('Rozepsaná firma');

		const leaving = goto('/customers');
		await answerDialog(false);
		await leaving;

		expect(currentPath()).toBe('/customers/new');
	});

	it('bez změn se odchod neptá', async () => {
		await vaultWithCustomers(contact('k1'));
		await mountPage('/customers/k1');

		await goto('/customers');

		expect(currentPath()).toBe('/customers');
		expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(false);
	});

	it('zavření okna s rozepsaným odběratelem se ptá', async () => {
		const c = await mountPage('/customers/new');
		await c.find('[data-testid="field-name"]').setValue('Rozepsaná firma');

		const closing = canDiscardUnsaved();
		await flushPromises();
		expect(layer().find('[data-testid="dialog-heading"]').text()).toBe('Zahodit neuložené změny?');

		await answerDialog(false);

		expect(await closing).toBe(false);
	});

	it('neplatný formulář zůstane otevřený a nic neuloží', async () => {
		const c = await mountPage('/customers/new');

		await c.find('[data-testid="action-save"]').trigger('click');
		await flushPromises();

		expect(savedCustomers()).toEqual([]);
		expect(c.find('[data-testid="customer-fields"]').exists()).toBe(true);
		expect(currentPath()).toBe('/customers/new');
	});

	it('odběratel jen se jménem se neuloží', async () => {
		const c = await mountPage('/customers/new');
		await c.find('[data-testid="field-name"]').setValue('Jen jméno');

		await c.find('[data-testid="action-save"]').trigger('click');
		await flushPromises();

		expect(savedCustomers()).toEqual([]);
		expect(currentPath()).toBe('/customers/new');
	});

	it('bez DIČ se odběratel uloží', async () => {
		const c = await mountPage('/customers/new');
		await c.find('[data-testid="field-name"]').setValue('Petr Malý');
		await c.find('[data-testid="field-ico"]').setValue('25596641');
		await c.find('[data-testid="field-email"]').setValue('petr@maly.cz');
		await c.find('[data-testid="field-address-street"]').setValue('Husova 41');
		await c.find('[data-testid="field-address-city"]').setValue('Plzeň');
		await c.find('[data-testid="field-address-zip"]').setValue('30100');

		await c.find('[data-testid="action-save"]').trigger('click');
		await flushPromises();

		expect(savedCustomers()).toEqual([expect.objectContaining({ name: 'Petr Malý' })]);
		expect(savedCustomers()[0]).not.toHaveProperty('dic');
		expect(savedCustomers()[0]).not.toHaveProperty('note');
	});

	it('e-mail a DIČ s mezerami okolo se uloží oříznuté', async () => {
		const c = await mountPage('/customers/new');
		await c.find('[data-testid="field-name"]').setValue('Petr Malý');
		await c.find('[data-testid="field-ico"]').setValue('25596641');
		await c.find('[data-testid="field-dic"]').setValue(' CZ25596641 ');
		await c.find('[data-testid="field-email"]').setValue('petr@maly.cz ');
		await c.find('[data-testid="field-address-street"]').setValue('Husova 41');
		await c.find('[data-testid="field-address-city"]').setValue('Plzeň');
		await c.find('[data-testid="field-address-zip"]').setValue('30100');

		await c.find('[data-testid="action-save"]').trigger('click');
		await flushPromises();

		expect(savedCustomers()).toEqual([
			expect.objectContaining({
				dic: 'CZ25596641',
				email: 'petr@maly.cz',
			}),
		]);
	});

	it('ARES u neplátce smaže DIČ, které zbylo z dřívějška', async () => {
		backend.ares.write({
			name: 'Jan Novák',
			ico: '00719331',
			address: {
				street: 'č.p. 120',
				city: 'Ostrožská Lhota',
				zip: '68723',
			},
		});
		const c = await mountPage('/customers/new');
		await c.find('[data-testid="field-dic"]').setValue('CZ25596641');
		await c.find('[data-testid="field-ico"]').setValue('00719331');

		await c.find('[data-testid="ares"]').trigger('click');
		await flushPromises();

		expect(c.find<HTMLInputElement>('[data-testid="field-dic"]').element.value).toBe('');
		await c.find('[data-testid="action-save"]').trigger('click');
		await flushPromises();
		expect(savedCustomers()).toEqual([expect.objectContaining({ name: 'Jan Novák' })]);
		expect(savedCustomers()[0]).not.toHaveProperty('dic');
	});

	it('vepsané a zase smazané DIČ odchod neblokuje', async () => {
		const c = await mountPage('/customers/new');
		await c.find('[data-testid="field-dic"]').setValue('C');
		await c.find('[data-testid="field-dic"]').setValue('');

		await goto('/customers');

		expect(currentPath()).toBe('/customers');
		expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(false);
	});

	it('uloží všechna vyplněná pole, ne jen jméno', async () => {
		const c = await mountPage('/customers/new');
		await c.find('[data-testid="field-name"]').setValue('Acme s.r.o.');
		await c.find('[data-testid="field-ico"]').setValue('25596641');
		await c.find('[data-testid="field-dic"]').setValue('CZ25596641');
		await c.find('[data-testid="field-email"]').setValue('fakturace@acme.cz');
		await c.find('[data-testid="field-address-street"]').setValue('Dlouhá 1');
		await c.find('[data-testid="field-address-city"]').setValue('Praha');
		await c.find('[data-testid="field-address-zip"]').setValue('11000');
		await c.find('[data-testid="field-note"]').setValue('platí po 30 dnech');

		await c.find('[data-testid="action-save"]').trigger('click');
		await flushPromises();

		expect(savedCustomers()).toEqual([
			expect.objectContaining({
				name: 'Acme s.r.o.',
				dic: 'CZ25596641',
				email: 'fakturace@acme.cz',
				note: 'platí po 30 dnech',
				address: expect.objectContaining({
					street: 'Dlouhá 1',
					city: 'Praha',
					zip: '11000',
				}),
			}),
		]);
	});

	it('tlačítko v pásu akcí odešle formulář', async () => {
		const c = await mountPage('/customers/new');
		await c.find('[data-testid="field-name"]').setValue('Z pásu akcí');
		await c.find('[data-testid="field-ico"]').setValue('25596641');
		await c.find('[data-testid="field-email"]').setValue('fakturace@firma.cz');
		await c.find('[data-testid="field-address-street"]').setValue('Dlouhá 1');
		await c.find('[data-testid="field-address-city"]').setValue('Praha');
		await c.find('[data-testid="field-address-zip"]').setValue('11000');

		await c.find('[data-testid="action-save"]').trigger('click');
		await flushPromises();

		expect(savedCustomers()).toEqual([expect.objectContaining({ name: 'Z pásu akcí' })]);
	});

	it('Uložit je tlačítko, které mačká ⌘S', async () => {
		const c = await mountPage('/customers/new');

		expect(c.find('[data-testid="action-save"]').attributes('data-save')).toBe('');
	});

	it('u neznámého id je Uložit zamčené', async () => {
		const c = await mountPage('/customers/neexistuje');

		expect(c.find('[data-testid="action-save"]').attributes('disabled')).toBe('');
	});

	it('vnořené údaje odděluje od uloženého modelu', async () => {
		await vaultWithCustomers(contact('k1', { name: 'Studio' }));
		const original = useNuxtApp().vueApp.runWithContext(useContacts).contacts.value[0];
		const c = await mountPage('/customers/k1');

		await c.find('[data-testid="field-address-city"]').setValue('Brno');

		expect(original?.address.city).toBe('Praha');

		await c.find('[data-testid="action-save"]').trigger('click');
		await flushPromises();

		expect(savedCustomers()).toEqual([
			expect.objectContaining({
				id: 'k1',
				name: 'Studio',
				address: expect.objectContaining({ city: 'Brno' }),
			}),
		]);
		expect(original?.address.city).toBe('Praha');
	});
});
