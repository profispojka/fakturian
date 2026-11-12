<script setup lang="ts" generic="T">
import { unrefElement } from '@vueuse/core';

import type { TableColumn, TableRow } from '@nuxt/ui';
import type { ComponentPublicInstance } from 'vue';

// Atributy (`data-testid`, `:ui`) patří tabulce, ne rolovacímu obalu.
defineOptions({ inheritAttrs: false });

const props = defineProps<{
	items: readonly T[];
	data: T[];
	columns: TableColumn<T>[];
	rowId: (row: T) => string;
	loading?: boolean;
	loadingText?: string;
	error?: string;
	emptyHidden?: boolean;
}>();

const emit = defineEmits<{ select: [event: Event, row: TableRow<T>] }>();

const slots = useSlots();
const cellSlots = computed(() => Object.keys(slots).filter((name) => name !== 'before' && name !== 'empty'));

// Stovky řádků by postavily tisíce komponent Reka UI naráz; krátký výpis se vykreslí celý. Výška řádku
// musí sedět s `h-15` u `.record-list` v `app.config.ts`.
const VIRTUAL_FROM = 100;
const ROW_HEIGHT = 60;

const scroller = useTemplateRef<HTMLElement>('scroller');
const table = useTemplateRef<ComponentPublicInstance>('table');

function virtualRows() {
	if (props.data.length <= VIRTUAL_FROM) return false;
	const el = unrefElement(table);
	return {
		estimateSize: ROW_HEIGHT,
		getScrollElement: () => scroller.value,
		scrollMargin: el instanceof HTMLElement ? el.offsetTop : 0,
	};
}
</script>

<template>
	<div ref="scroller" class="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3">
		<slot name="before" />
		<p v-if="loading" class="py-10 text-center text-meta text-ink-3" role="status" data-testid="records-loading">
			{{ loadingText }}
		</p>
		<EmptyState v-else-if="!emptyHidden || error" :items="items" :filtered="data" :error="error">
			<slot name="empty" />
		</EmptyState>
		<UTable
			v-if="!error && data.length"
			v-bind="$attrs"
			ref="table"
			:virtualize="virtualRows()"
			class="record-list"
			:data="data"
			:get-row-id="rowId"
			:columns="columns"
			sticky
			@select="(event: Event, row: TableRow<T>) => emit('select', event, row)">
			<template v-for="name in cellSlots" :key="name" #[name]="slotProps">
				<slot :name="name" v-bind="slotProps" />
			</template>
		</UTable>
	</div>
</template>
