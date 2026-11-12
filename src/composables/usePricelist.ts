import { upsertById } from '~/utils/crud';
import { yearOf } from '~/utils/date';
import { itemUsage, limitOverflows, remainingFor, usageRecords } from '~/utils/pricelist';

import type { Invoice, InvoiceSummary } from '~/schemas/invoices';
import type { PriceItem } from '~/schemas/pricelist';

export function usePricelist() {
	const store = useVaultData();
	const { list, usage: archive } = useInvoices();

	const pricelist = computed(() => store.data.value.pricelist);

	// Vykázané množství se počítá z archivu dokladů, ne z vlastní evidence ve vaultu: ta by uměla utéct
	// dokladům na disku a nikde by to nebylo vidět.
	const records = computed(() => usageRecords(archive.value));

	async function upsert(item: PriceItem): Promise<void> {
		store.data.value.pricelist = upsertById(store.data.value.pricelist, item);
		await store.save();
	}

	async function remove(id: string): Promise<void> {
		store.data.value.pricelist = store.data.value.pricelist.filter((item) => item.id !== id);
		await store.save();
	}

	async function refreshUsage(known?: InvoiceSummary[]) {
		if (known) {
			archive.value = known;
			return;
		}
		archive.value = await list();
	}

	function usage(item: PriceItem, year: number) {
		return itemUsage(item, records.value, year);
	}

	function overflows(inv: Invoice) {
		return limitOverflows(inv, pricelist.value, records.value, yearOf(inv.issueDate));
	}

	// Rok se předává: rozepsaný doklad ho ještě nemusí mít z čeho odvodit.
	function remainingOn(inv: Pick<Invoice, 'number'>, item: PriceItem, year: number): number {
		return remainingFor(item, records.value, year, inv.number);
	}

	return {
		archive,
		pricelist,
		loaded: store.loaded,
		loadError: store.error,
		records,
		refreshUsage,
		upsert,
		remove,
		usage,
		overflows,
		remainingOn,
	};
}
