<script setup lang="ts">
import { useAsyncState } from '@vueuse/core';

import { DocumentKind } from '~/constants/invoice';
import {
	balance,
	dashboardStats,
	dueSoon,
	periodSeries,
	topCustomers,
	topDebtors,
	vatLimit,
	vatLevelOf,
} from '~/utils/dashboard';
import { yearOf, formatDate, today } from '~/utils/date';
import { daysOverdue } from '~/utils/invoice';
import { czechPercent, formatCount } from '~/utils/locales';
import { czkFromCents } from '~/utils/money';
import { formatAmount, itemLabel, itemsNearLimit, pricelistLevelOf } from '~/utils/pricelist';

import type { TableColumn } from '@nuxt/ui';
import type { InvoiceSummary } from '~/schemas/invoices';
import type { SelectOption } from '~/types';
import type { PeriodRange } from '~/utils/dashboard';

const { archived: listInvoices, brokenInvoices } = useInvoices();
const { payments } = usePayments();
const { expenses, brokenReceived, checkReceived } = useExpenses();
const status = usePageStatus();
const { pricelist, records, refreshUsage } = usePricelist();

// Vykázané množství se počítá z archivu, který stránka čte pro zbytek Přehledu tak jako tak.
const {
	items,
	error: loadError,
	refresh,
} = useTable(listInvoices, {
	key: 'dashboard',
	filters: {},
	onLoaded: refreshUsage,
});
const todayDate = today();
const thisYear = yearOf(todayDate);
const lastYear = thisYear - 1;

// Doklad, který appka nepřečte, v evidenci chybí úplně — proto musí být vidět hned na Přehledu.
const brokenDocuments = computed(() => [
	...brokenInvoices.value.map((b) => ({
		key: b.path,
		label: `faktury/${b.fileName}`,
		reason: b.reason,
	})),
	...brokenReceived.value.map((b) => ({
		key: `prijate/${b.file}`,
		label: `prijate/${b.file}`,
		reason: b.reason,
	})),
]);

useAsyncState(checkReceived, undefined, {
	onError: (e) => {
		status.error('Složku prijate/ se nepodařilo zkontrolovat', e);
	},
});

const s = computed(() => dashboardStats(items.value, payments.value, todayDate));

const range = ref<PeriodRange>('month');
const rangeOptions: SelectOption<PeriodRange>[] = [
	{
		value: 'month',
		label: 'Měsíce',
	},
	{
		value: 'quarter',
		label: 'Kvartály',
	},
	{
		value: 'year',
		label: 'Roky',
	},
];
const series = computed(() =>
	periodSeries(items.value, range.value, todayDate).map((b) => ({
		label: b.label,
		value: b.salesCents,
	})),
);

const balanceYear = ref<number | null>(thisYear);
const balanceOptions: SelectOption<number | null>[] = [
	{
		value: thisYear,
		label: 'Letos',
	},
	{
		value: lastYear,
		label: 'Loni',
	},
	{
		value: null,
		label: 'Vše',
	},
];
const bal = computed(() => balance(items.value, payments.value, balanceYear.value, expenses.value));

const debtors = computed(() => topDebtors(items.value, payments.value));

const soonDue = computed(() => dueSoon(items.value, payments.value, todayDate));

const customers = computed(() => topCustomers(items.value));

const vat = computed(() => vatLimit(items.value, todayDate));

// Dobropis po splatnosti není: peníze posíláme my.
function overdue(i: InvoiceSummary): boolean {
	return i.documentType === DocumentKind.Invoice && daysOverdue(i.dueDate, todayDate) > 0;
}
const vatPercent = computed(() => Math.min(100, Math.round(vat.value.ratio * 100)));

const vatLevel = computed(() => vatLevelOf(vat.value.ratio));

const vatColor = computed(() => {
	if (vatLevel.value === 'danger') return 'error';
	if (vatLevel.value === 'warn') return 'warning';
	return 'neutral';
});

// Loňské překročení platí i letos: od ledna je uživatel plátcem, i když letošní obrat začíná od nuly.
const vatNotice = computed(() => {
	const v = vat.value;
	let crossed = v.limitCents;
	if (v.payerFrom !== undefined) {
		if (v.stage === 'immediate') crossed = v.immediateLimitCents;
		return `Obrat překročil ${czkFromCents(crossed)} — plátcem DPH od ${formatDate(v.payerFrom)}.`;
	}
	const previous = v.previous;
	if (previous.payerFrom === undefined) return '';
	if (previous.stage === 'immediate') crossed = v.immediateLimitCents;
	return `Obrat za rok ${previous.year} překročil ${czkFromCents(crossed)} — plátcem DPH od ${formatDate(previous.payerFrom)}.`;
});

const nearLimit = computed(() => itemsNearLimit(pricelist.value, records.value, thisYear));

const invoiceColumns: TableColumn<InvoiceSummary>[] = [
	{
		id: 'number',
		header: 'Číslo',
	},
	{
		id: 'customer',
		header: 'Odběratel',
	},
	{
		id: 'due',
		header: 'Splatnost',
	},
	{
		id: 'amount',
		header: 'Částka',
		meta: {
			class: {
				th: 'text-right',
				td: 'text-right tabular-nums',
			},
		},
	},
];
</script>

