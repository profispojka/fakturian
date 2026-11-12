import { emptyPayments, paymentsFileSchema } from '~/schemas/payments';

import type { PaymentsFile } from '~/schemas/payments';
import type { PaymentMatch } from '~/utils/fio';

export function usePaymentsFile() {
	return useVaultFile<PaymentsFile>('platby.json', emptyPayments, paymentsFileSchema);
}

export function usePayments() {
	const { data, save } = usePaymentsFile();
	const payments = computed(() => data.value.payments);

	// Jedním zápisem: týdenní záloha drží stav před posledním zápisem, takže po deseti samostatných by
	// v ní místo stavu před synchronizací zůstal její mezistav.
	async function record(entries: PaymentMatch[]): Promise<void> {
		if (entries.length === 0) return;
		for (const { number, payment } of entries) {
			data.value.payments[number] = [...(data.value.payments[number] ?? []), payment];
		}
		await save();
	}

	async function remove(number: string, id: string): Promise<void> {
		const rest = (data.value.payments[number] ?? []).filter((payment) => payment.id !== id);
		const { [number]: _removed, ...others } = data.value.payments;
		data.value.payments = rest.length
			? {
					...others,
					[number]: rest,
				}
			: others;
		await save();
	}

	// Po smazaném dokladu se číslo vydá znovu a jeho platby by jinak zdědil nový doklad.
	async function forget(numbers: string[]): Promise<void> {
		const stale = new Set(numbers.filter((n) => Object.hasOwn(data.value.payments, n)));
		if (stale.size === 0) return;
		data.value.payments = Object.fromEntries(
			Object.entries(data.value.payments).filter(([number]) => !stale.has(number)),
		);
		await save();
	}

	return {
		payments,
		record,
		remove,
		forget,
	};
}
