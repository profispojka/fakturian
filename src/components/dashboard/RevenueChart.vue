<script setup lang="ts">
import { useMutationObserver } from '@vueuse/core';
import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import VChart from 'vue-echarts';

import { LOCALE } from '~/constants/locales';
import { czkFromCents } from '~/utils/money';

import type { EChartsCoreOption } from 'echarts/core';
import type { ComponentPublicInstance } from 'vue';

use([BarChart, CanvasRenderer, GridComponent, TooltipComponent]);

interface Bar {
	label: string;
	value: number;
}

const props = defineProps<{ bars: Bar[] }>();
let root: HTMLElement;

function setRoot(element: Element | ComponentPublicInstance | null) {
	if (element instanceof HTMLElement) root = element;
}

interface Tokens {
	bar: string;
	danger: string;
	line: string;
	lineSoft: string;
	ink: string;
	ink3: string;
	card: string;
	font: string;
}

function tokens(element: HTMLElement): Tokens {
	const style = getComputedStyle(element);
	const token = (name: string) => style.getPropertyValue(name).trim();
	return {
		bar: token('--chart-bar'),
		danger: token('--danger'),
		line: token('--line'),
		lineSoft: token('--line-soft'),
		ink: token('--ink'),
		ink3: token('--ink-3'),
		card: token('--card'),
		font: style.fontFamily,
	};
}

const TICK = new Intl.NumberFormat(LOCALE, {
	notation: 'compact',
	maximumFractionDigits: 1,
	signDisplay: 'negative',
});

// Osa počítá v korunách: v haléřích by se popisky lámaly na jiných řádech, než na jakých je čte
// člověk.
function tickLabel(cents: number): string {
	return TICK.format(cents / 100);
}

function chartOption(t: Tokens): EChartsCoreOption {
	return {
		animation: false,
		grid: {
			top: 16,
			right: 8,
			bottom: 24,
			left: 52,
		},
		xAxis: {
			type: 'category',
			data: props.bars.map((bar) => bar.label),
			axisLine: {
				show: false,
			},
			axisTick: {
				show: false,
			},
			axisLabel: {
				color: t.ink3,
				fontFamily: t.font,
				fontSize: 10,
			},
		},
		yAxis: {
			type: 'value',
			min: (value: { min: number }) => Math.min(0, value.min),
			axisLine: {
				show: false,
			},
			axisTick: {
				show: false,
			},
			axisLabel: {
				color: t.ink3,
				fontFamily: t.font,
				fontSize: 10,
				formatter: tickLabel,
			},
			splitLine: {
				lineStyle: {
					color: t.lineSoft,
					type: 'dashed',
				},
			},
		},
		tooltip: {
			trigger: 'axis',
			backgroundColor: t.card,
			borderColor: t.line,
			borderWidth: 1,
			textStyle: {
				color: t.ink,
				fontFamily: t.font,
				fontSize: 11,
				fontWeight: 600,
			},
			valueFormatter: (value: string | number) => czkFromCents(Number(value)),
		},
		series: [
			{
				type: 'bar',
				data: props.bars.map((bar) => {
					let color = t.bar;
					if (bar.value < 0) color = t.danger;
					return {
						value: bar.value,
						itemStyle: {
							color,
							opacity: 1,
						},
					};
				}),
				barMaxWidth: 48,
				itemStyle: {
					borderRadius: [3, 3, 0, 0],
				},
			},
		],
	};
}

// Barvy jsou CSS tokeny, které ECharts sám nečte; po přepnutí vzhledu se musí přečíst znovu.
const palette = shallowRef<Tokens>();

onMounted(() => {
	const readPalette = () => {
		palette.value = tokens(root);
	};
	readPalette();
	useMutationObserver(document.documentElement, readPalette, {
		attributes: true,
		attributeFilter: ['class'],
	});
});

const option = computed(() => palette.value && chartOption(palette.value));
</script>

<template>
	<div
		:ref="setRoot"
		class="relative h-52 w-full"
		:aria-label="`Sloupcový graf fakturace, ${bars.length} období`"
		:data-periods="bars.length"
		data-testid="dashboard-revenue-chart"
		role="img">
		<VChart v-if="option" :option="option" autoresize class="size-full" />
	</div>
</template>
