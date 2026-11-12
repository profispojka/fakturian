import { newInvoice } from '~/schemas/invoices';
import { MCP_TOOLS, isMcpToolName } from '~/schemas/mcp';
import { normalizeSearchText } from '~/utils/crud';
import { turnoverAndMargin, topDebtors, vatLimit } from '~/utils/dashboard';
import { yearOf, today } from '~/utils/date';
import { errorText, issuesText } from '~/utils/errors';
import { contactToParty, invoiceTotalCents } from '~/utils/invoice';
import { czechList } from '~/utils/locales';
import { czkFromCents } from '~/utils/money';
import { lastPaymentOn, ledgerOf, settlementOf } from '~/utils/payments';
import { formatAmount, itemForLine, matchingItemForLine } from '~/utils/pricelist';

import type { Invoice, InvoiceSummary } from '~/schemas/invoices';
import type { McpToolName } from '~/schemas/mcp';
import type { Ledger } from '~/utils/payments';
import type { Zod } from '~/utils/zod';

type ToolArgs = { [K in McpToolName]: Zod.infer<(typeof MCP_TOOLS)[K]['args']> };

const LOADING = 'Data se ještě načítají. Zkus to za chvíli.';

const CANCELLED = 'Agent volání zrušil, faktura se nevystavila.';

function toolResult(text: string, isError: boolean) {
	return {
		content: [
			{
				type: 'text',
				text,
			},
		],
		isError,
	};
}

// Potvrzuje se celý obsah: text řádku nebo poznámky od agenta skončí na ostrém dokladu.
function confirmationQuestion(draft: Invoice): string {
	return [
		`Agent chce vystavit fakturu pro „${draft.customer.name}" (IČO ${draft.customer.ico}) na ${czkFromCents(invoiceTotalCents(draft))}:`,
		...draft.lines.map(
			(l) => `• ${l.description} — ${formatAmount(l.quantity, l.unit)} × ${czkFromCents(l.unitPriceCents)}`,
		),
		// Poznámka smí mít víc řádků; v otázce jde na jeden, aby nepodvrhla řádek dokladu.
		...(draft.note ? [`Poznámka: ${draft.note.replaceAll('\n', ' ⏎ ')}`] : []),
		'Doklad dostane číslo z řady; zrušit ho jde jen smazáním v appce.',
	].join('\n');
}

