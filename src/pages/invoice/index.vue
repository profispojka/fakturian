<script setup lang="ts">
import { FIO_HISTORY_DAYS } from '~/constants/fio';
import { DocumentKind, STATE_LABELS } from '~/constants/invoice';
import { newInvoice } from '~/schemas/invoices';
import { systemServices } from '~/services/system';
import { yearOf, addDays, formatDate, today } from '~/utils/date';
import { errorText } from '~/utils/errors';
import { matchPayments } from '~/utils/fio';
import {
	creditNoteFrom,
	daysOverdue,
	duplicateFrom,
	invoiceState,
	matchesDateFilter,
	matchesStateFilter,
	yearFilter,
} from '~/utils/invoice';
import { formatCountOutOf } from '~/utils/locales';
import { defaultInvoiceMail, reminderMail } from '~/utils/mail';
import { lastPaymentOn, ledgerOf, settlementOf } from '~/utils/payments';

import type { DropdownMenuItem, TableColumn, TableRow } from '@nuxt/ui';
import type { InvoiceState } from '~/constants/invoice';
import type { InvoiceSummary } from '~/schemas/invoices';
import type { ReceivedPayment } from '~/schemas/payments';
import type { SelectOption } from '~/types';
import type { InvoiceDateFilter, InvoiceStateFilter } from '~/utils/invoice';
import type { Ledger, Settlement } from '~/utils/payments';

const toast = useToast();

// Selhání jde do toastu: stavová lišta už nese výsledek, který notifikace jen opakuje.
async function sendSystemNotification(title: string, body: string) {
	try {
		await systemServices.notify(title, body);
	} catch (e) {
		toast.add({
			title: 'Systémové oznámení se nepodařilo poslat',
			description: errorText(e),
			color: 'error',
		});
	}
}

const { list, exportPdf, markSent, askRemove, pendingInvoice, brokenInvoices, load, nextNumber } = useInvoices();
const { refreshUsage } = usePricelist();
const { contacts } = useContacts();
const { payments, record, remove } = usePayments();
const { hasToken, syncError: fioSyncError, refreshHasToken, fetchPayments } = useFio();
const { supplier } = useSettings();
const { emailWithAttachment } = useMail();
const { setItems: setMenuItems } = useMenuStats();

const syncing = ref(false);
const status = usePageStatus();

// Obě akce sahají mimo appku a selhat můžou samy od sebe (chybějící ISDOC v PDF, zamčený cíl); bez
// `try/catch` by z toho byla tichá unhandled rejection.
async function emailInvoice(i: InvoiceSummary) {
	try {
		const inv = await load(i.number);
		const { subject, body } = defaultInvoiceMail(inv.number, i.totalCents);
		await emailWithAttachment(inv.customer.email, subject, body, i.path);
		if (i.sentAt) return;
		await markSent(i.number);
		await refresh();
	} catch (e) {
		status.error('E-mail se nepodařilo připravit', e);
	}
}

async function downloadPdf(i: InvoiceSummary) {
	try {
		const target = await systemServices.pickSavePath(`${i.number}.pdf`, 'PDF', ['pdf']);
		if (target === null) return;
		await exportPdf(i.number, target);
	} catch (e) {
		status.error('PDF se nepodařilo uložit', e);
	}
}

async function revealBroken(path: string) {
	try {
		await systemServices.revealPath(path);
	} catch (e) {
		status.error('Soubor se nepodařilo ukázat ve Finderu', e);
	}
}

function brokenActions(path: string) {
	return [
		{
			label: 'Ukázat ve Finderu',
			icon: 'i-lucide-folder-open',
			color: 'error' as const,
			variant: 'soft' as const,
			'data-testid': 'broken-invoice-reveal',
			onClick: () => revealBroken(path),
		},
	];
}
// Značka žije ve sdíleném stavu, aby ji druhý příchod na výpis nespustil znovu.
const fioAutoSynced = useState<boolean>('fioAutoSynced', () => false);

