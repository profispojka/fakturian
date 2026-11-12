import { commands, DOCUMENT_EXTENSION } from '~/bindings';
import { importServices } from '~/services/import';
import { errorText } from '~/utils/errors';
import { newContactsFromImport } from '~/utils/import';
import { czechList, formatCount } from '~/utils/locales';

import type { ImportReport } from '~/schemas/import';
import type { RefusedCustomer } from '~/utils/import';

export interface ImportResultSummary {
	report: ImportReport;
	addedContacts: number;
}

const EMPTY_REPORT: ImportReport = {
	imported: [],
	skipped: [],
	customers: [],
};

// Stejný strop jako `issuesText`: u převzaté složky by jinak jediná bublina nesla stovky jmen.
// Kolik jich bylo celkem, se říct musí — odmítnuté nesmí zmizet potichu.
const REFUSED_LIMIT = 3;

function refusedText(refused: RefusedCustomer[]): string {
	const shown = czechList.format(refused.slice(0, REFUSED_LIMIT).map((r) => `${r.name} (${r.reason})`));
	if (refused.length <= REFUSED_LIMIT) return shown;
	return `${shown} — a další, celkem ${formatCount(refused.length, 'customer')}.`;
}

// Doklady zpracuje hlavní proces; odběratele zakládá tenhle composable, protože kontakty jsou doména
// frontendu (`nastaveni.json`).
export function useImport() {
	const { requireVault } = useVault();
	const { contacts, upsertMany: upsertContacts } = useContacts();
	const { forget: forgetPayments } = usePayments();
	const { forgetArchive } = useInvoices();
	const { supplier } = useSettings();
	const toast = useToast();

	function pickFiles(): Promise<string[]> {
		return commands.pickFiles('Faktury (PDF s vloženým ISDOC)', [DOCUMENT_EXTENSION], true);
	}

	// Odběratelé jedním zápisem, aby v záloze nezůstal mezistav. Doklady už ve `faktury/` leží, takže
	// selhání úklidu import nezruší — opakování by skončilo „už existuje".
	async function finishImport(report: ImportReport): Promise<number> {
		forgetArchive();

		try {
			await forgetPayments(report.imported.map((i) => i.number));
		} catch (e) {
			toast.add({
				title: 'Doklady jsou naimportované, ale staré platby k jejich číslům se nepodařilo smazat',
				description: errorText(e),
				color: 'warning',
			});
		}

		const { contacts: newItems, refused } = newContactsFromImport(contacts.value, report.customers);
		if (refused.length) {
			toast.add({
				title: 'Některé odběratele z dokladů appka nezaložila, chybí jim údaje',
				description: refusedText(refused),
				color: 'warning',
			});
		}
		try {
			await upsertContacts(newItems);
		} catch (e) {
			toast.add({
				title: 'Doklady jsou naimportované, ale nové odběratele se nepodařilo uložit',
				description: errorText(e),
				color: 'warning',
			});
			return 0;
		}
		return newItems.length;
	}

	async function importFiles(paths: string[]): Promise<ImportResultSummary> {
		const vault = requireVault();
		if (paths.length === 0)
			return {
				report: EMPTY_REPORT,
				addedContacts: 0,
			};

		// Bez našeho IČO by mezi vydané faktury propadl i přijatý doklad.
		const report = await importServices.importFiles(vault, paths, supplier.value?.ico ?? null);

		const addedContacts = await finishImport(report);
		return {
			report,
			addedContacts,
		};
	}

	/** Doklady uvnitř datové složky se přesouvají, ne kopírují, proto jiný command než u importu. */
	async function adoptFiles(paths: string[], ourIco: string | null): Promise<ImportResultSummary> {
		const vault = requireVault();
		if (paths.length === 0)
			return {
				report: EMPTY_REPORT,
				addedContacts: 0,
			};

		const report = await importServices.adoptFiles(vault, paths, ourIco);

		const addedContacts = await finishImport(report);
		return {
			report,
			addedContacts,
		};
	}

	return {
		pickFiles,
		importFiles,
		adoptFiles,
	};
}
