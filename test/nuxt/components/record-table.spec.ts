import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { h } from 'vue';

import RecordTable from '~/components/RecordTable.vue';

import { mountUi } from '../setup/mount';

import type { TableColumn } from '@nuxt/ui';

interface Row {
	id: string;
	name: string;
}

const columns: TableColumn<Row>[] = [
	{
		id: 'name',
		header: 'Název',
	},
];

function rows(count: number): Row[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `r${i}`,
		name: `Řádek ${i}`,
	}));
}

async function mount(props: Record<string, unknown>) {
	const c = mountUi(RecordTable, {
		props: {
			columns,
			rowId: (row: Row) => row.id,
			items: [],
			data: [],
			...props,
		},
		attrs: {
			'data-testid': 'records',
		},
		slots: {
			before: () => h('p', { 'data-testid': 'records-before' }, 'Hláška nad tabulkou'),
			empty: () => 'Zatím nic.',
			'name-cell': (scope?: { row: { original: Row } }) =>
				h('span', { 'data-testid': `records-cell-${scope?.row.original.id}` }, scope?.row.original.name),
		},
	});
	await flushPromises();
	return c;
}

describe('RecordTable', () => {
	it('při načítání řekne, co načítá, a prázdný stav neukáže', async () => {
		const c = await mount({
			loading: true,
			loadingText: 'Načítám záznamy…',
		});

		expect(c.find('[data-testid="records-loading"]').text()).toBe('Načítám záznamy…');
		expect(c.find('[data-testid="empty-state"]').exists()).toBe(false);
		expect(c.find('[data-testid="records-before"]').text()).toBe('Hláška nad tabulkou');
	});

	it('bez záznamů ukáže vlastní text', async () => {
		const c = await mount({});

		expect(c.find('[data-testid="empty-state"]').text()).toContain('Zatím nic.');
		expect(c.find('[data-testid="records"]').exists()).toBe(false);
	});

	it('hledání bez shody řekne, že nic nenašlo', async () => {
		const c = await mount({
			items: rows(2),
			data: [],
		});

		expect(c.find('[data-testid="empty-state-filtered"]').text()).toBe('Žádné položky nenalezeny.');
	});

	it('chyba přebije prázdný stav i tabulku', async () => {
		const c = await mount({
			items: rows(2),
			data: rows(2),
			error: 'Disk je odpojený',
		});

		expect(c.find('[data-testid="empty-state-error"]').text()).toBe('Došlo k chybě: Disk je odpojený');
		expect(c.find('[data-testid="records"]').exists()).toBe(false);
	});

	it('skrytý prázdný stav mlčí, chybu ale ukáže', async () => {
		const quiet = await mount({ emptyHidden: true });
		expect(quiet.find('[data-testid="empty-state-error"]').exists()).toBe(false);
		quiet.unmount();

		const failed = await mount({
			emptyHidden: true,
			error: 'Disk je odpojený',
		});
		expect(failed.find('[data-testid="empty-state-error"]').text()).toBe('Došlo k chybě: Disk je odpojený');
	});

	it('řádky vykreslí přes buňky stránky a výběr řádku předá dál', async () => {
		const data = rows(2);
		const c = await mount({
			items: data,
			data,
		});

		expect(c.find('[data-testid="records"]').exists()).toBe(true);
		expect(c.findAll('[data-testid^="records-cell-"]').map((cell) => cell.text())).toEqual(['Řádek 0', 'Řádek 1']);
		await c.find('[data-testid="records-cell-r1"]').trigger('click');

		const [event] = c.emitted('select') ?? [];
		expect(event?.[1]).toEqual(expect.objectContaining({ original: data[1] }));
	});

	it('dlouhý výpis nevykreslí všechny řádky naráz', async () => {
		const data = rows(120);
		const c = await mount({
			items: data,
			data,
		});

		expect(c.find('[data-testid="records"]').exists()).toBe(true);
		expect(c.findAll('[data-testid^="records-cell-"]').length).toBeLessThan(120);
	});
});
