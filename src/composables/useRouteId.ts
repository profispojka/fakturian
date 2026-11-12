import type { ComputedRef } from 'vue';

export function useRouteId(): ComputedRef<string> {
	const route = useRoute();
	return computed(() => {
		if (typeof route.params.id === 'string') return route.params.id;
		return '';
	});
}
