import { usePaymentsFile } from '~/composables/usePayments';
import { vaultDataSchema, emptyVaultData, type VaultData } from '~/schemas/vault-data';
import { errorText } from '~/utils/errors';

// `load()` načte všechny domény vaultu, ne jen konfiguraci — volající nemá důvod vědět, na kolik
// souborů jsou data rozdělená.
export function useVaultData() {
	const config = useVaultFile<VaultData>('nastaveni.json', emptyVaultData, vaultDataSchema);
	const payments = usePaymentsFile();
	const expenses = useExpensesFile();
	const files = [config, payments, expenses];

	/** `allSettled`, protože jeden poškozený soubor nesmí shodit načtení ostatních. */
	async function load() {
		const results = await Promise.allSettled(files.map((file) => file.load()));

		const errors = results.filter((v) => v.status === 'rejected').map((v) => errorText(v.reason));
		if (errors.length) throw new Error([...new Set(errors)].join('\n'));
	}

	return {
		data: config.data,
		loaded: config.loaded,
		error: config.error,
		files,
		load,
		save: config.save,
	};
}
