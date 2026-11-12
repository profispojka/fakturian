import type { Supplier } from '~/schemas/suppliers';

export function useSettings() {
	const { data, save } = useVaultData();
	const supplier = computed(() => data.value.supplier);

	async function setSupplier(s: Supplier): Promise<void> {
		data.value.supplier = s;
		await save();
	}

	return {
		supplier,
		setSupplier,
	};
}
