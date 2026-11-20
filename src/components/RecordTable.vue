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
	error?: string;
	emptyHidden?: boolean;
}>();

const emit = defineEmits<{ select: [event: Event, row: TableRow<T>] }>();

const slots = useSlots();
const cellSlots = computed(() => Object.keys(slots).filter((name) => !['before', 'empty', 'loading'].includes(name)));

// Stovky řádků by postavily tisíce komponent Reka UI naráz; krátký výpis se vykreslí celý. Výška řádku
// musí sedět s `h-15` u `.record-list` v `app.config.ts`.
const VIRTUAL_FROM = 100;
const ROW_HEIGHT = 60;

const scroller = useTemplateRef<HTMLElement>('scroller');
const table = useTemplateRef<ComponentPublicInstance>('table');

const virtual = computed(() => props.data.length > VIRTUAL_FROM);

function virtualRows() {
	if (!virtual.value) return false;
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
		<EmptyState v-if="error" :error="error" />
		<!-- `UTable` čte `virtualize` jen při založení; klíč ji při změně režimu založí znovu. -->
		<UTable
			v-else-if="data.length || loading || !emptyHidden"
			:key="virtual ? 'virtual' : 'full'"
			v-bind="$attrs"
			ref="table"
			:virtualize="virtualRows()"
			class="record-list"
			:data="data"
			:get-row-id="rowId"
			:columns="columns"
			:loading="loading"
			sticky
			@select="(event: Event, row: TableRow<T>) => emit('select', event, row)">
			<template #loading>
				<span role="status" data-testid="records-loading"><slot name="loading" /></span>
			</template>
			<template #empty>
				<EmptyState :items="items" :filtered="data">
					<slot name="empty" />
				</EmptyState>
			</template>
			<template v-for="name in cellSlots" :key="name" #[name]="slotProps">
				<slot :name="name" v-bind="slotProps" />
			</template>
		</UTable>
	</div>
</template>