onMounted(async () => {
	await refreshHasToken();
	if (hasToken.value && !fioAutoSynced.value) {
		fioAutoSynced.value = true;
		await syncFio();
	}
});

async function syncFio() {
	if (syncing.value) return;
	status.clear();
	syncing.value = true;
	try {
		const to = today();
		const from = addDays(to, -FIO_HISTORY_DAYS);
		const movements = await fetchPayments(from, to);
		const all = await list();
		const { matched, unmatched } = matchPayments(movements, all, payments.value);
		await record(matched);
		await refresh();
		fioSyncError.value = '';
		// Nespárované platby se schválně jen počítají, ne vypisují: na účtu chodí i pohyby mimo faktury
		// a Fakturian bankovní výpis nevede.
		const result = `Spárováno plateb: ${matched.length}, nespárováno: ${unmatched.length}.`;
		status.show('info', result);
		await sendSystemNotification('Fio synchronizace', result);
	} catch (e) {
		fioSyncError.value = errorText(e);
		status.error('Fio synchronizace selhala', e);
	} finally {
		syncing.value = false;
	}
}

const todayDate = today();
const selectedNumber = ref('');
const paletteOpen = useState<boolean>('paletteOpen', () => false);

// Výchozí je letošní rok, ne celý archiv: fakturuje se do letoška a starší ročníky se otevírají výjimečně.
const defaultFilters: { state: InvoiceStateFilter; period: InvoiceDateFilter; newestFirst: boolean } = {
	state: 'all',
	period: yearFilter(yearOf(todayDate)),
	newestFirst: true,
};

const {
	items,
	search,
	filters,
	filtered,
	loading,
	error: loadError,
	refresh,
} = useTable(list, {
	key: 'invoices',
	filters: defaultFilters,
	filter: (invoice, f) =>
		(f.state === 'all' || matchesStateFilter(stateOf(invoice), f.state)) &&
		matchesDateFilter(invoice.issueDate, f.period),
	searchFields: ['number', 'customer'],
	compare: (a, b, f) => {
		const order =
			b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number, 'cs', { numeric: true });
		return f.newestFirst ? order : -order;
	},
	onLoaded: setMenuItems,
});

const stateFilters: SelectOption<InvoiceStateFilter>[] = [
	{
		value: 'all',
		label: 'Všechny',
	},
	{
		value: 'paid',
		label: 'Uhrazené',
	},
	{
		value: 'unpaid',
		label: 'Neuhrazené',
	},
	{
		value: 'overdue',
		label: 'Po splatnosti',
	},
];
const selectedInvoice = computed(
	() => filtered.value.find((i) => i.number === selectedNumber.value) ?? filtered.value[0],
);

// `UTable` řádkový dvojklik neemituje; druhý klik dvojkliku ale přijde jako `click` s `detail === 2`.
function selectInvoice(event: Event, row: TableRow<InvoiceSummary>) {
	selectedNumber.value = row.original.number;
	const doubleClick = event instanceof MouseEvent && event.detail === 2;
	if (event.type === 'keydown' || doubleClick) void navigateTo(`/invoice/${row.original.number}`);
}

// Co appka vidí v archivu, plus letošek a příští rok — první faktura příštího ročníku se jinak nemá
// kam zapsat.
const dateFilterYears = computed(() => {
	const years = new Set(items.value.map((i) => yearOf(i.issueDate)));
	years.add(yearOf(todayDate));
	return [...years].toSorted((a, b) => b - a);
});

// Dobropis mění, co dluží jeho faktura, takže se vypořádání počítá nad celým archivem.
const ledger = computed<Ledger>(() => ledgerOf(items.value, payments.value));

function settlementFor(i: InvoiceSummary): Settlement {
	return settlementOf(i, ledger.value);
}

function stateOf(i: InvoiceSummary): InvoiceState {
	return invoiceState(i, settlementFor(i), todayDate);
}

