import { setImmediate as settle } from 'node:timers/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref, watch } from 'vue';

import { useTable } from '~/composables/useTable';

const TABLE = {
	key: 'test',
	filters: {},
};

describe('useTable', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('odběratel konce načítání vidí současně hotové řádky nebo chybu', async () => {
		const list = vi
			.fn<() => Promise<string[]>>()
			.mockResolvedValueOnce(['A'])
			.mockRejectedValueOnce(new Error('Disk'));
		const observed = vi.fn();
		const scope = effectScope();
		const table = scope.run(() => {
			const instance = useTable(list, TABLE);
			watch(
				instance.loading,
				(loading) => {
					if (!loading) observed(instance.items.value, instance.error.value);
				},
				{ flush: 'sync' },
			);
			return instance;
		})!;
		await settle();
		expect(observed).toHaveBeenCalledExactlyOnceWith(['A'], '');
		await table.refresh();
		expect(observed).toHaveBeenNthCalledWith(2, [], 'Disk');
		scope.stop();
	});

	it('bez sledovaných zdrojů nic nesleduje ani nevaruje', async () => {
		const warn = vi.spyOn(console, 'warn').mockReturnValue(undefined);
		const scope = effectScope();
		scope.run(() => useTable(() => [], TABLE));
		await settle();
		expect(warn).not.toHaveBeenCalled();
		scope.stop();
	});

	it('bez filtrů poskytuje celý seznam', async () => {
		const rows = [{ name: 'A' }, { name: 'B' }];
		const scope = effectScope();
		const table = scope.run(() => useTable(() => rows, TABLE))!;
		await settle();
		table.search.value = 'B';
		expect(table.filtered.value).toEqual(rows);
		scope.stop();
	});

	it('filtr a hledání drží pod klíčem, takže na ně další tabulka se stejným klíčem naváže', async () => {
		const options = {
			key: 'numbers',
			filters: {
				ascending: true,
				min: 2,
			},
			filter: (n: number, f: { min: number }) => n >= f.min,
			compare: (a: number, b: number, f: { ascending: boolean }) => (f.ascending ? a - b : b - a),
		};
		const first = effectScope();
		const table = first.run(() => useTable(() => [3, 1, 2], options))!;
		await settle();
		expect(table.filtered.value).toEqual([2, 3]);
		table.filters.value.ascending = false;
		table.search.value = 'tři';
		first.stop();

		const second = effectScope();
		const again = second.run(() => useTable(() => [3, 1, 2], options))!;
		await settle();
		expect(again.filters.value).toEqual({
			ascending: false,
			min: 2,
		});
		expect(again.search.value).toBe('tři');
		expect(again.filtered.value).toEqual([3, 2]);
		expect(options.filters.ascending).toBe(true);
		second.stop();
	});
	it('hledá bez diakritiky ve vnořených polích a zachová pořadí řádků', async () => {
		vi.useFakeTimers();
		const rows = [
			{
				name: 'Studio Praha',
				address: {
					city: undefined,
				},
			},
			{
				name: 'Praha servis',
				address: {
					city: 'Žluťoučký kůň',
				},
			},
		];
		const scope = effectScope();
		const table = scope.run(() =>
			useTable(() => rows, {
				...TABLE,
				searchFields: ['name', 'address.city'],
			}),
		)!;
		await vi.advanceTimersByTimeAsync(0);
		table.search.value = 'praha';
		await vi.advanceTimersByTimeAsync(150);
		expect(table.filtered.value).toEqual(rows);
		table.search.value = 'zlutoucky kun';
		await vi.advanceTimersByTimeAsync(150);
		expect(table.filtered.value).toEqual([rows[1]]);
		scope.stop();
	});
	it('řadí výsledek bez změny pořadí zdrojových dat', async () => {
		const rows = [3, 1, 2];
		const scope = effectScope();
		const table = scope.run(() =>
			useTable(() => Promise.resolve(rows), {
				...TABLE,
				filter: () => true,
				compare: (a, b) => a - b,
			}),
		)!;
		await settle();
		expect(table.filtered.value).toEqual([1, 2, 3]);
		expect(table.items.value).toEqual([3, 1, 2]);
		expect(rows).toEqual([3, 1, 2]);
		scope.stop();
	});
	it('načítá seznam, hledá přes Nuxt UI a reaguje na doménový filtr i obnovu', async () => {
		vi.useFakeTimers();
		const source = ref(['Praha', 'Brno']);
		const onlyBrno = ref(false);
		const list = vi.fn(() => Promise.resolve(source.value));
		const onLoaded = vi.fn();
		const scope = effectScope();
		const table = scope.run(() =>
			useTable(list, {
				...TABLE,
				watch: [source],
				filter: (item) => !onlyBrno.value || item === 'Brno',
				searchFields: [],
				onLoaded,
			}),
		)!;
		expect(table.loading.value).toBe(true);
		expect(table.items.value).toEqual([]);
		expect(table.error.value).toBe('');
		await vi.advanceTimersByTimeAsync(0);
		expect(table.items.value).toEqual(['Praha', 'Brno']);
		expect(table.filtered.value).toEqual(['Praha', 'Brno']);
		expect(table.loading.value).toBe(false);
		expect(onLoaded).toHaveBeenCalledWith(['Praha', 'Brno']);
		table.search.value = ' PŘA ';
		await vi.advanceTimersByTimeAsync(150);
		expect(table.filtered.value).toEqual(['Praha']);
		table.search.value = ' ';
		onlyBrno.value = true;
		await vi.advanceTimersByTimeAsync(150);
		expect(table.filtered.value).toEqual(['Brno']);
		source.value = ['Brno', 'Ostrava'];
		expect(table.items.value).toEqual([]);
		expect(table.loading.value).toBe(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(table.items.value).toEqual(['Brno', 'Ostrava']);
		await table.refresh();
		expect(list).toHaveBeenCalledTimes(3);
		scope.stop();
	});

	it('hlásí chybu načtení bez callbacku a umožní opakování', async () => {
		const list = vi.fn<() => Promise<string[]>>().mockRejectedValueOnce(new Error('Disk')).mockResolvedValue(['A']);
		const onLoaded = vi.fn();
		const scope = effectScope();
		const table = scope.run(() =>
			useTable(list, {
				...TABLE,
				filter: () => true,
				onLoaded,
			}),
		)!;
		await settle();
		expect(table.error.value).toBe('Disk');
		expect(table.items.value).toEqual([]);
		expect(table.loading.value).toBe(false);
		expect(onLoaded).not.toHaveBeenCalled();
		await table.refresh();
		expect(table.error.value).toBe('');
		expect(table.items.value).toEqual(['A']);
		scope.stop();
	});

	it.each(['resolve', 'reject'] as const)('ignoruje opožděnou odpověď starého seznamu: %s', async (outcome) => {
		const old = Promise.withResolvers<string[]>();
		const latest = Promise.withResolvers<string[]>();
		const list = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
		const scope = effectScope();
		const table = scope.run(() =>
			useTable(list, {
				...TABLE,
				filter: () => true,
			}),
		)!;
		const refresh = table.refresh();
		if (outcome === 'resolve') old.resolve(['Stará složka']);
		else old.reject(new Error('Stará chyba'));
		await settle();
		expect(table.loading.value).toBe(true);
		expect(table.items.value).toEqual([]);
		expect(table.error.value).toBe('');
		latest.resolve(['Nová složka']);
		await refresh;
		expect(table.items.value).toEqual(['Nová složka']);
		expect(table.loading.value).toBe(false);
		scope.stop();
	});

	it('po opuštění stránky nepředá opožděná data dál', async () => {
		const pending = Promise.withResolvers<string[]>();
		const onLoaded = vi.fn();
		const scope = effectScope();
		const table = scope.run(() =>
			useTable(() => pending.promise, {
				...TABLE,
				filter: () => true,
				onLoaded,
			}),
		)!;
		scope.stop();
		pending.resolve(['A']);
		await settle();
		expect(table.items.value).toEqual([]);
		expect(onLoaded).not.toHaveBeenCalled();
	});

	it.each(['resolve', 'reject'] as const)(
		'starý požadavek po dokončení nového nic nepřepíše: %s',
		async (outcome) => {
			const old = Promise.withResolvers<string[]>();
			const latest = Promise.withResolvers<string[]>();
			const list = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
			const onLoaded = vi.fn();
			const scope = effectScope();
			const table = scope.run(() =>
				useTable(list, {
					...TABLE,
					onLoaded,
				}),
			)!;
			const refresh = table.refresh();
			latest.resolve(['Nová složka']);
			await refresh;
			if (outcome === 'resolve') old.resolve(['Stará složka']);
			else old.reject(new Error('Stará chyba'));
			await settle();
			expect(table.items.value).toEqual(['Nová složka']);
			expect(table.error.value).toBe('');
			expect(table.loading.value).toBe(false);
			expect(onLoaded).toHaveBeenCalledExactlyOnceWith(['Nová složka']);
			scope.stop();
		},
	);

	it('ruční obnova drží řádky do výsledku, chyba je vyprázdní a zůstane vidět při opakování', async () => {
		const failed = Promise.withResolvers<string[]>();
		const retried = Promise.withResolvers<string[]>();
		const list = vi
			.fn()
			.mockResolvedValueOnce(['A'])
			.mockReturnValueOnce(failed.promise)
			.mockReturnValueOnce(retried.promise);
		const scope = effectScope();
		const table = scope.run(() => useTable(list, TABLE))!;
		await settle();
		const refresh = table.refresh();
		expect(table.items.value).toEqual(['A']);
		expect(table.loading.value).toBe(true);
		failed.reject(new Error('Disk'));
		await refresh;
		expect(table.items.value).toEqual([]);
		expect(table.error.value).toBe('Disk');
		const retry = table.refresh();
		expect(table.error.value).toBe('Disk');
		retried.resolve(['B']);
		await retry;
		expect(table.items.value).toEqual(['B']);
		expect(table.error.value).toBe('');
		scope.stop();
	});

	it('chybu vyhozenou při zavolání služby vystaví v tabulce', async () => {
		const scope = effectScope();
		const table = scope.run(() =>
			useTable(() => {
				throw new Error('Služba');
			}, TABLE),
		)!;
		await settle();
		expect(table.error.value).toBe('Služba');
		expect(table.loading.value).toBe(false);
		scope.stop();
	});

	it.each(['resolve', 'reject'] as const)('odchod během obnovy zachová poslední stav: %s', async (outcome) => {
		const pending = Promise.withResolvers<string[]>();
		const list = vi.fn().mockResolvedValueOnce(['A']).mockReturnValueOnce(pending.promise);
		const onLoaded = vi.fn();
		const scope = effectScope();
		const table = scope.run(() =>
			useTable(list, {
				...TABLE,
				onLoaded,
			}),
		)!;
		await settle();
		const refresh = table.refresh();
		scope.stop();
		expect(table.loading.value).toBe(false);
		if (outcome === 'resolve') pending.resolve(['B']);
		else pending.reject(new Error('Opuštěná stránka'));
		await refresh;
		expect(table.items.value).toEqual(['A']);
		expect(table.error.value).toBe('');
		expect(onLoaded).toHaveBeenCalledExactlyOnceWith(['A']);
	});

	it('refresh čeká i na dokončení onLoaded', async () => {
		const callback = Promise.withResolvers<void>();
		const onLoaded = vi.fn().mockResolvedValueOnce(undefined).mockReturnValueOnce(callback.promise);
		const scope = effectScope();
		const table = scope.run(() =>
			useTable(() => Promise.resolve(['A']), {
				...TABLE,
				onLoaded,
			}),
		)!;
		await settle();
		let completed = false;
		async function refreshAndComplete() {
			await table.refresh();
			completed = true;
		}
		const refresh = refreshAndComplete();
		await settle();
		expect(onLoaded).toHaveBeenNthCalledWith(2, ['A']);
		expect(table.loading.value).toBe(false);
		expect(completed).toBe(false);
		callback.resolve();
		await refresh;
		expect(completed).toBe(true);
		scope.stop();
	});

	it('s odkladem filtruje až po pauze v psaní', async () => {
		vi.useFakeTimers();
		const scope = effectScope();
		const table = scope.run(() =>
			useTable(() => ['Praha', 'Brno'], {
				...TABLE,
				searchFields: [],
			}),
		)!;
		await vi.advanceTimersByTimeAsync(0);

		table.search.value = 'brno';
		await vi.advanceTimersByTimeAsync(100);
		expect(table.filtered.value).toEqual(['Praha', 'Brno']);

		await vi.advanceTimersByTimeAsync(50);
		expect(table.filtered.value).toEqual(['Brno']);
		scope.stop();
	});

	it('chybu onLoaded nezamění za selhání čtení', async () => {
		const onLoaded = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Callback'));
		const scope = effectScope();
		const table = scope.run(() =>
			useTable(() => Promise.resolve(['A']), {
				...TABLE,
				onLoaded,
			}),
		)!;
		await settle();
		await expect(table.refresh()).rejects.toThrow(new Error('Callback'));
		expect(table.items.value).toEqual(['A']);
		expect(table.error.value).toBe('');
		scope.stop();
	});
});