export function useMcpTools() {
	const { vaultPath, ready } = useVault();
	const { list, brokenInvoices, load, validate, save, nextNumber } = useInvoices();
	const { contacts } = useContacts();
	const { payments } = usePayments();
	const { expenses } = useExpenses();
	const { pricelist, usage, refreshUsage } = usePricelist();
	const { supplier } = useSettings();
	const toast = useToast();
	// Nástroj nad nenačteným souborem by odpověděl prázdnem a agent by to vzal za skutečný stav.
	const { files: vaultFiles } = useVaultData();

	// Dobropis fakturu vypořádá i bez platby, proto `paid` říká jen, jestli odběratel zaplatil; dobropis
	// hlásí `credited`.
	function paymentState(invoice: InvoiceSummary, ledger: Ledger) {
		const settlement = settlementOf(invoice, ledger);
		return {
			paid: settlement.credited ? settlement.paidCents === invoice.totalCents : settlement.outstandingCents === 0,
			credited: settlement.credited,
			paidAmount: settlement.paidCents / 100,
			paidDate: lastPaymentOn(payments.value[invoice.number] ?? []),
		};
	}

	// Nečitelný doklad by ve výsledku chyběl a agent by neúplné součty vzal za pravdu.
	async function readArchive() {
		const items = await list();
		if (brokenInvoices.value.length) {
			const files = brokenInvoices.value.map((b) => b.fileName).join(', ');
			throw new Error(
				`Ve složce jsou faktury, které nejde přečíst (${files}); bez nich by výsledek nebyl úplný. Přehled v appce ukazuje, co s nimi je.`,
			);
		}
		return items;
	}

	// Dvě vystavení naráz by si sáhla na totéž číslo z řady a otevřela dvě otázky přes sebe, takže
	// další čeká, až předchozí doběhne.
	let invoicing: Promise<void> = Promise.resolve();

	async function issueInvoiceInTurn(args: ToolArgs['create_invoice'], signal: AbortSignal) {
		const previous = invoicing;
		const { promise, resolve } = Promise.withResolvers<void>();
		invoicing = promise;
		await previous;
		try {
			if (signal.aborted) throw new Error(CANCELLED);
			const created = await issueInvoice(args, signal);
			return created;
		} finally {
			resolve();
		}
	}

	async function issueInvoice(args: ToolArgs['create_invoice'], signal: AbortSignal) {
		const { customerName, note, lines } = args;
		const name = customerName.trim();
		const matches = contacts.value.filter((c) => normalizeSearchText(c.name) === normalizeSearchText(name));
		const [contact] = matches;
		if (!contact) throw new Error(`Odběratel „${name}" není v seznamu.`);
		// Normalizace spojí třeba „Novák" a „Novak"; vybrat mezi nimi za uživatele by bylo hádání.
		if (matches.length > 1) {
			const names = czechList.format(matches.map((c) => `„${c.name}"`));
			throw new Error(`Jménu „${name}" odpovídá víc odběratelů (${names}); rozliš je v appce jménem.`);
		}
		const missingItem = lines.find(
			(row) => row.itemId !== undefined && !pricelist.value.some((p) => p.id === row.itemId),
		);
		if (missingItem) throw new Error(`Položka ceníku ${missingItem.itemId} neexistuje.`);

		const build = (number: string): Invoice => ({
			...newInvoice(supplier.value, number),
			customer: contactToParty(contact),
			note: note ?? '',
			lines: lines.map((row) => {
				const line = {
					id: crypto.randomUUID(),
					...row,
				};
				const item = itemForLine(line, pricelist.value) ?? matchingItemForLine(line, pricelist.value);
				return {
					...line,
					itemId: item?.id,
				};
			}),
		});

		// Nejdřív kontrola, pak otázka: uživatel nemá potvrzovat doklad, který by se stejně neuložil.
		// Agent nesmí obejít roční limit, takže se čerpání čte z archivu těsně před kontrolou.
		const archived = await readArchive();
		await refreshUsage(archived);
		const draftNumber = await nextNumber();
		const draft = build(draftNumber);
		validate(draft, true, archived);
		const confirmed = await getUserConfirmation(confirmationQuestion(draft), {
			title: 'Vystavit fakturu od agenta?',
			confirmLabel: 'Vystavit',
			signal,
		});
		// Otázku zavřelo zrušení, ne uživatel; bez hlášky by nevěděl, proč zmizela.
		if (signal.aborted) {
			toast.add({
				title: CANCELLED,
				color: 'warning',
			});
			throw new Error(CANCELLED);
		}
		if (!confirmed) throw new Error('Vystavení faktury uživatel v appce odmítl.');

		// Číslo i čerpání až po odpovědi: během otázky mohl vzniknout jiný doklad, vzal by si totéž
		// číslo a limit by se hlídal proti stavu před ním; `save()` doklad zkontroluje znovu.
		try {
			const current = await readArchive();
			await refreshUsage(current);
			const number = await nextNumber();
			const inv = build(number);
			const path = await save(inv, true);
			// Odpověď agentovi už neodejde, takže o vystavené faktuře ví jen uživatel.
			if (signal.aborted) {
				toast.add({
					title: `Faktura ${inv.number} je vystavená, ale agent na odpověď už nečekal.`,
					color: 'warning',
				});
			}
			// Vykázané množství nese doklad sám, takže po uložení není co dopisovat; další nástroj si
			// archiv přečte znovu.
			return {
				number: inv.number,
				year: yearOf(inv.issueDate),
				path,
			};
		} catch (e) {
			// Zrušenému požadavku se neodpovídá, takže chybu po potvrzení by jinak nikdo neviděl.
			if (signal.aborted) {
				toast.add({
					title: 'Fakturu od agenta se nepodařilo vystavit',
					description: errorText(e),
					color: 'error',
				});
			}
			throw e;
		}
	}

	const tools: { [K in McpToolName]: (args: ToolArgs[K], signal: AbortSignal) => unknown } = {
		list_invoices: async () => {
			const items = await readArchive();
			const ledger = ledgerOf(items, payments.value);
			return items.map((i) => ({
				number: i.number,
				originalInvoice: i.originalInvoice || undefined,
				customer: i.customer,
				issueDate: i.issueDate,
				dueDate: i.dueDate,
				total: i.totalCents / 100,
				...paymentState(i, ledger),
			}));
		},

		get_invoice: async ({ number }) => {
			const invoices = await readArchive();
			const found = invoices.find((i) => i.number === number);
			if (!found) throw new Error(`Faktura ${number} neexistuje.`);
			const inv = await load(number);
			return {
				...inv,
				...paymentState(found, ledgerOf(invoices, payments.value)),
				total: found.totalCents / 100,
			};
		},

		list_contacts: () =>
			contacts.value.map((c) => ({
				name: c.name,
				ico: c.ico,
				email: c.email,
				city: c.address.city,
				note: c.note,
			})),

		list_expenses: () =>
			expenses.value.map((e) => ({
				supplier: e.supplier,
				description: e.description,
				amount: e.amountCents / 100,
				date: e.date,
			})),

		pricelist_status: async ({ year }) => {
			const activeYear = year ?? yearOf(today());
			const archived = await readArchive();
			await refreshUsage(archived);
			// Všechny položky, ne jen hlídané — jinak by odpověď vynechala většinu ceníku.
			return {
				year: activeYear,
				items: pricelist.value.map((p) => {
					const u = usage(p, activeYear);
					return {
						name: p.name,
						note: p.note,
						unit: p.unit,
						price: p.priceCents / 100,
						limit: u.limit,
						used: u.used,
						remaining: u.remaining,
						invoices: u.invoices,
					};
				}),
			};
		},

		summary: async ({ year }) => {
			const todayDate = today();
			const activeYear = year ?? yearOf(todayDate);
			const items = await readArchive();
			const turnoverMargin = turnoverAndMargin(items, expenses.value, activeYear);
			const vat = vatLimit(items, todayDate);
			return {
				year: activeYear,
				turnover: turnoverMargin.turnoverCents / 100,
				costs: turnoverMargin.costsCents / 100,
				margin: turnoverMargin.marginCents / 100,
				debtors: topDebtors(items, payments.value, 10).map((d) => ({
					customer: d.customer,
					amount: d.amountCents / 100,
				})),
				vatLimit: {
					turnover: vat.turnoverCents / 100,
					limit: vat.limitCents / 100,
					immediateLimit: vat.immediateLimitCents / 100,
					ratio: Math.round(vat.ratio * 100) / 100,
					stage: vat.stage,
					payerFrom: vat.payerFrom,
					year: vat.year,
					from: vat.from,
					to: vat.to,
					previousYear: {
						year: vat.previous.year,
						turnover: vat.previous.turnoverCents / 100,
						stage: vat.previous.stage,
						payerFrom: vat.previous.payerFrom,
					},
				},
			};
		},

		create_invoice: issueInvoiceInTurn,
	};

	// `tools[name](args.data)` přímo v `callTool` TypeScript odmítne: bez generika nespáruje jméno
	// nástroje s typem jeho argumentů.
	function runTool<K extends McpToolName>(name: K, args: ToolArgs[K], signal: AbortSignal) {
		return tools[name](args, signal);
	}

	// Chyba nástroje jde agentovi jako `isError`, ne jako chyba protokolu: má ji přečíst a říct, co dělat.
	async function callTool(name: string, raw: unknown, signal: AbortSignal) {
		if (!isMcpToolName(name)) return toolResult(`Neznámý nástroj: ${name}`, true);
		// Vynechané argumenty znamenají prázdný objekt; `null` je chyba agenta a validace ho odmítne.
		const args = MCP_TOOLS[name].args.safeParse(raw === undefined ? {} : raw);
		if (!args.success) return toolResult(`Neplatné argumenty (${issuesText(args.error)}).`, true);
		// Před `init()` je složka neznámá, ne nezvolená.
		if (!vaultPath.value)
			return toolResult(ready.value ? 'Fakturian nemá zvolenou datovou složku.' : LOADING, true);
		const failed = vaultFiles.find((file) => file.error.value);
		if (failed) return toolResult(`Data ve složce se nepodařilo načíst — ${failed.error.value}`, true);
		if (!vaultFiles.every((file) => file.loaded.value)) return toolResult(LOADING, true);
		try {
			const value = await runTool(name, args.data, signal);
			return toolResult(JSON.stringify(value, null, 2), false);
		} catch (e) {
			return toolResult(errorText(e), true);
		}
	}

	return {
		callTool,
	};
}
