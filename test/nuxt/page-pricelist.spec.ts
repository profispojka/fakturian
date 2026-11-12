import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import { newInvoice } from '~/schemas/invoices';
import { yearOf, today } from '~/utils/date';

import { backend, wireInvoice } from '../setup/backend';
import { mountPage, answerDialog, currentPath, layer, pick as pickFromListbox } from '../setup/mount';
import { savedField, prepareVault } from '../setup/vault';

import type { VueWrapper } from '@vue/test-utils';
import type { PriceItem } from '~/schemas/pricelist';

async function openActions(c: VueWrapper, id = 'p1') {
	await c.find(`[data-testid="price-actions-${id}"]`).trigger('click');
	await vi.waitFor(() => expect(layer().find('[data-testid="price-show-usage"]').exists()).toBe(true));
}

function mountPricelist() {
	return mountPage('/pricelist');
}

function item(id: string, over: Partial<PriceItem> = {}): PriceItem {
	return {
		id,
		name: `Položka ${id}`,
		note: '',
		priceCents: 120_000,
		unit: 'hod',
		...over,
	};
}

async function vaultWithPricelist(...items: PriceItem[]): Promise<void> {
	await prepareVault({
		'nastaveni.json': {
			supplier: null,
			contacts: [],
			pricelist: items,
		},
	});
}

function savedPricelist(): PriceItem[] {
	return savedField('nastaveni.json', 'pricelist');
}

/** Vykázané množství nese archiv, takže se čerpání zakládá dokladem ve složce. */
function documentWith(watched: PriceItem, invoiceNumber: string, quantity: number, usageYear?: number): void {
	const inv = newInvoice(null, invoiceNumber);
	inv.lines = [
		{
			id: 'r1',
			description: watched.name,
			quantity,
			unit: watched.unit,
			unitPriceCents: watched.priceCents,
			itemId: watched.id,
			usageYear,
		},
	];
	backend.folder('/vault').invoices.set(invoiceNumber, wireInvoice(inv));
}

async function vaultWithUsage(
	watched: PriceItem,
	reported: { invoiceNumber: string; quantity: number }[],
): Promise<void> {
	await prepareVault({
		'nastaveni.json': {
			supplier: null,
			contacts: [],
			pricelist: [watched],
		},
	});
	for (const v of reported) documentWith(watched, v.invoiceNumber, v.quantity);
}

