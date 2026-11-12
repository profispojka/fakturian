<script setup lang="ts">
import { useAsyncState } from '@vueuse/core';

import { yearOf, today } from '~/utils/date';
import { errorText } from '~/utils/errors';
import { formatCount, formatCountOutOf } from '~/utils/locales';
import { formatAmount, formatQuantity, hasLimit, itemLabel, pricelistLevelOf } from '~/utils/pricelist';

import type { DropdownMenuItem, TableColumn, TableRow } from '@nuxt/ui';
import type { PriceItem } from '~/schemas/pricelist';
import type { ItemUsage, ItemUsageInvoice } from '~/utils/pricelist';

const { pricelist, remove, usage, refreshUsage, loadError: fileError } = usePricelist();
const paletteOpen = useState<boolean>('paletteOpen', () => false);
const activeId = ref('');
const {
	filtered,
	filters,
	search,
	loading,
	error: loadError,
} = useTable(() => pricelist.value.slice(), {
	key: 'pricelist',
	filters: {
		ascending: true,
	},
	watch: [pricelist],
	searchFields: ['name', 'note', 'unit'],
	compare: (a, b, f) => (f.ascending ? a.name.localeCompare(b.name, 'cs') : b.name.localeCompare(a.name, 'cs')),
});

const activeItem = computed(() => filtered.value.find((p) => p.id === activeId.value) ?? filtered.value[0]);

function selectPrice(event: Event, row: TableRow<PriceItem>) {
	activeId.value = row.original.id;
	const doubleClick = event instanceof MouseEvent && event.detail === 2;
	if (event.type === 'keydown' || doubleClick) void navigateTo(`/pricelist/${row.original.id}`);
}

function priceActions(p: PriceItem): DropdownMenuItem[] {
	return [
		{
			label: 'Vykázání a roční limit',
			icon: 'i-lucide-chart-no-axes-column',
			onSelect: () => {
				selectedId.value = p.id;
			},
			'data-testid': 'price-show-usage',
		},
		{
			label: 'Smazat položku',
			icon: 'i-lucide-trash-2',
			color: 'error',
			onSelect: () => void askDelete(p),
			'data-testid': 'price-delete',
		},
	];
}

const status = usePageStatus();

// Vykázané množství se počítá z archivu, takže ho stránka musí nejdřív přečíst.
const invoicesError = ref('');
useAsyncState(refreshUsage, undefined, {
	onError: (e) => {
		invoicesError.value = errorText(e);
	},
});

async function askDelete(p: PriceItem) {
	const confirmed = await getUserConfirmation(`Opravdu chceš smazat položku „${p.name}“?`, {
		title: 'Smazat položku?',
	});

	if (!confirmed) return;
	status.clear();
	try {
		await remove(p.id);
	} catch (e) {
		status.error('Položku se nepodařilo smazat', e);
	}
}

const selectedId = ref<string | null>(null);
const selected = computed(() => pricelist.value.find((p) => p.id === selectedId.value));

const year = ref(yearOf(today()));
const years = computed(() => {
	const thisYear = yearOf(today());
	return [thisYear, thisYear - 1, thisYear - 2].map((r) => ({
		label: String(r),
		value: r,
	}));
});

const state = computed(() => {
	const item = selected.value;
	if (!item) return null;
	return usage(item, year.value);
});

// Pás i patka stojí pod `v-if="state.limit > 0"`, takže se nulou nedělí a obranné `: 0` by jen
// zakrývalo, kdo poměr čte.
function percent(u: ItemUsage): number {
	return Math.min(100, Math.round((u.used / u.limit) * 100));
}

// Stejný práh jako na Přehledu, ať tatáž položka nesvítí na dvou místech jinak.
function level(u: ItemUsage) {
	return pricelistLevelOf(u.used / u.limit);
}

function progressColor(u: ItemUsage): 'error' | 'warning' | 'primary' {
	if (level(u) === 'danger') return 'error';
	if (level(u) === 'warn') return 'warning';
	return 'primary';
}

const columns: TableColumn<PriceItem>[] = [
	{
		id: 'name',
		header: 'Položka',
	},
	{
		id: 'price',
		header: 'Cena / jednotka',
		meta: {
			class: {
				th: 'w-32 text-right!',
				td: 'text-right!',
			},
		},
	},
	{
		id: 'actions',
		header: '',
		meta: {
			class: {
				th: 'w-10',
				td: 'text-right',
			},
		},
	},
];

