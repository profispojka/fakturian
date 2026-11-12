import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { canDiscardUnsaved } from '~/composables/useForm';

import { backend } from '../setup/backend';
import { answerDialog, currentPath, goto, layer, mountPage } from '../setup/mount';
import { savedField, prepareVault } from '../setup/vault';

import type { PriceItem } from '~/schemas/pricelist';

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

beforeEach(async () => {
	await vaultWithPricelist();
});

describe('stránka položky ceníku', () => {
	it('jednotku ukáže u ceny jen vyplněnou', async () => {
		const c = await mountPage('/pricelist/new');

		await c.find('[data-testid="field-unit"]').setValue('hod');
		expect(c.find('[data-testid="price-unit"]').text()).toBe('/ hod');

		await c.find('[data-testid="field-unit"]').setValue(' ');
		expect(c.find('[data-testid="price-unit"]').exists()).toBe(false);
	});

	it('bez id zakládá novou položku', async () => {
		const c = await mountPage('/pricelist/new');

		expect(c.find('[data-testid="price-page-title"]').text()).toBe('Nová položka ceníku');
		await c.find('[data-testid="field-name"]').setValue('Konzultace');
		await c.find('[data-testid="field-note"]').setValue('jen pro mě');
		await c.find('[data-testid="field-price"]').setValue('1200');
		await c.find('[data-testid="field-price"]').trigger('blur');
		await c.find('[data-testid="field-unit"]').setValue('hod');
		await c.find('[data-testid="price-save"]').trigger('click');

		await vi.waitFor(() =>
			expect(savedPricelist()).toEqual([
				expect.objectContaining({
					name: 'Konzultace',
					note: 'jen pro mě',
					priceCents: 120_000,
					unit: 'hod',
				}),
			]),
		);
	});

	it('cena s desetinnou čárkou a mezerou mezi tisíci se uloží v haléřích', async () => {
		const c = await mountPage('/pricelist/new');
		await c.find('[data-testid="field-name"]').setValue('Konzultace');
		await c.find('[data-testid="field-price"]').setValue('1 200,50');
		await c.find('[data-testid="field-price"]').trigger('blur');
		await c.find('[data-testid="field-annualLimit"]').setValue('7,5');
		await c.find('[data-testid="field-annualLimit"]').trigger('blur');
		await c.find('[data-testid="price-save"]').trigger('click');

		await vi.waitFor(() =>
			expect(savedPricelist()).toEqual([
				expect.objectContaining({
					priceCents: 120_050,
					annualLimit: 7.5,
				}),
			]),
		);
	});

	it('id v adrese načte položku a uloží její úpravu', async () => {
		await vaultWithPricelist(
			item('p1', {
				name: 'Konzultace',
				annualLimit: 160,
			}),
		);
		const c = await mountPage('/pricelist/p1');

		expect(c.find('[data-testid="price-page-title"]').text()).toBe('Upravit položku ceníku');
		expect(c.find<HTMLInputElement>('[data-testid="field-name"]').element.value).toBe('Konzultace');
		await c.find('[data-testid="field-name"]').setValue('Konzultace senior');
		await c.find('[data-testid="field-annualLimit"]').setValue('');
		await c.find('[data-testid="field-annualLimit"]').trigger('blur');
		await c.find('[data-testid="price-save"]').trigger('click');

		await vi.waitFor(() =>
			expect(savedPricelist()).toEqual([
				item('p1', {
					name: 'Konzultace senior',
				}),
			]),
		);
		await vi.waitFor(() => expect(currentPath()).toBe('/pricelist'));
	});

	it('vymazaná cena se neuloží jako nula', async () => {
		await vaultWithPricelist(item('p1'));
		const c = await mountPage('/pricelist/p1');
		await c.find('[data-testid="field-price"]').setValue('');
		await c.find('[data-testid="field-price"]').trigger('blur');

		await c.find('[data-testid="price-save"]').trigger('click');
		await flushPromises();

		expect(savedPricelist()).toEqual([item('p1')]);
		expect(currentPath()).toBe('/pricelist/p1');
	});

	it('nová položka bez poznámky ji neuloží jako prázdný text', async () => {
		const c = await mountPage('/pricelist/new');
		await c.find('[data-testid="field-name"]').setValue('Konzultace');
		await c.find('[data-testid="price-save"]').trigger('click');

		await vi.waitFor(() => expect(savedPricelist()).toEqual([expect.objectContaining({ name: 'Konzultace' })]));
		expect(savedPricelist()[0]).not.toHaveProperty('note');
	});

	it('rozepsaná úprava nemění uloženou položku a zrušení se po potvrzení vrátí na výpis', async () => {
		await vaultWithPricelist(item('p1', { name: 'Konzultace' }));
		const c = await mountPage('/pricelist/p1');
		await c.find('[data-testid="field-name"]').setValue('Neuložený název');

		expect(savedPricelist()).toEqual([item('p1', { name: 'Konzultace' })]);
		await c.find('[data-testid="price-cancel"]').trigger('click');
		await answerDialog(true);
		await vi.waitFor(() => expect(currentPath()).toBe('/pricelist'));

		expect(savedPricelist()).toEqual([item('p1', { name: 'Konzultace' })]);
	});

	it('nepovedené uložení ohlásí a nechá rozepsaný formulář otevřený', async () => {
		await vaultWithPricelist(item('p1', { name: 'Konzultace' }));
		const c = await mountPage('/pricelist/p1');
		await c.find('[data-testid="field-name"]').setValue('Konzultace senior');
		backend.breaks('write_data_file', 'disk je plný');

		await c.find('[data-testid="price-save"]').trigger('click');
		await vi.waitFor(() =>
			expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
				expect.objectContaining({
					title: 'Položku se nepodařilo uložit',
					description: 'disk je plný',
					color: 'error',
				}),
			),
		);

		expect(currentPath()).toBe('/pricelist/p1');
		expect(c.find<HTMLInputElement>('[data-testid="field-name"]').element.value).toBe('Konzultace senior');
		expect(savedPricelist()).toEqual([item('p1', { name: 'Konzultace' })]);
	});

	it('odchod s rozepsanou položkou se ptá a odmítnutím se zůstane', async () => {
		const c = await mountPage('/pricelist/new');
		await c.find('[data-testid="field-name"]').setValue('Rozepsaná');

		const leaving = goto('/pricelist');
		await answerDialog(false);
		await leaving;

		expect(currentPath()).toBe('/pricelist/new');
	});

	it('bez změn se odchod neptá', async () => {
		await vaultWithPricelist(item('p1'));
		await mountPage('/pricelist/p1');

		await goto('/pricelist');

		expect(currentPath()).toBe('/pricelist');
		expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(false);
	});

	it('zavření okna s rozepsanou položkou se ptá', async () => {
		const c = await mountPage('/pricelist/new');
		await c.find('[data-testid="field-name"]').setValue('Rozepsaná');

		const closing = canDiscardUnsaved();
		await flushPromises();
		expect(layer().find('[data-testid="dialog-heading"]').text()).toBe('Zahodit neuložené změny?');

		await answerDialog(false);

		expect(await closing).toBe(false);
	});

	it('neznámé id ohlásí jako chybějící položku', async () => {
		const c = await mountPage('/pricelist/neexistuje');

		expect(c.find('[data-testid="empty-state"]').text()).toContain('v ceníku není');
		expect(c.find('[data-testid="price-fields"]').exists()).toBe(false);
	});

	it('Uložit je tlačítko, které mačká ⌘S', async () => {
		const c = await mountPage('/pricelist/new');

		expect(c.find('[data-testid="price-save"]').attributes('data-save')).toBe('');
	});

	it('u neznámého id je Uložit zamčené', async () => {
		const c = await mountPage('/pricelist/neexistuje');

		expect(c.find('[data-testid="price-save"]').attributes('disabled')).toBe('');
	});

	it('uloží ikonku a roční limit', async () => {
		const c = await mountPage('/pricelist/new');
		await c.find('[data-testid="field-name"]').setValue('Dovolená');
		await c.find('[data-testid="field-unit"]').setValue('hod');
		await c.find('[data-testid="field-annualLimit"]').setValue('160');
		await c.find('[data-testid="field-annualLimit"]').trigger('blur');
		await c.find('[data-testid="price-icon-trigger"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="price-icon-i-lucide-tree-palm"]').trigger('click');
		await c.find('[data-testid="price-save"]').trigger('click');
		await flushPromises();

		expect(savedPricelist()).toEqual([
			expect.objectContaining({
				icon: 'i-lucide-tree-palm',
				annualLimit: 160,
			}),
		]);
	});

	it('tlačítko Uložit odešle formulář', async () => {
		const c = await mountPage('/pricelist/new');
		await c.find('[data-testid="field-name"]').setValue('Z tlačítka');

		await c.find('[data-testid="price-save"]').trigger('click');

		await vi.waitFor(() => expect(savedPricelist()).toEqual([expect.objectContaining({ name: 'Z tlačítka' })]));
	});

	it('uložená ikonka je v hlavičce a v nabídce označená', async () => {
		await vaultWithPricelist(item('p1', { icon: 'i-lucide-tree-palm' }));
		const c = await mountPage('/pricelist/p1');
		const trigger = c.find('[data-testid="price-icon-trigger"]');
		expect(trigger.attributes('data-icon')).toBe('i-lucide-tree-palm');

		await trigger.trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="price-icon-i-lucide-tree-palm"]').attributes('data-selected')).toBe('true');
		expect(layer().find('[data-testid="price-icon-i-lucide-tag"]').attributes('data-selected')).toBeUndefined();
		expect(layer().find('[data-testid="price-icon-none"]').attributes('data-selected')).toBeUndefined();
	});

	it('výběr ikonky nabídku zavře a ukáže ikonku v hlavičce', async () => {
		const c = await mountPage('/pricelist/new');
		const trigger = c.find('[data-testid="price-icon-trigger"]');
		expect(trigger.attributes('data-icon')).toBe('i-lucide-tag');

		await trigger.trigger('click');
		await flushPromises();
		expect(layer().find('[data-testid="price-icon-none"]').attributes('data-selected')).toBe('true');
		await layer().find('[data-testid="price-icon-i-lucide-camera"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="price-icon-picker"]').exists()).toBe(false);
		expect(trigger.attributes('data-icon')).toBe('i-lucide-camera');
	});

	it('volba Bez ikony ikonku odstraní', async () => {
		await vaultWithPricelist(item('p1', { icon: 'i-lucide-tree-palm' }));
		const c = await mountPage('/pricelist/p1');

		await c.find('[data-testid="price-icon-trigger"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="price-icon-none"]').trigger('click');
		await flushPromises();
		expect(c.find('[data-testid="price-icon-trigger"]').attributes('data-icon')).toBe('i-lucide-tag');

		await c.find('[data-testid="field-name"]').setValue('Konzultace');
		await c.find('[data-testid="price-save"]').trigger('click');

		await vi.waitFor(() => expect(savedPricelist()).toEqual([expect.objectContaining({ name: 'Konzultace' })]));
		expect(savedPricelist()).toEqual([expect.not.objectContaining({ icon: expect.anything() })]);
	});

	it.each(['0', '-5'])('limit %s neuloží a řekne proč', async (value) => {
		const c = await mountPage('/pricelist/new');
		await c.find('[data-testid="field-name"]').setValue('Dovolená');
		await c.find('[data-testid="field-annualLimit"]').setValue(value);
		await c.find('[data-testid="field-annualLimit"]').trigger('blur');

		await c.find('[data-testid="price-save"]').trigger('click');

		await vi.waitFor(() =>
			expect(c.find('[data-testid="annual-limit-field"] [data-slot="error"]').text()).toBe('Zadej číslo > 0.'),
		);
		expect(savedPricelist()).toEqual([]);
	});
});