beforeEach(async () => {
	await vaultWithPricelist();
});
describe('výpis ceníku', () => {
	it('dvojklik na řádek otevře jeho položku', async () => {
		await vaultWithPricelist(item('p1'), item('p2'));
		const c = await mountPricelist();
		await c.find('[data-testid="price-item-p2"]').trigger('click', { detail: 2 });
		await vi.waitFor(() => expect(currentPath()).toBe('/pricelist/p2'));
	});

	it('klik na řádek položku jen označí', async () => {
		await vaultWithPricelist(item('p1'), item('p2'));
		const c = await mountPricelist();
		await c.find('[data-testid="price-item-p2"]').trigger('click');
		expect(c.find('[data-testid="price-item-p2"]').attributes('data-selected')).toBe('true');
		await flushPromises();
		expect(currentPath()).toBe('/pricelist');
	});

	it('hledání přesune vykázání na viditelnou položku a panel lze zavřít', async () => {
		await vaultWithPricelist(
			item('p1', { name: 'Alfa' }),
			item('p2', {
				name: 'Beta',
				annualLimit: 160,
			}),
		);
		const c = await mountPricelist();
		await c.find('[data-testid="price-search"]').setValue('Beta');
		await vi.waitFor(() =>
			expect(c.find('[data-testid="price-item-p2"]').attributes('data-selected')).toBe('true'),
		);
		await openActions(c, 'p2');
		await layer().find('[data-testid="price-show-usage"]').trigger('click');
		expect(c.find('[data-testid="price-usage-title"]').text()).toBe('Beta');
		expect(c.find('[data-testid="price-fund"]').text()).toContain('160 hod');
		await c.find('[data-testid="price-close-usage"]').trigger('click');
		expect(c.find('[data-testid="price-usage"]').exists()).toBe(false);
	});

	it('řazení přepne pořadí položek v obou směrech', async () => {
		await vaultWithPricelist(item('p1', { name: 'Beta' }), item('p2', { name: 'Alfa' }));
		const c = await mountPricelist();
		expect(c.findAll('[data-testid="price-edit"]').map((link) => link.attributes('href'))).toEqual([
			'/pricelist/p2',
			'/pricelist/p1',
		]);
		await c.find('[data-testid="price-sort"]').trigger('click');
		expect(c.findAll('[data-testid="price-edit"]').map((link) => link.attributes('href'))).toEqual([
			'/pricelist/p1',
			'/pricelist/p2',
		]);
	});

	it('„Přidat položku" vede na novou položku', async () => {
		const c = await mountPricelist();
		expect(c.find('[data-testid="price-add"]').attributes('href')).toBe('/pricelist/new');
	});

	it('prázdný ceník to řekne slovy', async () => {
		const c = await mountPricelist();
		expect(c.find('[data-testid="empty-state"]').text()).toBe('Zatím prázdný ceník.');
	});

	it('vypíše položky i s cenou a jednotkou', async () => {
		await vaultWithPricelist(
			item('p1', {
				name: 'Konzultace',
				priceCents: 120_000,
				unit: 'hod',
			}),
		);
		const c = await mountPricelist();

		expect(c.findAll('[data-testid^="price-item-"]')).toHaveLength(1);
		expect(c.find('[data-testid="price-table"]').text()).toContain('Konzultace');
		expect(c.find('[data-testid="price-table"]').text()).toContain('hod');
	});

	it('poznámku ukazuje zvlášť pod názvem', async () => {
		await vaultWithPricelist(item('p1', { note: 'jen pro mě' }));
		const c = await mountPricelist();

		expect(c.find('[data-testid="price-note"]').text()).toBe('jen pro mě');
	});

	it('bez poznámky žádný řádek navíc nepřidává', async () => {
		await vaultWithPricelist(item('p1', { note: '   ' }));

		const c = await mountPricelist();
		expect(c.find('[data-testid="price-note"]').exists()).toBe(false);
	});

	it('počet položek hlásí ve stavovém řádku', async () => {
		await vaultWithPricelist(item('p1'), item('p2'));

		const c = await mountPricelist();
		expect(c.find('[data-testid="statusbar"]').text()).toContain('2 položky');
	});

	it('hledání zúží výpis podle názvu, poznámky a jednotky', async () => {
		await vaultWithPricelist(
			item('p1', {
				name: 'Konzultace',
				note: 'Strategie',
				unit: 'hod',
			}),
			item('p2', {
				name: 'Licence',
				note: 'Roční přístup',
				unit: 'kus',
			}),
		);
		const c = await mountPricelist();

		await c.find('[data-testid="price-search"]').setValue('strategie');
		await vi.waitFor(() => expect(c.findAll('[data-testid^="price-item-"]')).toHaveLength(1));

		expect(c.find('[data-testid="price-table"]').text()).toContain('Konzultace');
		expect(c.find('[data-testid="statusbar"]').text()).toContain('1 z 2 položek');
	});

	it('bez shody ukáže prázdný výsledek', async () => {
		await vaultWithPricelist(item('p1'));
		const c = await mountPricelist();

		await c.find('[data-testid="price-search"]').setValue('nic');
		await vi.waitFor(() =>
			expect(c.find('[data-testid="empty-state-filtered"]').text()).toBe('Žádné položky nenalezeny.'),
		);

		expect(c.find('[data-testid="price-table"]').exists()).toBe(false);
	});
});

describe('mazání', () => {
	it('popelnice se ptá a po potvrzení maže', async () => {
		await vaultWithPricelist(item('p1', { name: 'Konzultace' }));
		const c = await mountPricelist();

		await openActions(c);
		await layer().find('[data-testid="price-delete"]').trigger('click');
		await nextTick();

		expect(layer().find('[data-testid="dialog-message"]').text()).toContain('Konzultace');
		await answerDialog(true);

		expect(savedPricelist()).toEqual([]);
	});

	it('odmítnuté potvrzení nemaže', async () => {
		await vaultWithPricelist(item('p1'));
		const c = await mountPricelist();

		await openActions(c);
		await layer().find('[data-testid="price-delete"]').trigger('click');
		await answerDialog(false);

		expect(savedPricelist()).toHaveLength(1);
	});

	it('nepovedené smazání ohlásí a položku nechá ve výpisu', async () => {
		await vaultWithPricelist(item('p1', { name: 'Konzultace' }));
		const c = await mountPricelist();
		backend.breaks('write_data_file', 'disk je plný');

		await openActions(c);
		await layer().find('[data-testid="price-delete"]').trigger('click');
		await answerDialog(true);

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Položku se nepodařilo smazat',
				description: 'disk je plný',
				color: 'error',
			}),
		);
		expect(c.find('[data-testid="price-item-p1"]').exists()).toBe(true);
		expect(savedPricelist()).toHaveLength(1);
	});
});

