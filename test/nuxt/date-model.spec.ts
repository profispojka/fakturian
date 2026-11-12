import UInputDate from '@nuxt/ui/components/InputDate.vue';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, ref } from 'vue';

import { useDateModel } from '~/composables/useDateModel';
import { MIN_DATE, MAX_DATE } from '~/utils/date';

import { date } from '../setup/dates';
import { enterDate, mountUi } from '../setup/mount';

import type { DateString } from '~/utils/date';

describe('useDateModel', () => {
	it('Nuxt UI vyplní a vymaže datum bez objektů v uloženém modelu', async () => {
		const value = ref<{ date?: DateString }>({});
		const Host = defineComponent({
			components: {
				UInputDate,
			},
			template: '<UInputDate v-model="model" :min-value="min" :max-value="max" data-testid="date-input" />',
			setup() {
				const model = useDateModel(value, 'date');
				return {
					model,
					min: MIN_DATE,
					max: MAX_DATE,
				};
			},
		});
		const c = mountUi(Host);
		await enterDate(c.find('[data-testid="date-input"]'), date('2028-02-29'));
		expect(value.value.date).toBe('2028-02-29');
		value.value = { date: date('2026-12-31') };
		await flushPromises();
		expect(c.find('[data-testid="date-input"] [data-segment="year"]').text()).toBe('2026');
		await enterDate(c.find('[data-testid="date-input"]'), undefined);
		expect(value.value).toStrictEqual({ date: undefined });
	});
});
