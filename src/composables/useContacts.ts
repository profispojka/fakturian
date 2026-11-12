import { upsertById, upsertManyById } from '~/utils/crud';

import type { Contact } from '~/schemas/customers';

export function useContacts() {
	const { data, loaded, error: loadError, save } = useVaultData();
	const contacts = computed(() => data.value.contacts);

	async function upsert(contact: Contact): Promise<void> {
		data.value.contacts = upsertById(data.value.contacts, contact);
		await save();
	}

	async function upsertMany(items: Contact[]): Promise<void> {
		if (items.length === 0) return;
		data.value.contacts = upsertManyById(data.value.contacts, items);
		await save();
	}

	async function remove(id: string): Promise<void> {
		data.value.contacts = data.value.contacts.filter((contact) => contact.id !== id);
		await save();
	}

	return {
		contacts,
		loaded,
		loadError,
		upsert,
		upsertMany,
		remove,
	};
}