describe('ikonka položky', () => {
	it('výpis kreslí ikonku položky', async () => {
		await vaultWithPricelist(item('p1', { icon: 'i-lucide-tree-palm' }));
		const c = await mountPricelist();

		expect(c.find('[data-testid="price-icon"]').classes()).toContain('i-lucide:tree-palm');
	});

	it('bez vlastní ikonky kreslí výchozí štítek', async () => {
		await vaultWithPricelist(item('p1'));
		const c = await mountPricelist();

		expect(c.find('[data-testid="price-icon"]').classes()).toContain('i-lucide:tag');
	});
});

describe('roční limit položky', () => {
	it('položka bez stropu má ve sloupci pomlčku, ne nulu', async () => {
		await vaultWithPricelist(item('p1'), item('p2', { annualLimit: 160 }));
		const c = await mountPricelist();

		expect(c.find('[data-testid="price-limit-p1"]').text()).toBe('Bez ročního limitu');
		expect(c.find('[data-testid="price-limit-p2"]').text()).toBe('Max. 160 hod / rok');
	});
});

describe('vykázání vybrané položky', () => {
	const VACATION = item('p1', {
		name: 'Konzultační činnost',
		note: 'dovolená',
		unit: 'hod',
		annualLimit: 160,
	});

	async function pick(c: VueWrapper) {
		await openActions(c);
		await layer().find('[data-testid="price-show-usage"]').trigger('click');
		await flushPromises();
		await nextTick();
	}

	it('bez vybrané položky pravý sloupec není', async () => {
		await vaultWithPricelist(VACATION);

		const c = await mountPricelist();
		expect(c.find('[data-testid="price-usage"]').exists()).toBe(false);
	});

	it('nová položka pravý sloupec nedostane', async () => {
		const c = await mountPricelist();
		await c.find('[data-testid="price-add"]').trigger('click');
		await flushPromises();

		expect(c.find('[data-testid="price-usage"]').exists()).toBe(false);
	});

	it('přepnutí roku přepočítá čerpání', async () => {
		await vaultWithUsage(VACATION, [
			{
				invoiceNumber: '20260001',
				quantity: 40,
			},
		]);
		documentWith(VACATION, '20250001', 96, yearOf(today()) - 1);
		const c = await mountPricelist();
		await pick(c);
		expect(c.find('[data-testid="price-fund"]').text()).toContain('40 hod');

		// Přepínač ročníku je `USelect`, tedy tlačítko s nabídkou — ne `<select>`.
		await pickFromListbox(c.find('[data-testid="price-usage-year"]'), String(yearOf(today()) - 1));

		expect(c.find('[data-testid="price-fund"]').text()).toContain('96 hod');
		expect(c.find('[data-testid="price-usage"]').text()).toContain(String(yearOf(today()) - 1));
	});

	it('přepínač roku nabídne letošek a dva roky zpátky, příští rok ne', async () => {
		await vaultWithUsage(VACATION, []);
		const c = await mountPricelist();
		await pick(c);

		await c.find('[data-testid="price-usage-year"]').trigger('click');
		await vi.waitFor(() => expect(layer().findAll('[role="option"]')).toHaveLength(3));

		const thisYear = yearOf(today());
		expect(
			layer()
				.findAll('[role="option"]')
				.map((o) => o.text()),
		).toEqual([String(thisYear), String(thisYear - 1), String(thisYear - 2)]);
	});

	it('karta vykázání nese ikonku vybrané položky', async () => {
		await vaultWithPricelist({
			...VACATION,
			icon: 'i-lucide-tree-palm',
		});
		const c = await mountPricelist();
		await pick(c);

		const heading = c.find('[data-testid="price-usage-title"]');
		expect(heading.find('[data-testid="price-usage-icon"]').exists()).toBe(true);
	});

	it('klik na položku ukáže, na kterých fakturách je', async () => {
		await vaultWithUsage(VACATION, [
			{
				invoiceNumber: '20260001',
				quantity: 40,
			},
			{
				invoiceNumber: '20260002',
				quantity: 24,
			},
		]);
		const c = await mountPricelist();
		await pick(c);

		const panel = c.find('[data-testid="price-usage"]');
		expect(panel.text()).toContain('20260001');
		expect(panel.text()).toContain('40 hod');
		expect(panel.text()).toContain('20260002');
	});

	it('kartu pojmenuje interní poznámkou', async () => {
		await vaultWithPricelist(VACATION);
		const c = await mountPricelist();
		await pick(c);

		expect(c.find('[data-testid="price-usage-title"]').text()).toContain('dovolená');
	});

	it('u hlídané položky ukáže vyčerpáno, zbytek i pás', async () => {
		await vaultWithUsage(VACATION, [
			{
				invoiceNumber: '20260001',
				quantity: 64,
			},
		]);
		const c = await mountPricelist();
		await pick(c);

		expect(c.find('[data-testid="price-fund"]').text()).toContain('64 hod');
		expect(c.find('[data-testid="price-fund"]').text()).toContain('96 hod');
		expect(c.find('[data-testid="price-bar-fill"]').exists()).toBe(true);
	});

	it.each([
		[144, 'bg-warning'],
		[160, 'bg-error'],
	] as const)('pás při čerpání %i hodin svítí barvou %s', async (quantity, colorClass) => {
		await vaultWithUsage(VACATION, [
			{
				invoiceNumber: '20260001',
				quantity,
			},
		]);
		const c = await mountPricelist();
		await openActions(c);
		await layer().find('[data-testid="price-show-usage"]').trigger('click');
		await nextTick();

		expect(c.find('[data-testid="price-bar-fill"] [role="progressbar"]').attributes('aria-valuenow')).toBe(
			String((quantity / 160) * 100),
		);
		expect(c.find('[data-testid="price-bar-fill"] [data-slot="indicator"]').classes()).toContain(colorClass);
		expect(c.find('[data-testid="price-fund"]').text()).toContain(`${quantity} hod`);
	});

	it('položka bez stropu pás nemá a řekne proč', async () => {
		await vaultWithUsage(item('p1', { name: 'Programování' }), [
			{
				invoiceNumber: '20260001',
				quantity: 16,
			},
		]);
		const c = await mountPricelist();
		await pick(c);

		expect(c.find('[data-testid="price-bar-fill"]').exists()).toBe(false);
		expect(c.find('[data-testid="price-usage"]').text()).toContain('Bez ročního limitu');
	});

	it('nikde nevykázaná položka to řekne slovy', async () => {
		await vaultWithPricelist(VACATION);
		const c = await mountPricelist();
		await pick(c);

		expect(c.find('[data-testid="price-usage"] [data-testid="empty-state"]').text()).toContain('nikde vykázaná');
	});

	it('zbytek limitu hlásí i stavový řádek', async () => {
		await vaultWithUsage(VACATION, [
			{
				invoiceNumber: '20260001',
				quantity: 64,
			},
		]);
		const c = await mountPricelist();
		await pick(c);

		expect(c.find('[data-testid="statusbar"]').text()).toContain('dovolená: zbývá 96 hod');
	});
});

