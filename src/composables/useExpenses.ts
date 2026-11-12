import {
	emptyExpenses,
	expensesFileSchema,
	type BrokenReceived,
	type Expense,
	type ExpensesFile,
} from '~/schemas/expenses';
import { expenseServices } from '~/services/expenses';
import { upsertById, upsertManyById } from '~/utils/crud';
import { errorText } from '~/utils/errors';
import { expenseFromReceived, checkRecipient, sameReceivedDocument } from '~/utils/expenses';

export interface ImportResult {
	expense: Expense;
	warning?: string;
}

export function useExpensesFile() {
	return useVaultFile<ExpensesFile>('vydaje.json', emptyExpenses, expensesFileSchema);
}

export function useExpenses() {
	const { requireVault, vaultPath } = useVault();
	const { data, loaded, error: loadError, save } = useExpensesFile();
	const { supplier } = useSettings();
	const toast = useToast();
	const brokenReceived = useState<BrokenReceived[]>('brokenReceived', () => []);

	const expenses = computed(() => data.value.expenses);

	async function upsert(expense: Expense): Promise<void> {
		data.value.expenses = upsertById(data.value.expenses, expense);
		await save();
	}

	async function upsertMany(items: Expense[]): Promise<void> {
		if (items.length === 0) return;
		data.value.expenses = upsertManyById(data.value.expenses, items);
		await save();
	}

	async function remove(id: string): Promise<void> {
		data.value.expenses = data.value.expenses.filter((expense) => expense.id !== id);
		await save();
	}

	async function discardReceived(vault: string, file: string) {
		try {
			await expenseServices.removeReceived(vault, file);
		} catch (e) {
			toast.add({
				title: 'Odmítnutý doklad se nepodařilo smazat z prijate/',
				description: errorText(e),
				color: 'warning',
			});
		}
	}

	/** `pending` jsou výdaje z téže dávky, které ještě nejsou uložené. */
	async function importDocument(sourcePath: string, pending: readonly Expense[] = []): Promise<ImportResult> {
		const vault = requireVault();

		const imported = await expenseServices.importReceived(vault, sourcePath);
		if (!imported.success) {
			if (imported.file) await discardReceived(vault, imported.file);
			throw new Error(imported.error);
		}
		const doc = imported.doc;

		const duplicate = [...data.value.expenses, ...pending].find((e) => sameReceivedDocument(e, doc));
		if (duplicate) {
			await discardReceived(vault, doc.file);
			throw new Error(`Doklad ${doc.number} už ve výdajích je (${duplicate.supplier || 'bez dodavatele'}).`);
		}

		const check = checkRecipient(supplier.value?.ico ?? '', doc.recipientIco);
		if (!check.ok) {
			await discardReceived(vault, doc.file);
			throw new Error(check.reason);
		}

		const expense = expenseFromReceived(doc);
		if (check.warning === undefined) return { expense };
		return {
			expense,
			warning: check.warning,
		};
	}

	async function documentPath(file: string): Promise<string> {
		const path = await expenseServices.documentPath(requireVault(), file);
		return path;
	}

	async function checkReceived(): Promise<void> {
		brokenReceived.value = [];
		if (!vaultPath.value) return;
		const found = await expenseServices.listBrokenReceived(vaultPath.value);
		brokenReceived.value = found;
	}

	return {
		expenses,
		loaded,
		loadError,
		upsert,
		upsertMany,
		remove,
		importDocument,
		documentPath,
		brokenReceived,
		checkReceived,
	};
}
