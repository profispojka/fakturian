import { supplierReadyForInvoicing } from '~/schemas/suppliers';
import { importServices } from '~/services/import';
import { errorText } from '~/utils/errors';
import { supplierFromAdopted } from '~/utils/import';

import type { AdoptScan, AdoptedSupplier } from '~/schemas/import';

export interface AdoptResult {
	adopted: number;
	skipped: { file: string; reason: string }[];
	addedContacts: number;
	supplierFilled: boolean;
}

export function useAdopt() {
	const { vaultPath } = useVault();
	const { supplier, setSupplier } = useSettings();
	const { adoptFiles } = useImport();

	const scan = useState<AdoptScan | null>('adoptScan', () => null);
	const scanError = useState<string>('adoptScanError', () => '');

	// Nic nemění. Chyba se nepropaguje — je to nabídka navíc, kvůli které nemá výpis faktur zhasnout.
	async function refresh(ico = supplier.value?.ico || null): Promise<AdoptScan | null> {
		scanError.value = '';
		if (!vaultPath.value) {
			scan.value = null;
			return null;
		}
		try {
			scan.value = await importServices.scan(vaultPath.value, ico);
		} catch (e) {
			scan.value = null;
			scanError.value = errorText(e);
		}
		return scan.value;
	}

	/**
	 * Jen do složky, která fakturační údaje nemá — přepsat je podle staré faktury by tiše změnilo
	 * číslo účtu.
	 */
	async function fillSupplier(d: AdoptedSupplier | null): Promise<boolean> {
		if (!d || supplier.value?.ico) return false;
		const draft = supplierFromAdopted(d);
		if (!draft.name.trim() && !draft.ico) return false;
		await setSupplier(draft);
		return supplierReadyForInvoicing(draft);
	}

	async function adopt(
		scanned: AdoptScan,
		ico = supplier.value?.ico || scanned.supplier?.ico || null,
	): Promise<AdoptResult> {
		const { report, addedContacts } = await adoptFiles(
			scanned.candidates.map((c) => c.path),
			ico,
		);
		const supplierFilled = await fillSupplier(scanned.supplier);
		scan.value = null;
		return {
			adopted: report.imported.length,
			skipped: report.skipped,
			addedContacts,
			supplierFilled,
		};
	}

	return {
		scan,
		scanError,
		refresh,
		adopt,
	};
}