function paymentsTitle(i: InvoiceSummary): string {
	const lastPaidOn = lastPaymentOn(payments.value[i.number] ?? []);
	if (lastPaidOn) return `Platby faktury — poslední ${formatDate(lastPaidOn)}`;
	return 'Zapsat platbu';
}

const paymentsTarget = ref<InvoiceSummary | null>(null);
const savingPayment = ref(false);

async function recordPayment(i: InvoiceSummary, payment: ReceivedPayment) {
	status.clear();
	savingPayment.value = true;
	try {
		await record([
			{
				number: i.number,
				payment,
			},
		]);
		paymentsTarget.value = null;
	} catch (e) {
		status.error(`Platbu faktury ${i.number} se nepodařilo uložit`, e);
	} finally {
		savingPayment.value = false;
	}
}

async function removePayment(i: InvoiceSummary, id: string) {
	status.clear();
	savingPayment.value = true;
	try {
		await remove(i.number, id);
	} catch (e) {
		status.error(`Platbu faktury ${i.number} se nepodařilo smazat`, e);
	} finally {
		savingPayment.value = false;
	}
}

function customerOf(i: InvoiceSummary) {
	return contacts.value.find((x) => x.name === i.customer);
}

function customerLink(i: InvoiceSummary) {
	const c = customerOf(i);
	if (!c) return null;
	return { to: `/customers/${c.id}` };
}

async function makeCreditNote(i: InvoiceSummary) {
	try {
		const original = await load(i.number);
		// Může selhat na vadné šabloně číselné řady — bez hlášky by tlačítko tiše nic neudělalo.
		const number = await nextNumber();
		pendingInvoice.value = creditNoteFrom(original, number);
		void navigateTo('/invoice/new');
	} catch (e) {
		status.error('Dobropis se nepodařilo založit', e);
	}
}

async function duplicate(i: InvoiceSummary) {
	try {
		const original = await load(i.number);
		const number = await nextNumber();
		pendingInvoice.value = duplicateFrom(original, newInvoice(supplier.value, number));
		void navigateTo('/invoice/new');
	} catch (e) {
		status.error('Duplikát se nepodařilo vytvořit', e);
	}
}

/** Odešle ji uživatel, ne appka. */
async function sendReminder(i: InvoiceSummary) {
	try {
		const inv = await load(i.number);
		const { outstandingCents } = settlementFor(i);
		const { subject, body } = reminderMail(inv.number, outstandingCents, daysOverdue(i.dueDate, today()));
		await emailWithAttachment(inv.customer.email, subject, body, i.path);
	} catch (e) {
		status.error('Upomínku se nepodařilo připravit', e);
	}
}

async function deleteInvoice(i: InvoiceSummary) {
	try {
		const deleted = await askRemove(i.number);
		if (!deleted) return;
		await refresh();
		await refreshUsage(items.value);
		status.show('success', `Doklad ${i.number} je v Koši.`);
	} catch (e) {
		status.error('Doklad se nepodařilo smazat', e);
	}
}

const columns: TableColumn<InvoiceSummary>[] = [
	{
		id: 'number',
		header: 'Odběratel / doklad',
		meta: {
			class: {
				th: 'w-auto',
				td: 'min-w-0',
			},
		},
	},
	{
		id: 'state',
		header: 'Stav',
		meta: {
			class: {
				th: 'w-28',
				td: 'w-28',
			},
		},
	},
	{
		id: 'due',
		header: 'Splatnost',
		meta: {
			class: {
				th: 'hidden w-26 wide:table-cell',
				td: 'hidden wide:table-cell',
			},
		},
	},
	{
		id: 'amount',
		header: 'Částka',
		meta: {
			class: {
				th: 'w-30 text-right!',
				td: 'text-right tabular-nums',
			},
		},
	},
	{
		id: 'actions',
		header: '',
		meta: {
			class: {
				th: 'w-13',
				td: 'w-13',
			},
		},
	},
];