describe('čerpání podle archivu', () => {
	const VACATION = item('p1', {
		note: 'dovolená',
		unit: 'hod',
		annualLimit: 160,
	});

	it('doklad smazaný ze složky z limitu ubírat přestane', async () => {
		await vaultWithUsage(VACATION, [
			{
				invoiceNumber: '20260009',
				quantity: 8,
			},
		]);
		backend.folder('/vault').invoices.delete('20260009');
		const c = await mountPricelist();
		await openActions(c);
		await layer().find('[data-testid="price-show-usage"]').trigger('click');
		await flushPromises();
		await nextTick();

		expect(c.find('[data-testid="price-usage-invoice"]').exists()).toBe(false);
		expect(c.find('[data-testid="price-fund"]').text()).toContain('0 hod');
	});

	it('nepovedené načtení dokladů ohlásí, že čerpání nemusí sedět', async () => {
		// Bez archivu se čerpání limitu nespočítá vůbec — mlčet o tom nesmí.
		backend.breaks('list_invoices', 'vault je nedostupný');
		const c = await mountPricelist();
		await flushPromises();

		expect(c.find('[data-testid="price-invoices-error"]').text()).toBe(
			'Doklady se nepodařilo načíst: vault je nedostupný',
		);
	});
});

describe('nepovedené načtení', () => {
	it('poškozená data ohlásí místo tvrzení, že je ceník prázdný', async () => {
		await expect(
			prepareVault({
				'nastaveni.json': {
					pricelist: 'rozbito',
				},
			}),
		).rejects.toThrow(
			new Error(
				'Soubor nastaveni.json má poškozený obsah (pricelist: Neplatný vstup: očekáváno pole, obdrženo řetězec).',
			),
		);
		const c = await mountPricelist();

		expect(c.find('[data-testid="empty-state-error"]').text()).toContain(
			'Došlo k chybě: Soubor nastaveni.json má poškozený obsah',
		);
	});
});
