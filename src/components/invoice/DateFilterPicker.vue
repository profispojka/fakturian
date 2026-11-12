<script setup lang="ts">
import { whenever } from '@vueuse/core';

import { dateIn, monthName, toCalendarDate } from '~/utils/date';

import type { InvoiceDateFilter } from '~/utils/invoice';

const props = defineProps<{
	years: number[];
}>();

const model = defineModel<InvoiceDateFilter>({ required: true });
const open = ref(false);
const displayedYear = ref(model.value.year);

const label = computed(() =>
	model.value.month === 'all'
		? `Celý rok ${model.value.year}`
		: `${monthName(model.value.month)} ${model.value.year}`,
);

// Kalendář při každé nové hodnotě skočí na její rok, takže výběr nesmí vznikat při každém
// vykreslení — šipka roku by se jinak hned vrátila.
const selected = computed(() =>
	model.value.month === 'all' ? undefined : toCalendarDate(dateIn(model.value.year, model.value.month, 1)),
);

whenever(open, () => {
	displayedYear.value = model.value.year;
});

// Znovu kliknutý vybraný měsíc kalendář odznačí; to je pak celý rok, který zrovna ukazuje.
function select(month: { year: number; month: number } | undefined) {
	model.value = month
		? {
				year: month.year,
				month: month.month,
			}
		: {
				year: displayedYear.value,
				month: 'all',
			};
	open.value = false;
}
</script>

<template>
	<UPopover
		v-model:open="open"
		:content="{ align: 'end', sideOffset: 8 }"
		:ui="{ content: 'rounded-3xl border border-line bg-card/85 ring-0 backdrop-blur-2xl' }">
		<UButton
			variant="ghost"
			color="neutral"
			trailing-icon="i-lucide-chevron-down"
			class="h-9 gap-3 rounded-full border border-line bg-card/70 px-4 text-meta! shadow-sm"
			aria-label="Vybrat rok a měsíc"
			data-testid="date-period">
			<span class="block first-letter:uppercase">{{ label }}</span>
		</UButton>
		<template #content>
			<div class="w-72 p-3" data-testid="date-picker">
				<UCalendar
					type="month"
					:range="false"
					:multiple="false"
					color="neutral"
					variant="soft"
					:model-value="selected"
					:placeholder="toCalendarDate(dateIn(displayedYear, 1, 1))"
					:min-value="toCalendarDate(dateIn(Math.min(...props.years), 1, 1))"
					:max-value="toCalendarDate(dateIn(Math.max(...props.years), 12, 31))"
					data-testid="date-calendar"
					@update:placeholder="(date) => (displayedYear = date.year)"
					@update:model-value="select">
					<template #heading="{ value, view, setView }">
						<UButton
							:label="value"
							color="neutral"
							variant="ghost"
							block
							data-testid="date-year"
							@click="setView(view === 'year' ? 'month' : 'year')" />
					</template>
					<template #month-cell="{ month, selected }">
						<span :data-selected="selected || undefined" :data-testid="`date-pick-month-${month.month}`">
							{{ monthName(month.month) }}
						</span>
					</template>
					<template #year-cell="{ year }">
						<span :data-testid="`date-show-year-${year.year}`">{{ year.year }}</span>
					</template>
				</UCalendar>
				<UButton
					variant="ghost"
					color="neutral"
					class="mt-3 h-9 w-full justify-center rounded-full border border-line text-meta! data-selected:bg-row-on"
					:data-selected="(model.year === displayedYear && model.month === 'all') || undefined"
					:aria-pressed="model.year === displayedYear && model.month === 'all'"
					data-testid="date-pick-year"
					@click="select(undefined)">
					Celý rok {{ displayedYear }}
				</UButton>
			</div>
		</template>
	</UPopover>
</template>
