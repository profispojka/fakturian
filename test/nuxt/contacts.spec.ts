import { beforeEach, describe, expect, it } from 'vitest';

import { useContacts } from '~/composables/useContacts';
import { useVaultData } from '~/composables/useVaultData';
import { emptySupplier } from '~/schemas/suppliers';

import { backend } from '../setup/backend';
import { saved, savedField, prepareVault, writes } from '../setup/vault';

import type { Contact } from '~/schemas/customers';

/**
 * Testuje se proti **skutečnému** vaultu, takže „uložilo se" znamená „je to ve složce", ne „zavolal
 * se dvojník".
 */
function contact(id: string, name = 'Acme'): Contact {
	return {
		id,
		name,
		ico: '27082440',
		address: {
			street: 'Dlouhá 1',
			city: 'Praha',
			zip: '11000',
		},
	};
}

function savingCustomer(): Contact[] {
	return savedField('nastaveni.json', 'contacts');
}

beforeEach(async () => {
	await prepareVault();
});

describe('useContacts', () => {
	it('zápis odběratele zachová aktuálního dodavatele a ceník', async () => {
		const { upsert } = useNuxtApp().vueApp.runWithContext(useContacts);
		const supplier = {
			...emptySupplier(),
			name: 'Dodavatel',
		};
		const pricelist = [
			{
				id: 'p1',
				name: 'Práce',
				priceCents: 50_000,
				unit: 'hod',
			},
		];
		useNuxtApp().vueApp.runWithContext(useVaultData).data.value = {
			supplier,
			pricelist,
			contacts: [],
		};
		await upsert(contact('k1'));
		expect(saved('nastaveni.json')).toEqual({
			supplier,
			pricelist,
			contacts: [contact('k1')],
		});
	});

	it('chyba zápisu projde službou a nezmění obsah souboru', async () => {
		await useNuxtApp().vueApp.runWithContext(useContacts).upsert(contact('k1'));
		const original = saved('nastaveni.json');
		backend.breaks('write_data_file', 'Plný disk');
		await expect(useNuxtApp().vueApp.runWithContext(useContacts).upsert(contact('k2'))).rejects.toBe('Plný disk');
		expect(saved('nastaveni.json')).toEqual(original);
	});

	it('nenačtenou konfiguraci nelze přepsat přes odběratelskou službu', async () => {
		backend.writeFile('/vault', 'nastaveni.json', { contacts: 'poškozeno' });
		const original = saved('nastaveni.json');
		await expect(useNuxtApp().vueApp.runWithContext(useVaultData).load()).rejects.toThrow(
			new Error(
				'Soubor nastaveni.json má poškozený obsah (contacts: Neplatný vstup: očekáváno pole, obdrženo řetězec).',
			),
		);
		await expect(useNuxtApp().vueApp.runWithContext(useContacts).upsert(contact('k1'))).rejects.toThrow(
			new Error(
				'Data (nastaveni.json) se nepodařilo načíst, takže se neukládají. Zkontroluj datovou složku a zkus to znovu.',
			),
		);
		expect(saved('nastaveni.json')).toEqual(original);
		expect(writes('nastaveni.json')).toBe(0);
	});

	it('zápis rozběhnutý před přepnutím složky dojde do té původní', async () => {
		const contacts = useNuxtApp().vueApp.runWithContext(useContacts);
		await contacts.upsert(contact('k1'));
		await prepareVault({}, '/druhy');
		await contacts.upsert(contact('k2'));
		expect(savedField('nastaveni.json', 'contacts', '/vault')).toEqual([contact('k1'), contact('k2')]);
		expect(backend.folder('/druhy').files.has('nastaveni.json')).toBe(false);
	});
	it('přidá a přepíše odběratele podle id', async () => {
		const { contacts, upsert } = useNuxtApp().vueApp.runWithContext(useContacts);
		await upsert(contact('k1', 'Acme'));
		await upsert(contact('k1', 'Acme s.r.o.'));

		expect(contacts.value).toHaveLength(1);
		expect(contacts.value[0]!.name).toBe('Acme s.r.o.');
		expect(savingCustomer()).toEqual([
			expect.objectContaining({
				id: 'k1',
				name: 'Acme s.r.o.',
			}),
		]);
	});

	it('smaže odběratele a uloží', async () => {
		const { contacts, upsert, remove } = useNuxtApp().vueApp.runWithContext(useContacts);
		await upsert(contact('k1'));
		await upsert(contact('k2'));

		await remove('k1');
		expect(contacts.value.map((c) => c.id)).toEqual(['k2']);
		expect(savingCustomer().map((c) => c.id)).toEqual(['k2']);
	});

	it('selhání zápisu při mazání vrátí chybu volajícímu', async () => {
		const { upsert, remove } = useNuxtApp().vueApp.runWithContext(useContacts);
		await upsert(contact('k1'));
		backend.breaks('write_data_file', 'nastaveni.json je zamčený');

		await expect(remove('k1')).rejects.toBe('nastaveni.json je zamčený');
	});

	it('hromadné vložení zapisuje jen jednou', async () => {
		const { contacts, upsertMany } = useNuxtApp().vueApp.runWithContext(useContacts);
		await upsertMany([contact('k1'), contact('k2'), contact('k3')]);

		expect(contacts.value).toHaveLength(3);
		expect(savingCustomer()).toHaveLength(3);
		expect(writes('nastaveni.json')).toBe(1);
	});

	it('hromadné vložení prázdného seznamu vault nezapisuje', async () => {
		const { upsertMany } = useNuxtApp().vueApp.runWithContext(useContacts);
		await upsertMany([]);

		expect(writes('nastaveni.json')).toBe(0);
	});

	it('hromadné vložení přepíše existující podle id', async () => {
		const { contacts, upsert, upsertMany } = useNuxtApp().vueApp.runWithContext(useContacts);
		await upsert(contact('k1', 'Staré'));
		await upsertMany([contact('k1', 'Nové'), contact('k2')]);

		expect(contacts.value).toHaveLength(2);
		expect(contacts.value[0]!.name).toBe('Nové');
		expect(savingCustomer()[0]?.name).toBe('Nové');
	});
});
