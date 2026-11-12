import { useFilter } from '@nuxt/ui/composables/useFilter';
import { refDebounced } from '@vueuse/core';
import { computed, onScopeDispose, ref, shallowRef, watch, type WatchSource } from 'vue';

import { errorText } from '~/utils/errors';

import type { GetItemKeys } from '@nuxt/ui';

// Milisekundy, o které hledání počká na další úhoz — u dlouhého výpisu by každé písmeno filtrovalo celý archiv.
const SEARCH_DEBOUNCE_MS = 150;

export function useTable<T, F extends object>(
	list: () => T[] | Promise<T[]>,
	options: {
		// Hledání a filtr drží `useState` pod tímhle klíčem, takže návrat do sekce tabulku nevynuluje.
		key: string;
		filters: F;
		watch?: WatchSource[];
		filter?: (item: T, filters: F) => boolean;
		searchFields?: GetItemKeys<T>[];
		compare?: (a: T, b: T, filters: F) => number;
		onLoaded?: (items: T[]) => void | Promise<void>;
	},
) {
	const { scoreItem } = useFilter();
	const items = shallowRef<T[]>([]);
	const search = useState(`table-search:${options.key}`, () => '');
	const filters = useState(`table-filters:${options.key}`, () => structuredClone(options.filters));
	const query = refDebounced(search, SEARCH_DEBOUNCE_MS);
	let pending: symbol | undefined;
	const loading = ref(true);
	const error = ref('');
	const filtered = computed(() => {
		const text = query.value.trim();
		const { filter, compare, searchFields } = options;
		let rows = items.value;
		if (filter) rows = rows.filter((item) => filter(item, filters.value));
		if (searchFields) {
			rows = rows.filter((item) => scoreItem(item, text, searchFields) !== null);
		}
		if (compare) return rows.toSorted((a, b) => compare(a, b, filters.value));
		return rows;
	});

	async function execute() {
		const current = Symbol();
		pending = current;
		let result: T[];
		try {
			result = await list();
		} catch (cause) {
			if (current !== pending) return;
			items.value = [];
			error.value = errorText(cause);
			loading.value = false;
			return;
		}
		if (current !== pending) return;
		items.value = result;
		error.value = '';
		loading.value = false;
		await options.onLoaded?.(result);
	}

	function refresh() {
		loading.value = true;
		return execute();
	}

	watch(
		options.watch ?? [],
		() => {
			items.value = [];
			void refresh();
		},
		{ flush: 'sync' },
	);
	void execute();
	onScopeDispose(() => {
		pending = undefined;
		loading.value = false;
	});
	return {
		items,
		filtered,
		filters,
		search,
		loading,
		error,
		refresh,
	};
}