function invoiceActions(i: InvoiceSummary): DropdownMenuItem[] {
	return [
		{
			label: 'Stáhnout PDF',
			icon: 'i-lucide-download',
			onSelect: () => void downloadPdf(i),
			'data-testid': `invoice-action-download-${i.number}`,
		},
		{
			label: 'Odeslat e-mailem',
			icon: 'i-lucide-mail',
			onSelect: () => void emailInvoice(i),
			'data-testid': `invoice-action-email-${i.number}`,
		},
		{
			label: 'Zapsat platbu',
			icon: 'i-lucide-banknote',
			onSelect: () => {
				paymentsTarget.value = i;
			},
			'data-testid': `invoice-action-payments-${i.number}`,
		},
		...(stateOf(i) === 'overdue'
			? [
					{
						label: 'Poslat upomínku',
						icon: 'i-lucide-bell',
						onSelect: () => sendReminder(i),
						'data-testid': `invoice-action-reminder-${i.number}`,
					},
				]
			: []),
		// Dobropis jde jen na celou fakturu a jen jednou.
		...(i.documentType === DocumentKind.Invoice && !settlementFor(i).credited
			? [
					{
						label: 'Vystavit dobropis',
						icon: 'i-lucide-receipt-text',
						onSelect: () => makeCreditNote(i),
						'data-testid': `invoice-credit-${i.number}`,
					},
				]
			: []),
		// Duplikát je vždycky faktura; dobropisu by otočil znaménko řádků na zápornou fakturu.
		...(i.documentType === DocumentKind.Invoice
			? [
					{
						label: 'Duplikovat',
						icon: 'i-lucide-copy',
						onSelect: () => duplicate(i),
						'data-testid': `invoice-action-duplicate-${i.number}`,
					},
				]
			: []),
		{
			label: 'Smazat',
			icon: 'i-lucide-trash-2',
			color: 'error',
			onSelect: () => void deleteInvoice(i),
			'data-testid': `invoice-delete-${i.number}`,
		},
	];
}
</script>

