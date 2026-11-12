import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { backend } from '../setup/backend';
import { mountPage, answerDialog, currentPath, layer } from '../setup/mount';
import { savedField, prepareVault } from '../setup/vault';

import type { VueWrapper } from '@vue/test-utils';
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

async function openActions(c: VueWrapper, id = 'k1') {
	await c.find(`[data-testid="customer-actions-${id}"]`).trigger('click');
	await vi.waitFor(() => expect(layer().find('[data-testid="customer-delete"]').exists()).toBe(true));
}

function mount() {
	return mountPage('/customers');
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

function savingCustomer(): Contact[] {
	return savedField('nastaveni.json', 'contacts');
}

beforeEach(async () => {
	await vaultWithCustomers();
});

describe('iniciály u jména', () => {
	it('odběratel má u jména iniciály', async () => {
		await vaultWithCustomers(
			contact('k1', {
				name: 'Studio Mráz',
				email: 'mraz@seznam.cz',
			}),
		);

		const c = await mount();

		expect(c.find('[data-testid="customer-edit"] img').exists()).toBe(false);
		expect(c.find('[data-testid="customer-edit"]').text()).toContain('SMStudio Mráz');
	});
});

describe('výpis odběratelů', () => {
	it('dvojklik na řádek otevře jeho odběratele', async () => {
		await vaultWithCustomers(contact('k1'), contact('k2'));
		const c = await mount();
		await c.find('[data-testid="customer-entry-k2"]').trigger('click', { detail: 2 });
		await vi.waitFor(() => expect(currentPath()).toBe('/customers/k2'));
	});

	it('klik na řádek odběratele jen označí', async () => {
		await vaultWithCustomers(contact('k1'), contact('k2'));
		const c = await mount();
		await c.find('[data-testid="customer-entry-k2"]').trigger('click');
		expect(c.find('[data-testid="customer-entry-k2"]').attributes('data-selected')).toBe('true');
		await flushPromises();
		expect(currentPath()).toBe('/customers');
	});

	it('hledání přesune akce na viditelného odběratele a smaže právě jeho', async () => {
		await vaultWithCustomers(contact('k1', { name: 'Alfa' }), contact('k2', { name: 'Beta' }));
		const c = await mount();
		await c.find('[data-testid="customer-search"]').setValue('Beta');
		await vi.waitFor(() =>
			expect(c.find('[data-testid="customer-entry-k2"]').attributes('data-selected')).toBe('true'),
		);
		await openActions(c, 'k2');
		await layer().find('[data-testid="customer-delete"]').trigger('click');
		await answerDialog(true);
		await flushPromises();
		expect(savingCustomer().map((customer) => customer.id)).toEqual(['k1']);
		expect(c.find('[data-testid="customer-entry-k2"]').exists()).toBe(false);
	});

	it('řazení přepne pořadí jmen v obou směrech', async () => {
		await vaultWithCustomers(contact('k1', { name: 'Beta' }), contact('k2', { name: 'Alfa' }));
		const c = await mount();
		expect(c.findAll('[data-testid="customer-edit"]').map((link) => link.attributes('href'))).toEqual([
			'/customers/k2',
			'/customers/k1',
		]);
		await c.find('[data-testid="customer-sort"]').trigger('click');
		expect(c.findAll('[data-testid="customer-edit"]').map((link) => link.attributes('href'))).toEqual([
			'/customers/k1',
			'/customers/k2',
		]);
	});

	it('bez odběratelů to řekne', async () => {
		const c = await mount();
		expect(c.find('[data-testid="empty-state"]').text()).toBe('Zatím žádní odběratelé.');
	});

	it('vypíše odběratele', async () => {
		await vaultWithCustomers(contact('k1', { name: 'Studio Mráz' }));

		const c = await mount();
		expect(c.find('[data-testid="customer-table"]').text()).toContain('Studio Mráz');
	});

	it('hledá podle názvu, IČO, města i e-mailu', async () => {
		await vaultWithCustomers(
			contact('k1', {
				name: 'Studio Mráz',
				address: {
					street: 'Dlouhá 1',
					city: 'Brno',
					zip: '60200',
				},
			}),
			contact('k2', { name: 'Acme' }),
		);
		const c = await mount();

		await c.find('[data-testid="customer-search"]').setValue('brno');
		await vi.waitFor(() => expect(c.findAll('[data-testid="customer-edit"]')).toHaveLength(1));

		expect(c.find('[data-testid="customer-table"]').text()).toContain('Studio Mráz');
	});

	it('bez shody to řekne', async () => {
		await vaultWithCustomers(contact('k1'));
		const c = await mount();

		await c.find('[data-testid="customer-search"]').setValue('nikdo');

		await vi.waitFor(() =>
			expect(c.find('[data-testid="empty-state-filtered"]').text()).toBe('Žádné položky nenalezeny.'),
		);
	});
});

describe('odchod na stránku odběratele', () => {
	it('„Přidat odběratele" otevře prázdný formulář', async () => {
		const c = await mount();

		await c.find('[data-testid="customer-add"]').trigger('click');
		await vi.waitFor(() => expect(currentPath()).toBe('/customers/new'));
	});

	it('klik na jméno otevře úpravu toho odběratele', async () => {
		await vaultWithCustomers(contact('k1', { name: 'Studio Mráz' }));
		const c = await mount();

		await c.find('[data-testid="customer-edit"]').trigger('click');
		await vi.waitFor(() => expect(currentPath()).toBe('/customers/k1'));
	});
});

describe('mazání', () => {
	it('po potvrzení smaže', async () => {
		await vaultWithCustomers(contact('k1', { name: 'Studio Mráz' }));
		const c = await mount();

		await openActions(c);
		await layer().find('[data-testid="customer-delete"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="dialog-message"]').text()).toContain('Studio Mráz');
		await answerDialog(true);
		await flushPromises();

		expect(savingCustomer()).toEqual([]);
	});

	it('odmítnuté potvrzení nemaže', async () => {
		await vaultWithCustomers(contact('k1'));
		const c = await mount();

		await openActions(c);
		await layer().find('[data-testid="customer-delete"]').trigger('click');
		await answerDialog(false);
		await flushPromises();

		expect(savingCustomer()).toHaveLength(1);
	});

	it('selhání zápisu obnoví stav a další pokus odběratele smaže', async () => {
		await vaultWithCustomers(contact('k1', { name: 'Studio Mráz' }));
		backend.breaks('write_data_file', 'nastaveni.json je zamčený');
		const c = await mount();

		await openActions(c);
		await layer().find('[data-testid="customer-delete"]').trigger('click');
		await flushPromises();
		await answerDialog(true);
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Odběratele se nepodařilo smazat',
				description: 'nastaveni.json je zamčený',
				color: 'error',
			}),
		);
		expect(savingCustomer()).toHaveLength(1);

		backend.repairs('write_data_file');
		await openActions(c);
		await layer().find('[data-testid="customer-delete"]').trigger('click');
		await answerDialog(true);
		await flushPromises();

		expect(savingCustomer()).toEqual([]);
	});
});

describe('nepovedené načtení', () => {
	it('poškozená data ohlásí místo tvrzení, že odběratelé nejsou', async () => {
		await expect(
			prepareVault({
				'nastaveni.json': {
					contacts: 'rozbito',
				},
			}),
		).rejects.toThrow(
			new Error(
				'Soubor nastaveni.json má poškozený obsah (contacts: Neplatný vstup: očekáváno pole, obdrženo řetězec).',
			),
		);
		const c = await mount();

		expect(c.find('[data-testid="empty-state-error"]').text()).toContain(
			'Došlo k chybě: Soubor nastaveni.json má poškozený obsah',
		);
	});
});
