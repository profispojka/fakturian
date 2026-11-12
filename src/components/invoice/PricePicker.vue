<script setup lang="ts">
import { normalizeSearchText } from '~/utils/crud';
import { czkFromCents } from '~/utils/money';
import { formatAmount, hasLimit } from '~/utils/pricelist';

import type { InvoiceLine } from '~/schemas/invoices';
import type { PriceItem } from '~/schemas/pricelist';

// Vybírá se v modalu, ne v jednořádkové nabídce: z položky je potřeba vidět cenu a jednotku.
const props = defineProps<{
	pricelist: PriceItem[];
	lines: InvoiceLine[];
	remaining: (p: PriceItem) => number;
}>();

const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ add: [PriceItem] }>();

const search = {
	icon: 'i-lucide-search',
	variant: 'outline',
	placeholder: 'Hledat (název, poznámka, jednotka, cena)…',
	'data-testid': 'pricelist-search',
} as const;

const lineCounts = computed(() => {
	const counts = new Map<string, number>();

	for (const l of props.lines) {
		const key = normalizeSearchText(l.description);
		if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return counts;
});

function timesOnInvoice(p: PriceItem): number {
	return lineCounts.value.get(normalizeSearchText(p.name)) ?? 0;
}

function onInvoiceLabel(p: PriceItem): string {
	const count = timesOnInvoice(p);
	if (count > 1) return `${count}× na faktuře`;
	return 'na faktuře';
}

// Jen když se liší od názvu, jinak by se v řádku totéž slovo napsalo dvakrát.
function priceNote(p: PriceItem): string {
	const note = p.note?.trim() ?? '';
	if (note && note !== p.name.trim()) return note;
	return '';
}

// Výběr nechá dialog otevřený, aby šla tatáž položka vložit znovu.
const items = computed(() =>
	props.pricelist.map((item) => ({
		...item,
		formattedPrice: czkFromCents(item.priceCents),
		onSelect: (event: Event) => {
			event.preventDefault();
			emit('add', item);
		},
	})),
);
</script>

<template>
	<UModal v-model:open="open" title="Vložit z ceníku" class="max-w-2xl!">
		<template #body>
			<UListbox
				:items="items"
				label-key="name"
				value-key="id"
				:filter="search"
				:filter-fields="['name', 'note', 'unit', 'formattedPrice']"
				autofocus
				data-testid="pricelist-pick">
				<template #empty>
					<EmptyState :items="pricelist" :filtered="[]">
						Ceník je zatím prázdný — položky se zakládají v Ceníku.
					</EmptyState>
				</template>
				<template #item="{ item }">
					<span class="flex w-full items-center gap-3" data-testid="pricelist-insert">
						<span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-field text-ink-2">
							<UIcon :name="item.icon || 'i-lucide-tag'" class="size-4" />
						</span>
						<span class="flex min-w-0 flex-1 flex-col gap-1" data-testid="pricelist-row">
							<span class="truncate font-medium">{{ item.name }}</span>
							<span v-if="priceNote(item)" class="hint truncate" data-testid="pricelist-note">
								{{ priceNote(item) }}
							</span>
							<span v-if="timesOnInvoice(item) || hasLimit(item)" class="flex flex-wrap gap-2">
								<UBadge v-if="timesOnInvoice(item)" data-testid="pricelist-on-invoice">
									{{ onInvoiceLabel(item) }}
								</UBadge>
								<UBadge v-if="hasLimit(item)">
									zbývá {{ formatAmount(remaining(item), item.unit) }}
								</UBadge>
							</span>
						</span>
						<span class="flex shrink-0 flex-col items-end gap-1">
							<Money :cents="item.priceCents" />
							<span class="hint">/ {{ item.unit }}</span>
						</span>
					</span>
				</template>
			</UListbox>
		</template>
	</UModal>
</template>