<template>
	<div class="flex h-full min-h-0 flex-col bg-pane">
		<header class="flex h-15 shrink-0 items-center gap-3 border-b border-line-soft px-5" data-drag-region>
			<UInput
				v-model="search"
				class="min-w-0 flex-1"
				variant="search"
				icon="i-lucide-search"
				placeholder="Hledat fakturu nebo odběratele…"
				aria-label="Hledat faktury"
				data-testid="invoice-search" />
			<UButton
				variant="ghost"
				color="neutral"
				class="shrink-0 gap-1"
				aria-label="Otevřít paletu příkazů"
				data-testid="invoice-palette"
				@click="paletteOpen = true">
				<UKbd value="meta" />
				<UKbd>P</UKbd>
			</UButton>
		</header>

		<div class="shrink-0 px-5 pt-5 pb-3">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 class="text-stat leading-tight font-semibold tracking-tight text-ink">Faktury</h1>
					<p class="mt-1 text-note text-ink-3">Vystavené doklady a jejich úhrady.</p>
				</div>
				<div class="flex flex-wrap items-center justify-end gap-2" data-testid="invoices-toolbar">
					<URadioGroup
						v-model="filters.state"
						:items="stateFilters"
						orientation="horizontal"
						variant="list"
						indicator="hidden"
						aria-label="Stav faktur"
						data-testid="invoice-state-filter"
						:ui="{
							fieldset: 'h-auto! gap-1 rounded-full border border-line bg-card/70 p-0.5 shadow-sm',
							item: 'h-7.5 px-3 rounded-full! text-ink-2 transition-colors hover:bg-row-hover has-data-[state=checked]:bg-row-on has-data-[state=checked]:text-ink has-data-[state=checked]:shadow-sm',
							label: 'text-note',
						}">
						<template #label="{ item }">
							<span :data-testid="`invoice-state-${item.value}`">{{ item.label }}</span>
						</template>
					</URadioGroup>
					<InvoiceDateFilterPicker v-model="filters.period" :years="dateFilterYears" class="shrink-0" />
					<UButton
						variant="ghost"
						color="neutral"
						icon="i-lucide-arrow-down-up"
						class="text-note! text-ink-3"
						data-testid="invoice-sort"
						@click="filters.newestFirst = !filters.newestFirst">
						{{ filters.newestFirst ? 'Nejnovější' : 'Nejstarší' }}
					</UButton>
				</div>
			</div>
		</div>

		<RecordTable
			:items="items"
			:data="filtered"
			:columns="columns"
			:row-id="(i) => i.number"
			:loading="loading"
			loading-text="Načítám faktury…"
			:error="loadError"
			:empty-hidden="brokenInvoices.length > 0"
			data-testid="invoices-table"
			:ui="{
				base: '[--text-micro:10px] [--text-note:11px] [--text-meta:12px] [--text-ui:13px] [--text-title:14px]',
			}"
			@select="selectInvoice">
			<template #before>
				<VaultAdoptOffer @adopted="refresh" />

				<div v-if="brokenInvoices.length" class="flex flex-col gap-2" data-testid="broken-invoices">
					<UAlert
						v-for="broken in brokenInvoices"
						:key="broken.path"
						color="error"
						variant="soft"
						icon="i-lucide-file-warning"
						orientation="horizontal"
						:title="`Doklad vyžaduje zásah: ${broken.fileName}`"
						:description="broken.reason"
						:actions="brokenActions(broken.path)"
						data-testid="broken-invoice-row" />
				</div>
			</template>
			<template #empty>Zatím žádné faktury.</template>
			<template #number-cell="{ row: { original: i } }">
				<div
					class="flex min-w-0 items-center gap-3"
					:data-testid="`invoice-entry-${i.number}`"
					:data-selected="selectedInvoice?.number === i.number || undefined">
					<span
						class="flex h-8 w-7 shrink-0 items-center justify-center rounded-lg border border-line-soft bg-linear-to-br from-field-hover to-field text-ink-2">
						<UIcon
							:name="
								i.documentType === DocumentKind.CreditNote
									? 'i-lucide-receipt-text'
									: 'i-lucide-file-text'
							"
							class="size-4"
							data-testid="invoice-document-icon" />
					</span>
					<div class="flex min-w-0 flex-col gap-1">
						<span
							data-testid="invoice-customer"
							class="min-w-0 truncate text-ui font-medium text-ink"
							:title="i.customer">
							<UButton
								v-if="customerLink(i)"
								v-bind="customerLink(i)"
								variant="ghost"
								color="neutral"
								class="row-link max-w-full truncate"
								data-testid="invoice-customer-link">
								{{ i.customer }}
							</UButton>
							<template v-else>{{ i.customer }}</template>
						</span>
						<span class="inline-flex items-center gap-1.5 text-micro text-ink-3" data-testid="invoice-row">
							<UButton
								variant="ghost"
								color="neutral"
								class="row-link text-ink-3!"
								data-testid="invoice-open"
								:title="`Vystaveno ${formatDate(i.issueDate)}`"
								:to="`/invoice/${i.number}`">
								{{ i.number }}
							</UButton>
							<UTooltip v-if="i.sentAt" :text="`Odesláno ${i.sentAt}`">
								<UIcon name="i-lucide-send" class="size-3 text-accent" data-testid="invoice-sent" />
							</UTooltip>
						</span>
					</div>
				</div>
			</template>
			<template #due-cell="{ row: { original: i } }">
				{{ formatDate(i.dueDate) }}
			</template>
			<template #amount-cell="{ row: { original: i } }">
				<Money :cents="i.totalCents" />
				<span
					v-if="settlementFor(i).overpaidCents > 0"
					class="block text-micro text-warn"
					data-overpaid="true"
					:data-testid="`invoice-payment-note-${i.number}`">
					přeplatek
					<Money :cents="settlementFor(i).overpaidCents" />
				</span>
				<span
					v-else-if="settlementFor(i).outstandingCents !== 0 && settlementFor(i).paidCents !== 0"
					class="block text-micro text-ink-3"
					:data-testid="`invoice-payment-note-${i.number}`">
					uhrazeno
					<Money :cents="settlementFor(i).paidCents" />
				</span>
			</template>
			<template #state-cell="{ row: { original: i } }">
				<UButton
					:data-testid="`invoice-payments-${i.number}`"
					variant="ghost"
					color="neutral"
					class="state invoice-list-state"
					:class="`state--${stateOf(i)}`"
					:data-state="stateOf(i)"
					:title="paymentsTitle(i)"
					@click="paymentsTarget = i">
					<span class="size-1 shrink-0 rounded-full bg-current" aria-hidden="true" />
					{{ STATE_LABELS[stateOf(i)] }}
				</UButton>
				<span
					v-if="i.dueDate"
					:data-testid="`invoice-due-${i.number}`"
					class="block text-micro text-ink-3 wide:hidden"
					:title="`Splatnost ${formatDate(i.dueDate)}`">
					{{ formatDate(i.dueDate) }}
				</span>
			</template>
			<template #actions-cell="{ row: { original: i } }">
				<!-- Nad ani pod řádkem uprostřed se celé menu nevejde; z boku ho Reka posune svisle do okna. -->
				<UDropdownMenu
					:items="invoiceActions(i)"
					:content="{
						side: 'left',
						align: 'center',
						sideOffset: 8,
						sticky: 'always',
						collisionPadding: 8,
					}">
					<UButton
						variant="ghost"
						color="neutral"
						icon="i-lucide-ellipsis"
						class="size-7 justify-center p-0 text-ink-3"
						:aria-label="`Akce faktury ${i.number}`"
						:data-testid="`invoice-actions-${i.number}`"
						@click="selectedNumber = i.number" />
					<template #content-top>
						<p class="px-3 pt-2 pb-2.5 text-meta text-ink-3">Faktura {{ i.number }}</p>
					</template>
				</UDropdownMenu>
			</template>
		</RecordTable>

		<footer
			class="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-3"
			data-testid="invoices-footer">
			<div class="flex min-w-0 flex-1 items-center gap-3 self-stretch text-note text-ink-3">
				<div class="min-w-0 flex-1 self-end pb-1">
					<p>
						{{
							formatCountOutOf(
								filtered.length + brokenInvoices.length,
								items.length + brokenInvoices.length,
								'document',
							)
						}}
					</p>
					<StatusbarFeedback :status="status.message" />
				</div>
				<UButton
					v-if="hasToken"
					data-testid="action-sync-payments"
					variant="ghost"
					color="neutral"
					icon="i-lucide-refresh-cw"
					aria-label="Synchronizovat platby"
					title="Synchronizovat platby"
					:loading="syncing"
					@click="syncFio" />
			</div>
			<div class="ml-auto flex shrink-0 items-center gap-2">
				<UButton variant="create" icon="i-lucide-plus" to="/invoice/new" data-testid="invoice-add">
					Nová faktura
				</UButton>
			</div>
		</footer>

		<InvoicePaymentsDialog
			v-if="paymentsTarget"
			:invoice="paymentsTarget"
			:payments="payments[paymentsTarget.number] ?? []"
			:settlement="settlementFor(paymentsTarget)"
			:saving="savingPayment"
			@record="recordPayment(paymentsTarget, $event)"
			@remove="removePayment(paymentsTarget, $event)"
			@close="paymentsTarget = null" />
	</div>
</template>

<style>
@reference '~/assets/css/main.css';

.record-list .invoice-list-state {
	@apply gap-1.5 bg-transparent! px-0 text-micro! font-normal;
}
</style>