<template>
	<div class="page">
		<h1 class="sr-only">Přehled</h1>

		<div class="page-body selectable">
			<VaultAdoptOffer @adopted="refresh" />

			<p v-if="loadError" class="hint text-danger!" data-testid="overview-load-error">
				Doklady se nepodařilo načíst: {{ loadError }}
			</p>

			<UAlert
				v-if="brokenDocuments.length"
				color="warning"
				variant="subtle"
				icon="i-lucide-file-warning"
				title="Ve složce jsou doklady, se kterými Fakturian nepracuje"
				data-testid="overview-broken-documents">
				<template #description>
					<ul class="flex flex-col gap-1">
						<li v-for="doc in brokenDocuments" :key="doc.key" data-testid="overview-broken-document">
							<span class="font-medium">{{ doc.label }}</span>
							— {{ doc.reason }}
						</li>
					</ul>
				</template>
			</UAlert>

			<section class="min-w-0">
				<!-- Podklad drží tenhle `div`, ne sekce — ta má nad sebou odsazení. -->
				<div class="-ml-5 grid min-w-0 grid-cols-1 items-stretch gap-px bg-line-soft wide:grid-cols-3">
					<div class="col-span-1 flex min-w-0 flex-col gap-3 bg-pane px-5 pb-5 wide:col-span-2 wide:pb-0">
						<SectionHeader title="Fakturace za období" class="mb-3 flex-wrap">
							<URadioGroup
								v-model="range"
								:items="rangeOptions"
								orientation="horizontal"
								variant="list"
								indicator="hidden"
								aria-label="Období fakturace"
								data-testid="sales-period">
								<template #label="{ item }">
									<span :data-testid="`sales-period-${item.value}`">{{ item.label }}</span>
								</template>
							</URadioGroup>
						</SectionHeader>
						<DashboardRevenueChart :bars="series" />
					</div>

					<div class="min-w-0 bg-pane px-5 pt-5 wide:pt-0">
						<SectionHeader title="Bilance" class="mb-3 flex-wrap">
							<URadioGroup
								v-model="balanceYear"
								:items="balanceOptions"
								orientation="horizontal"
								variant="list"
								indicator="hidden"
								aria-label="Rok bilance"
								data-testid="balance-period">
								<template #label="{ item }">
									<span :data-testid="`balance-period-${item.value ?? 'all'}`">{{ item.label }}</span>
								</template>
							</URadioGroup>
						</SectionHeader>
						<dl class="figures--compact pt-3" data-testid="overview-balance">
							<div>
								<dt class="text-ink">Prodej</dt>
								<dd class="font-medium text-ink"><Money :cents="bal.totalCents" /></dd>
							</div>
							<div class="pt-2">
								<dt class="pl-3 text-ink-2">z toho uhrazeno</dt>
								<dd class="text-ink-2"><Money :cents="bal.paidCents" /></dd>
							</div>
							<div class="pt-2">
								<dt class="pl-3 text-ink-2">z toho neuhrazeno</dt>
								<dd class="text-ink-2"><Money :cents="bal.unpaidCents" /></dd>
							</div>
							<div class="mt-4">
								<dt class="text-ink">Nákup</dt>
								<dd class="font-medium text-ink"><Money :cents="bal.purchaseCents" /></dd>
							</div>
						</dl>
					</div>
				</div>
			</section>

			<section class="min-w-0">
				<div class="-ml-5 grid min-w-0 grid-cols-1 gap-px bg-line-soft wide:grid-cols-3">
					<div class="min-w-0 bg-pane px-5 pb-1" data-testid="overview-debtors">
						<h2 class="section-title">Top dlužníci</h2>
						<EmptyState :items="debtors" class="mt-1 text-meta!">Žádné dluhy</EmptyState>
						<ul v-if="debtors.length" class="rank-list">
							<li v-for="(d, idx) in debtors" :key="d.customer">
								<span class="w-4 shrink-0 text-right text-meta text-ink-3 tabular-nums">
									{{ idx + 1 }}
								</span>
								<span class="flex-1 truncate text-ink">{{ d.customer }}</span>
								<Money :cents="d.amountCents" class="text-danger" />
							</li>
						</ul>
					</div>

					<div class="min-w-0 bg-pane px-5 pb-1" data-testid="overview-customers">
						<h2 class="section-title">Top odběratelé</h2>
						<EmptyState :items="customers" class="mt-1 text-meta!">Zatím žádné doklady</EmptyState>
						<ul v-if="customers.length" class="rank-list">
							<li v-for="(c, idx) in customers" :key="c.customer">
								<span class="w-4 shrink-0 text-right text-meta text-ink-3 tabular-nums">
									{{ idx + 1 }}
								</span>
								<span class="flex-1 truncate text-ink">{{ c.customer }}</span>
								<Money :cents="c.amountCents" class="text-ink-2" />
							</li>
						</ul>
					</div>

					<div class="min-w-0 bg-pane px-5 pb-1" data-testid="overview-vat">
						<h2 class="section-title">Limit plátce DPH</h2>
						<UProgress
							:model-value="vatPercent"
							:max="100"
							:color="vatColor"
							:data-level="vatLevel"
							data-testid="overview-vat-fill"
							aria-label="Čerpání limitu DPH" />
						<div class="mt-2 flex items-baseline justify-between gap-2">
							<span class="text-title font-semibold text-ink tabular-nums">
								{{ czechPercent.format(vatPercent / 100) }}
							</span>
							<span class="hint">
								limit
								<Money :cents="vat.limitCents" />
							</span>
						</div>
						<p class="mt-2 text-meta leading-prose text-ink-2 [&_strong]:font-medium [&_strong]:text-ink">
							Obrat za rok {{ vat.year }}:
							<strong><Money :cents="vat.turnoverCents" /></strong>
						</p>
						<p
							v-if="vatNotice"
							class="mt-2 text-meta leading-prose text-ink"
							data-testid="overview-vat-notice">
							{{ vatNotice }}
						</p>
					</div>
				</div>
			</section>

			<section class="min-w-0">
				<div class="-ml-5 grid min-w-0 grid-cols-1 gap-px bg-line-soft wide:grid-cols-2">
					<div class="min-w-0 bg-pane px-5 pb-1" data-testid="overview-soon-due">
						<h2 class="section-title">Blíží se splatnost</h2>
						<EmptyState :items="soonDue" class="mt-1 text-meta!">V nejbližších dnech nic</EmptyState>
						<ul v-if="soonDue.length" class="rank-list">
							<li v-for="i in soonDue" :key="i.number">
								<UButton
									variant="ghost"
									color="neutral"
									class="row-link min-w-0 flex-1 truncate text-left text-ink"
									:to="`/invoice/${i.number}`"
									data-testid="overview-soon-due-open">
									{{ i.customer }}
								</UButton>
								<span class="whitespace-nowrap text-ink-2 tabular-nums">
									{{ formatDate(i.dueDate) }} ·
									<Money :cents="i.totalCents" />
								</span>
							</li>
						</ul>
					</div>

					<div class="min-w-0 bg-pane px-5 pb-1" data-testid="overview-near-limit">
						<h2 class="section-title">Ceník blízko limitu</h2>
						<EmptyState :items="nearLimit" class="mt-1 text-meta!">Nic se neblíží limitu</EmptyState>
						<ul v-if="nearLimit.length" class="rank-list">
							<li v-for="n in nearLimit" :key="n.item.id">
								<UIcon
									v-if="n.item.icon"
									:name="n.item.icon"
									class="size-4 shrink-0 text-ink-3"
									data-testid="near-limit-icon" />
								<span class="flex-1 truncate text-ink">{{ itemLabel(n.item) }}</span>
								<span
									class="whitespace-nowrap text-ink-2 tabular-nums"
									:class="{
										'text-danger': pricelistLevelOf(n.ratio) === 'danger',
										'text-warn': pricelistLevelOf(n.ratio) === 'warn',
									}">
									{{ formatAmount(n.usage.used, n.item.unit) }} /
									{{ formatAmount(n.usage.limit, n.item.unit) }}
								</span>
							</li>
						</ul>
					</div>
				</div>
			</section>

			<section data-testid="overview-unpaid">
				<SectionHeader title="Nezaplacené" class="mb-2">
					<UBadge
						v-if="s.unpaid.length > 0"
						:color="s.overdueCount > 0 ? 'error' : 'neutral'"
						:data-overdue="s.overdueCount > 0 || undefined"
						data-testid="unpaid-count">
						{{ formatCount(s.unpaid.length, 'document') }}
					</UBadge>
				</SectionHeader>
				<EmptyState :items="s.unpaid" :error="loadError" class="mt-1 text-meta!">Vše zaplaceno</EmptyState>
				<UTable
					v-if="s.unpaid.length"
					class="ftable"
					:ui="{ base: '[--text-ui:13px]', td: 'text-ui' }"
					:data="s.unpaid"
					:get-row-id="(i) => i.number"
					:columns="invoiceColumns"
					sticky>
					<template #number-cell="{ row: { original: i } }">
						<UButton
							variant="ghost"
							color="neutral"
							class="row-link"
							:to="`/invoice/${i.number}`"
							data-testid="overview-unpaid-open">
							{{ i.number }}
						</UButton>
					</template>
					<template #customer-cell="{ row: { original: i } }">
						{{ i.customer }}
					</template>
					<template #due-cell="{ row: { original: i } }">
						<span
							:data-overdue="overdue(i) || undefined"
							class="data-overdue:text-danger"
							data-testid="overview-unpaid-due">
							{{ formatDate(i.dueDate) }}
						</span>
					</template>
					<template #amount-cell="{ row: { original: i } }">
						<Money :cents="i.totalCents" />
					</template>
				</UTable>
			</section>
		</div>
	</div>
</template>

<style>
@reference '~/assets/css/main.css';

.rank-list > li {
	@apply flex h-(--row) items-center gap-3 border-b border-line-soft;
}
.rank-list > li:last-child {
	@apply border-b-0;
}
</style>