const invoiceColumns: TableColumn<ItemUsageInvoice>[] = [
	{
		id: 'invoice',
		header: 'Faktura',
	},
	{
		id: 'quantity',
		header: 'Množství',
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
	<div class="flex h-full min-h-0 flex-col bg-pane">
		<header class="flex h-15 shrink-0 items-center gap-3 border-b border-line-soft px-5" data-drag-region>
			<UInput
				v-model="search"
				class="min-w-0 flex-1"
				variant="search"
				icon="i-lucide-search"
				data-testid="price-search"
				aria-label="Hledat v ceníku"
				placeholder="Hledat položku, poznámku nebo jednotku…" />
			<UButton
				variant="ghost"
				color="neutral"
				class="shrink-0 gap-1"
				aria-label="Otevřít paletu příkazů"
				data-testid="price-palette"
				@click="paletteOpen = true">
				<UKbd value="meta" />
				<UKbd>P</UKbd>
			</UButton>
		</header>
		<div class="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-3">
			<div>
				<h1 class="text-stat leading-tight font-semibold tracking-tight text-ink">Ceník</h1>
				<p class="mt-1 text-note text-ink-3">Položky, ceny a jejich vykázání.</p>
			</div>
			<div class="flex items-center gap-2">
				<UButton
					variant="ghost"
					color="neutral"
					icon="i-lucide-arrow-down-up"
					class="text-note! text-ink-3"
					data-testid="price-sort"
					@click="filters.ascending = !filters.ascending">
					{{ filters.ascending ? 'A–Z' : 'Z–A' }}
				</UButton>
			</div>
		</div>
		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3">
			<p v-if="invoicesError" class="hint text-danger!" data-testid="price-invoices-error">
				Doklady se nepodařilo načíst: {{ invoicesError }}
			</p>
			<p v-if="loading" class="py-10 text-center text-meta text-ink-3" role="status">Načítám ceník…</p>
			<EmptyState v-else :items="pricelist" :filtered="filtered" :error="fileError || loadError">
				Zatím prázdný ceník.
			</EmptyState>
			<div
				v-if="!loading && !fileError && !loadError && filtered.length"
				class="grid grid-cols-1 items-start gap-4"
				:class="selected && 'wide:grid-cols-2'">
				<div class="min-w-0">
					<UTable
						class="record-list"
						:data="filtered"
						data-testid="price-table"
						:get-row-id="(p) => p.id"
						:columns="columns"
						sticky
						@select="selectPrice">
						<template #name-cell="{ row: { original: p } }">
							<div
								class="flex min-w-0 items-center gap-3"
								:data-testid="`price-item-${p.id}`"
								:data-selected="activeItem?.id === p.id || undefined">
								<span
									class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line-soft bg-linear-to-br from-field-hover to-field text-ink-2">
									<UIcon :name="p.icon || 'i-lucide-tag'" class="size-4" data-testid="price-icon" />
								</span>
								<div class="min-w-0">
									<UButton
										variant="ghost"
										color="neutral"
										class="row-link max-w-full truncate text-ink!"
										data-testid="price-edit"
										:to="`/pricelist/${p.id}`">
										{{ p.name }}
									</UButton>
									<div class="mt-1 flex min-w-0 gap-2 text-micro text-ink-3">
										<span
											v-if="p.note?.trim()"
											class="truncate"
											:title="p.note"
											data-testid="price-note">
											{{ p.note }}
										</span>
										<span v-if="hasLimit(p)" class="shrink-0" :data-testid="`price-limit-${p.id}`">
											Max. {{ formatQuantity(p.annualLimit) }} {{ p.unit }} / rok
										</span>
										<span v-else-if="!p.note?.trim()" :data-testid="`price-limit-${p.id}`">
											Bez ročního limitu
										</span>
									</div>
								</div>
							</div>
						</template>
						<template #price-cell="{ row: { original: p } }">
							<Money :cents="p.priceCents" class="text-ink" />
							<p class="mt-1 text-micro text-ink-3">{{ p.unit }}</p>
						</template>
						<template #actions-cell="{ row: { original: p } }">
							<UDropdownMenu
								:items="priceActions(p)"
								:content="{ side: 'left', align: 'center', sideOffset: 8, collisionPadding: 8 }">
								<UButton
									variant="ghost"
									color="neutral"
									icon="i-lucide-ellipsis"
									class="size-7 justify-center p-0 text-ink-3"
									:aria-label="`Akce položky ${p.name}`"
									:data-testid="`price-actions-${p.id}`"
									@click="activeId = p.id" />
								<template #content-top>
									<p class="truncate px-3 pt-2 pb-2.5 text-meta text-ink-3">{{ p.name }}</p>
								</template>
							</UDropdownMenu>
						</template>
					</UTable>
				</div>
				<div
					v-if="state && selected"
					class="order-first flex min-w-0 flex-col gap-5 rounded-card border border-line-soft bg-card/50 p-4 wide:order-last"
					data-testid="price-usage">
					<section>
						<div class="row justify-between">
							<h2
								data-testid="price-usage-title"
								class="flex min-w-0 items-center gap-2 text-meta font-medium text-ink">
								<UIcon
									v-if="selected.icon"
									:name="selected.icon"
									class="size-4 shrink-0"
									data-testid="price-usage-icon" />
								{{ itemLabel(selected) }}
							</h2>
							<div class="flex items-center gap-1">
								<USelect v-model="year" :items="years" data-testid="price-usage-year" />
								<UButton
									variant="ghost"
									color="neutral"
									icon="i-lucide-x"
									aria-label="Zavřít vykázání"
									data-testid="price-close-usage"
									@click="selectedId = null" />
							</div>
						</div>

						<div class="mt-3">
							<div class="mb-3 flex gap-7" data-testid="price-fund">
								<div>
									<span class="text-stat font-semibold text-ink tabular-nums">
										{{ formatAmount(state.used, selected.unit) }}
									</span>
									<span class="mt-1 block text-note text-ink-3">vykázáno za {{ year }}</span>
								</div>
								<div v-if="state.limit > 0">
									<span class="text-stat font-semibold text-ink tabular-nums">
										{{ formatAmount(state.remaining, selected.unit) }}
									</span>
									<span class="mt-1 block text-note text-ink-3">
										zbývá z {{ formatAmount(state.limit, selected.unit) }}
									</span>
								</div>
							</div>
							<UProgress
								v-if="state.limit > 0"
								:model-value="percent(state)"
								:max="100"
								:color="progressColor(state)"
								data-testid="price-bar-fill"
								aria-label="Čerpání ročního limitu" />
							<p v-else class="hint">Bez ročního limitu — vykázání se jen eviduje, nic se nehlídá.</p>
						</div>
					</section>

					<section class="card border-t-0! pt-0!">
						<h2 class="section-title">Na kterých fakturách</h2>
						<EmptyState :items="state.invoices">Za rok {{ year }} zatím nikde vykázaná.</EmptyState>
						<template v-if="state.invoices.length">
							<UTable
								class="ftable"
								:data="state.invoices"
								:get-row-id="(i) => i.invoiceNumber"
								:columns="invoiceColumns"
								sticky>
								<template #invoice-cell="{ row: { original: i } }">
									<span data-testid="price-usage-invoice">{{ i.invoiceNumber }}</span>
								</template>
								<template #quantity-cell="{ row: { original: i } }">
									{{ formatAmount(i.quantity, selected.unit) }}
								</template>
							</UTable>
						</template>
					</section>
				</div>
			</div>
		</div>
		<footer
			class="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-3"
			data-testid="statusbar">
			<div class="min-w-0 flex-1 self-end pb-1 text-note text-ink-3">
				<p>
					{{
						search
							? formatCountOutOf(filtered.length, pricelist.length, 'item')
							: formatCount(pricelist.length, 'item')
					}}
				</p>
				<StatusbarFeedback :status="status.message">
					<span
						v-if="state && selected && state.limit > 0"
						:class="{ 'text-danger': level(state) === 'danger' }">
						{{ itemLabel(selected) }}: zbývá {{ formatAmount(state.remaining, selected.unit) }}
					</span>
				</StatusbarFeedback>
			</div>
			<div class="ml-auto flex shrink-0 items-center gap-2">
				<UButton variant="create" icon="i-lucide-plus" to="/pricelist/new" data-testid="price-add">
					Přidat položku
				</UButton>
			</div>
		</footer>
	</div>
</template>
