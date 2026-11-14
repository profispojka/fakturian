import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

import DashboardRevenueChart from '~/components/dashboard/RevenueChart.vue';
import { czkFromCents } from '~/utils/money';

import { CHART_TOKENS, mountUi } from '../setup/mount';

interface RevenueOption {
	xAxis: { data: string[] };
	yAxis: {
		min: (value: { min: number }) => number;
		axisLabel: { formatter: (value: number) => string };
	};
	tooltip: { valueFormatter: (value: string | number) => string };
	series: [
		{
			data: { value: number; itemStyle: { color: string; opacity: number } }[];
		},
	];
}

interface RenderedChart {
	option: RevenueOption;
	autoresize: boolean;
}

const observers = vi.hoisted<{ mutation?: () => void }>(() => ({}));
const rendered = vi.hoisted<RenderedChart[]>(() => []);

// Kreslení, změnu velikosti i úklid dělá `vue-echarts`; tady jde o to, co mu grafy předají.
vi.mock('vue-echarts', async () => {
	const vue = await import('vue');
	return {
		default: vue.defineComponent(
			(props: { option: RevenueOption; autoresize?: boolean }) => () => {
				rendered.push({
					option: props.option,
					autoresize: Boolean(props.autoresize),
				});
				return vue.h('div', {
					'data-testid': 'echarts',
				});
			},
			{
				name: 'VChart',
				props: {
					option: null,
					autoresize: Boolean,
				},
			},
		),
	};
});
vi.mock('echarts/charts', () => ({ BarChart: {} }));
vi.mock('echarts/components', () => ({
	GridComponent: {},
	TooltipComponent: {},
}));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }));
vi.mock('echarts/core', () => ({ use: vi.fn(() => undefined) }));
vi.mock('@vueuse/core', async (importOriginal) => {
	const original = await importOriginal<Record<string, unknown>>();
	return {
		...original,
		useMutationObserver: vi.fn((_target: unknown, notify: () => void) => {
			observers.mutation = notify;
			return { stop: vi.fn() };
		}),
	};
});

function lastChart(): RenderedChart {
	const chart = rendered.at(-1);
	if (!chart) throw new Error('Graf se nevykreslil.');
	return chart;
}

beforeEach(() => {
	delete observers.mutation;
	rendered.length = 0;
});

describe('DashboardRevenueChart', () => {
	it('předá grafu období, barvy a formátování a po přepnutí vzhledu barvy přečte znovu', async () => {
		const c = mountUi(DashboardRevenueChart, {
			props: {
				bars: [
					{
						label: 'Leden',
						value: 150_000,
					},
					{
						label: 'Únor',
						value: -200_000_000,
					},
				],
			},
			attrs: CHART_TOKENS,
		});
		await flushPromises();

		const root = c.find<HTMLElement>('[data-testid="dashboard-revenue-chart"]');
		expect(root.attributes('aria-label')).toBe('Sloupcový graf fakturace, 2 období');
		expect(root.attributes('data-periods')).toBe('2');
		expect(lastChart().autoresize).toBe(true);

		const option = lastChart().option;
		expect(option.xAxis.data).toEqual(['Leden', 'Únor']);
		expect(option.series[0].data).toEqual([
			{
				value: 150_000,
				itemStyle: {
					color: '#2e8b57',
					opacity: 1,
				},
			},
			{
				value: -200_000_000,
				itemStyle: {
					color: '#c4483f',
					opacity: 1,
				},
			},
		]);
		expect(option.yAxis.min({ min: 12 })).toBe(0);
		expect(option.yAxis.min({ min: -12 })).toBe(-12);
		expect(option.yAxis.axisLabel.formatter(0)).toBe('0');
		// Mezi číslem a zkratkou vkládá `Intl.NumberFormat` nezlomitelnou mezeru.
		expect(option.yAxis.axisLabel.formatter(150_000)).toBe('1,5\u00A0tis.');
		expect(option.yAxis.axisLabel.formatter(-200_000_000)).toBe('-2\u00A0mil.');
		expect(option.tooltip.valueFormatter('123400')).toBe(czkFromCents(123_400));

		root.element.style.setProperty('--chart-bar', '#123456');
		observers.mutation?.();
		await flushPromises();

		expect(lastChart().option.series[0].data[0]).toEqual({
			value: 150_000,
			itemStyle: {
				color: '#123456',
				opacity: 1,
			},
		});
	});

	it('překreslí se po změně dat', async () => {
		const bars = ref([
			{
				label: 'Březen',
				value: 10,
			},
		]);
		const Host = defineComponent({
			setup:
				(_props, { attrs }) =>
				() =>
					h(DashboardRevenueChart, {
						...attrs,
						bars: bars.value,
					}),
		});
		mountUi(Host, { attrs: CHART_TOKENS });
		await flushPromises();
		expect(lastChart().option.xAxis.data).toEqual(['Březen']);

		bars.value = [
			{
				label: 'Duben',
				value: 20,
			},
		];
		await flushPromises();
		expect(lastChart().option.xAxis.data).toEqual(['Duben']);
	});
});
