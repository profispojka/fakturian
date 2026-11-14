import { describe, expect, it, vi } from 'vitest';

import InvoiceDateFilterPicker from '~/components/invoice/DateFilterPicker.vue';
import { yearOf, monthName, today } from '~/utils/date';
import { yearFilter } from '~/utils/invoice';

import { mountUi, layer } from '../setup/mount';

import type { InvoiceDateFilter } from '~/utils/invoice';

const THIS_YEAR = yearOf(today());
const YEARS: [number, number, number] = [THIS_YEAR + 1, THIS_YEAR, THIS_YEAR - 1];
// Šipky roku kreslí `UCalendar`, značka se na ně nedostane.
const PREV_YEAR = 'button[aria-label="Předchozí rok"]';
const NEXT_YEAR = 'button[aria-label="Další rok"]';

function mount(model: InvoiceDateFilter = yearFilter(THIS_YEAR), years: number[] = YEARS) {
	return mountUi(InvoiceDateFilterPicker, {
		props: {
			modelValue: model,
			years,
		},
	});
}

async function openPicker(c: ReturnType<typeof mount>) {
	await c.find('[data-testid="date-period"]').trigger('click');
	await vi.waitFor(() => expect(layer().find('[data-testid="date-picker"]').exists()).toBe(true));
}

describe('výběr období', () => {
	it('jediné tlačítko ukazuje celý rok', () => {
		const c = mount();
		expect(c.find('[data-testid="date-period"]').text()).toBe(`Celý rok ${THIS_YEAR}`);
	});

	it('jediné tlačítko ukazuje vybraný měsíc s rokem', () => {
		const c = mount({
			year: YEARS[2],
			month: 9,
		});
		expect(c.find('[data-testid="date-period"]').text()).toBe(`${monthName(9)} ${YEARS[2]}`);
	});

	it('nabízí všech dvanáct měsíců a celý rok ve společném panelu', async () => {
		const c = mount();
		await openPicker(c);
		expect(layer().findAll('[data-testid^="date-pick-month-"]')).toHaveLength(12);
		expect(layer().find('[data-testid="date-pick-month-1"]').text()).toBe(monthName(1));
		expect(layer().find('[data-testid="date-pick-month-12"]').text()).toBe(monthName(12));
		expect(layer().find('[data-testid="date-pick-year"]').attributes('aria-pressed')).toBe('true');
	});

	it('přepne rok šipkou, vybere měsíc, odešle celé období a zavře panel', async () => {
		const c = mount();
		await openPicker(c);
		await layer().find(PREV_YEAR).trigger('click');
		expect(layer().find('[data-testid="date-pick-year"]').text()).toBe(`Celý rok ${YEARS[2]}`);
		expect(c.emitted('update:modelValue')).toBeUndefined();
		await layer().find('[data-testid="date-pick-month-11"]').trigger('click');
		expect(c.emitted('update:modelValue')).toEqual([
			[
				{
					year: YEARS[2],
					month: 11,
				},
			],
		]);
		await vi.waitFor(() => expect(layer().find('[data-testid="date-picker"]').exists()).toBe(false));
	});

	it('šipky nepustí mimo roky, které výpis zná', async () => {
		const c = mount(yearFilter(YEARS[0]));
		await openPicker(c);
		expect(layer().find(NEXT_YEAR).attributes('disabled')).toBe('');
		await layer().find(PREV_YEAR).trigger('click');
		await layer().find(PREV_YEAR).trigger('click');
		expect(layer().find('[data-testid="date-pick-year"]').text()).toBe(`Celý rok ${YEARS[2]}`);
		expect(layer().find(PREV_YEAR).attributes('disabled')).toBe('');
	});

	it('zvýrazní vybraný měsíc a celý rok jím nahradí', async () => {
		const c = mount({
			year: THIS_YEAR,
			month: 2,
		});
		await openPicker(c);
		expect(layer().find('[data-testid="date-pick-month-2"]').attributes('data-selected')).toBe('true');
		expect(layer().find('[data-testid="date-pick-year"]').attributes('aria-pressed')).toBe('false');
		await layer().find('[data-testid="date-pick-year"]').trigger('click');
		expect(c.emitted('update:modelValue')).toEqual([[yearFilter(THIS_YEAR)]]);
	});

	it('znovu kliknutý vybraný měsíc vybere celý rok', async () => {
		const c = mount({
			year: THIS_YEAR,
			month: 2,
		});
		await openPicker(c);
		await layer().find('[data-testid="date-pick-month-2"]').trigger('click');
		expect(c.emitted('update:modelValue')).toEqual([[yearFilter(THIS_YEAR)]]);
	});

	it('umí vybrat celý jiný rok', async () => {
		const c = mount({
			year: THIS_YEAR,
			month: 2,
		});
		await openPicker(c);
		await layer().find(NEXT_YEAR).trigger('click');
		await layer().find('[data-testid="date-pick-year"]').trigger('click');
		expect(c.emitted('update:modelValue')).toEqual([[yearFilter(YEARS[0])]]);
	});

	it('nadpis kalendáře přepne na roky a vybraný rok vrátí měsíce', async () => {
		const c = mount();
		await openPicker(c);
		await layer().find('[data-testid="date-year"]').trigger('click');
		expect(layer().findAll('[data-testid^="date-pick-month-"]')).toHaveLength(0);
		await layer().find(`[data-testid="date-show-year-${YEARS[2]}"]`).trigger('click');
		expect(layer().findAll('[data-testid^="date-pick-month-"]')).toHaveLength(12);
		expect(layer().find('[data-testid="date-pick-year"]').text()).toBe(`Celý rok ${YEARS[2]}`);
		expect(c.emitted('update:modelValue')).toBeUndefined();
	});

	it('druhé kliknutí na nadpis vrátí měsíce bez výběru roku', async () => {
		const c = mount();
		await openPicker(c);
		await layer().find('[data-testid="date-year"]').trigger('click');
		await layer().find('[data-testid="date-year"]').trigger('click');
		expect(layer().findAll('[data-testid^="date-pick-month-"]')).toHaveLength(12);
		expect(c.emitted('update:modelValue')).toBeUndefined();
	});

	it('Escape zahodí rozpracovaný rok a další otevření ukáže platný výběr', async () => {
		const c = mount({
			year: THIS_YEAR,
			month: 2,
		});
		await openPicker(c);
		await layer().find(PREV_YEAR).trigger('click');
		await layer().find('[data-testid="date-pick-month-2"]').trigger('keydown', { key: 'Escape' });
		await vi.waitFor(() => expect(layer().find('[data-testid="date-picker"]').exists()).toBe(false));
		expect(c.emitted('update:modelValue')).toBeUndefined();
		await openPicker(c);
		expect(layer().find('[data-testid="date-pick-year"]').text()).toBe(`Celý rok ${THIS_YEAR}`);
		expect(layer().find('[data-testid="date-pick-month-2"]').attributes('data-selected')).toBe('true');
	});
});
