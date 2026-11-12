import { useIntervalFn } from '@vueuse/core';

import { today } from '~/utils/date';

const CHECK_MS = 60_000;

// Stránka zůstává otevřená i přes půlnoc; zápis téhož dne nic nepřekreslí.
export function useToday() {
	const day = ref(today());
	useIntervalFn(() => {
		day.value = today();
	}, CHECK_MS);
	return day;
}
