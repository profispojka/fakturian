import { dashboardStats } from '~/utils/dashboard';
import { periodOf, today } from '~/utils/date';
import { errorText } from '~/utils/errors';
import { expensesTotalCents } from '~/utils/expenses';
import { czkWholeFromCents } from '~/utils/money';

import type { StatName } from '~/constants/palette';
import type { InvoiceSummary } from '~/schemas/invoices';

// Text odznaku u sekce; prázdný řetězec je „bez odznaku".
export type MenuStats = Record<StatName, string>;

export function useMenuStats() {
	const { vaultPath } = useVault();
	const { list } = useInvoices();
	const { payments } = usePayments();
	const { expenses } = useExpenses();
	const { refreshUsage } = usePricelist();

	const toast = useToast();

	const items = useState<InvoiceSummary[]>('menuInvoices', () => []);
	// Panel kvůli číslu spadnout nesmí, ale mlčet taky ne: prázdný seznam po neúspěšném čtení vypadá
	// jako „nic nedlužíš, všechno je zaplaceno". Po toastu chyba zůstává u Nastavení.
	const error = useState<string>('menuStatsError', () => '');

	async function refresh() {
		if (!vaultPath.value) {
			items.value = [];
			error.value = '';
			return;
		}
		try {
			items.value = await list();
			await refreshUsage(items.value);
			error.value = '';
		} catch (e) {
			error.value = errorText(e);
			toast.add({
				title: 'Doklady se nepodařilo načíst',
				description: error.value,
				color: 'error',
			});
		}
	}

	// Výpis faktur seznam po svém `refresh()` má; číst ho podruhé kvůli panelu by znamenalo projít
	// složku dvakrát za jedno otevření stránky.
	function setItems(invoices: InvoiceSummary[]) {
		items.value = invoices;
		error.value = '';
	}

	const stats = computed<MenuStats>(() => {
		const todayDate = today();
		const d = dashboardStats(items.value, payments.value, todayDate);
		const month = periodOf(todayDate);
		const expensesCents = expensesTotalCents(expenses.value, (date) => periodOf(date) === month);
		return {
			unpaid: d.unpaid.length ? String(d.unpaid.length) : '',
			expensesMonth: expensesCents ? czkWholeFromCents(expensesCents) : '',
		};
	});

	return {
		items,
		stats,
		error,
		refresh,
		setItems,
	};
}
