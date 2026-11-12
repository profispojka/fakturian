import { computed } from 'vue';

import { fromCalendarDate, toCalendarDate } from '~/utils/date';

import type { Ref } from 'vue';
import type { DateString } from '~/utils/date';

export function useDateModel<K extends string>(form: Ref<Partial<Record<K, DateString>>>, key: K) {
	return computed({
		get: () => toCalendarDate(form.value[key]),
		set: (value: Parameters<typeof fromCalendarDate>[0]) => {
			form.value[key] = fromCalendarDate(value);
		},
	});
}
