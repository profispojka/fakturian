import { expect, it } from 'vitest';
import { ref } from 'vue';

import { useDateModel } from '~/composables/useDateModel';
import { MIN_DATE, toCalendarDate } from '~/utils/date';

import { date } from './setup/dates';

import type { DateString } from '~/utils/date';

it('propojí aktuální formulář s Nuxt UI a ukládá pouze validované stringy', () => {
	const form = ref<{ date?: DateString }>({ date: date('2028-02-29') });
	const model = useDateModel(form, 'date');
	expect(model.value?.toString()).toBe('2028-02-29');
	const original = form.value;
	form.value = { date: date('2026-12-31') };
	expect(model.value?.toString()).toBe('2026-12-31');
	model.value = toCalendarDate(date('2027-01-01'));
	expect(form.value).toEqual({ date: '2027-01-01' });
	expect(original).toEqual({ date: '2028-02-29' });
	model.value = null;
	expect(form.value.date).toBeUndefined();
	expect(model.value).toBeUndefined();
	model.value = toCalendarDate(date('2027-01-01'));
	model.value = undefined;
	expect(form.value.date).toBeUndefined();
	model.value = MIN_DATE.subtract({ days: 1 });
	expect(form.value.date).toBeUndefined();
});
