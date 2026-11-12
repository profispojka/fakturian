import { invoiceSchema } from '~/schemas/invoices';
import { invoiceServices } from '~/services/invoices';
import { yearOf, today } from '~/utils/date';
import { errorText } from '~/utils/errors';
import { creditNotesOf, creditTargetOf, deletionQuestion } from '~/utils/invoice';
import { czechList } from '~/utils/locales';
import { continuedStart, nextNumber as nextInSeries, templateOf, validateTemplate } from '~/utils/numbering';
import { limitOverflows, usageRecords } from '~/utils/pricelist';

import type { BrokenInvoice, Invoice, InvoiceSummary } from '~/schemas/invoices';
import type { Supplier } from '~/schemas/suppliers';

export function useInvoices() {
	const { vaultPath, requireVault } = useVault();
	const { payments, forget: forgetPayments } = usePayments();
	const { data } = useVaultData();
	const { supplier } = useSettings();
	const toast = useToast();
	const pendingInvoice = useState<Invoice | null>('pendingInvoice', () => null);
	const brokenInvoices = useState<BrokenInvoice[]>('brokenInvoices', () => []);
	// Přehled čte celou složku faktur, proto ho stránky sdílejí místo vlastního čtení při každém
	// otevření. Zápis přes appku ho zahodí; změnu mimo appku ukáže výpis faktur, který čte vždy znovu.
	const archive = useState<InvoiceSummary[] | null>('invoiceArchive', () => null);
	// Výpis běží v hlavním procesu souběžně se zápisem, takže výpis spuštěný před zápisem může odpovědět až po
	// něm a vrátil by do archivu stav před zápisem.
	const archiveGeneration = useState<number>('invoiceArchiveGeneration', () => 0);
	// Vykázané množství ceníku se počítá z archivu dokladů. Zápis ho na rozdíl od `archive` nezahodí:
	// hlídka limitu ve formuláři má i po uložení ukazovat čerpání, proti kterému se kontrolovalo.
	const usage = useState<InvoiceSummary[]>('invoiceUsage', () => []);
	// Formulář i agent přes MCP ukládají ve stejném okně a čerpání se čte těsně před kontrolou. Dvě
	// souběžná uložení by limit přečerpala obě, takže další počká, až předchozí doběhne.
	const lastSave = useState<Promise<void>>('invoiceLastSave', () => Promise.resolve());

	/**
	 * Prázdná šablona znamená výchozí `{RRRR}{NNNN}`, vadná je chyba: tichý návrat k výchozí by vydal
	 * číslo z jiné řady, než jakou má uživatel v konfiguraci.
	 */
	async function nextNumber(year: number = yearOf(today())): Promise<string> {
		const vault = requireVault();
		const template = templateOf(supplier.value);
		const error = validateTemplate(template);
		if (error) throw new Error(error);

		const used = await invoiceServices.usedNumbers(vault);
		return nextInSeries(used, year, template, supplier.value?.invoiceNumberStart ?? '');
	}

	// Starou šablonu zná jen dodavatel, kterého `next` nahrazuje, takže řada se převádí před uložením.
	async function continueSeries(next: Supplier): Promise<Supplier> {
		const previousTemplate = templateOf(supplier.value);
		const template = templateOf(next);
		if (previousTemplate === template) return next;

		const used = await invoiceServices.usedNumbers(requireVault());
		const year = yearOf(today());
		const start = continuedStart(used, year, previousTemplate, template, next.invoiceNumberStart ?? '');
		if (!start) return next;
		return {
			...next,
			invoiceNumberStart: start,
		};
	}

	// Invariant dokladu drží místo, kudy doklad opouští appku — agent přes MCP formulář obchází. Čerpání
	// ceníku i původní fakturu dobropisu bere z `known`, který volající načetl těsně před kontrolou.
	function validate(invoice: Invoice, isNew: boolean, known: InvoiceSummary[]): void {
		const checked = invoiceSchema({
			...(isNew && { numberTemplate: templateOf(supplier.value) }),
			limitOverflows: limitOverflows(
				invoice,
				data.value.pricelist,
				usageRecords(known),
				yearOf(invoice.issueDate),
			),
			creditTarget: creditTargetOf(invoice, known),
		}).safeParse(invoice);
		if (!checked.success) {
			const problems = checked.error.issues.slice(0, 3).map((issue) => issue.message);
			throw new Error(`Doklad nejde uložit (${czechList.format(problems)}).`);
		}
	}

	async function save(invoice: Invoice, isNew: boolean): Promise<string> {
		const previous = lastSave.value;
		const { promise: done, resolve: finish } = Promise.withResolvers<void>();
		lastSave.value = done;
		try {
			await previous;
			const path = await write(invoice, isNew);
			return path;
		} finally {
			finish();
		}
	}

	async function write(invoice: Invoice, isNew: boolean): Promise<string> {
		// Archiv z otevření stránky nezná fakturu, kterou mezitím vystavil agent přes MCP, a limit by se
		// přečerpal.
		const current = await list();
		validate(invoice, isNew, current);
		const path = await invoiceServices.save(requireVault(), invoice, isNew);
		forgetArchive();
		// Doklad už na disku leží. Kdyby selhání úklidu vyletělo ven, stránka by ho brala za neuložený a
		// další „Uložit" by narazilo na obsazené číslo.
		if (isNew) {
			try {
				await forgetPayments([invoice.number]);
			} catch (e) {
				toast.add({
					title: `Faktura ${invoice.number} je uložená, ale starou platbu k jejímu číslu se nepodařilo smazat`,
					description: errorText(e),
					color: 'warning',
				});
			}
		}
		return path;
	}

	async function preview(invoice: Invoice): Promise<string[]> {
		const pages = await invoiceServices.preview(requireVault(), invoice);
		return pages;
	}

	function load(number: string): Promise<Invoice> {
		return invoiceServices.load(requireVault(), number);
	}

	async function list(): Promise<InvoiceSummary[]> {
		if (!vaultPath.value) {
			brokenInvoices.value = [];
			return [];
		}
		brokenInvoices.value = [];
		const generation = archiveGeneration.value;
		const result = await invoiceServices.list(vaultPath.value);
		brokenInvoices.value = result.broken;
		if (generation === archiveGeneration.value) {
			archive.value = result.items;
			usage.value = result.items;
		}
		return result.items;
	}

	function archived(): Promise<InvoiceSummary[]> {
		if (archive.value) return Promise.resolve(archive.value);
		return list();
	}

	function forgetArchive(): void {
		archive.value = null;
		archiveGeneration.value += 1;
	}

	async function exportPdf(number: string, target: string): Promise<void> {
		await invoiceServices.exportPdf(requireVault(), number, target);
	}

	async function markSent(number: string): Promise<string> {
		const sentAt = await invoiceServices.markSent(requireVault(), number);
		forgetArchive();
		return sentAt;
	}

	// Soubor už je v Koši. Kdyby selhání úklidu vyletělo ven, stránka by hlásila, že doklad smazat nešlo.
	async function remove(number: string): Promise<void> {
		await invoiceServices.remove(requireVault(), number);
		forgetArchive();
		try {
			await forgetPayments([number]);
		} catch (e) {
			toast.add({
				title: `Faktura ${number} je smazaná, ale její platby se nepodařilo odebrat`,
				description: errorText(e),
				color: 'warning',
			});
		}
	}

	// Výpis i detail mažou touhle cestou. Dobropis bez své faktury by vracel peníze z ničeho, proto jde
	// faktura smazat až po něm.
	async function askRemove(number: string): Promise<boolean> {
		const invoices = await archived();
		const summary = invoices.find((i) => i.number === number);
		if (!summary) throw new Error(`Doklad ${number} v evidenci není.`);
		const credits = creditNotesOf(number, invoices);
		if (credits.length) {
			throw new Error(`Faktura ${number} má dobropis ${czechList.format(credits)}. Nejdřív smaž dobropis.`);
		}
		const { title, message } = deletionQuestion(summary, payments.value[number]?.length ?? 0);
		const confirmed = await getUserConfirmation(message, {
			title,
			confirmLabel: 'Smazat',
		});
		if (!confirmed) return false;
		await remove(number);
		return true;
	}

	return {
		pendingInvoice,
		brokenInvoices,
		usage,
		nextNumber,
		continueSeries,
		validate,
		save,
		preview,
		load,
		list,
		archived,
		forgetArchive,
		exportPdf,
		markSent,
		remove,
		askRemove,
	};
}
