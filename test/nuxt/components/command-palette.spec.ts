import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useState } from '#app';
import CommandPalette from '~/components/CommandPalette.vue';
import { MENU } from '~/constants/palette';

import { backend } from '../setup/backend';
import { summary } from '../setup/fixtures';
import { mountUi, currentPath, layer } from '../setup/mount';
import { documentInVault, prepareVault } from '../setup/vault';

import type { Contact } from '~/schemas/customers';
import type { PriceItem } from '~/schemas/pricelist';

/** Paleta se otevírá sdíleným stavem — testy ji musí otevřít stejnou cestou. */
function open(value = true) {
	useState<boolean>('paletteOpen', () => false).value = value;
}

async function openPalette() {
	const c = mountUi(CommandPalette);
	open();
	await flushPromises();
	return c;
}

function contact(id: string, name: string): Contact {
	return {
		id,
		name,
		ico: '27082440',
		address: {
			street: 'Dlouhá 1',
			city: 'Praha',
			zip: '11000',
		},
	};
}

function pricelistItem(id: string, name: string): PriceItem {
	return {
		id,
		name,
		priceCents: 120_000,
		unit: 'hod',
	};
}

function group(name: string) {
	return layer()
		.findAll('[role="group"]')
		.find((g) => g.find('[data-slot="label"]').text() === name);
}

function items(name: string) {
	return group(name)?.findAll('[role="option"]') ?? [];
}

async function vaultS(content: { invoices?: string[]; contacts?: Contact[]; pricelist?: PriceItem[] } = {}) {
	await prepareVault({
		'nastaveni.json': {
			supplier: null,
			contacts: content.contacts ?? [],
			pricelist: content.pricelist ?? [],
		},
	});
	for (const number of content.invoices ?? []) documentInVault(summary(number));
}

beforeEach(async () => {
	await vaultS();
});

describe('nabídka akcí', () => {
	it('nabízí všechny sekce ze sidebaru', async () => {
		await openPalette();
		const action = group('Akce')!.text();

		for (const sec of MENU.flat().filter((row) => row.type !== 'label')) expect(action).toContain(sec.label);
	});

	it('nabízí „Nová faktura" jako samostatnou akci', async () => {
		await openPalette();

		expect(group('Akce')!.text()).toContain('Nová faktura');
	});

	it('výběr sekce zavře paletu a přejde na ni', async () => {
		await openPalette();

		await items('Akce')[0]!.trigger('click');

		await vi.waitFor(() => expect(currentPath()).toBe('/'));
		expect(useState<boolean>('paletteOpen', () => false).value).toBe(false);
	});
});

describe('faktury v paletě', () => {
	it('zavřená paleta faktury vůbec nečte', () => {
		mountUi(CommandPalette);

		expect(backend.args('list_invoices')).toEqual([]);
	});

	it('otevřením se seznam načte a nabídne', async () => {
		await vaultS();
		documentInVault(summary('20260001', { customer: 'Studio Mráz' }));
		await openPalette();

		expect(backend.args('list_invoices')).toHaveLength(1);
		expect(group('Faktury')!.text()).toContain('20260001');
		expect(group('Faktury')!.text()).toContain('Studio Mráz');
	});

	it('nabídne i víc než dvanáct faktur', async () => {
		await vaultS({
			invoices: Array.from(
				{
					length: 20,
				},
				(_, i) => `2026${String(i).padStart(4, '0')}`,
			),
		});
		await openPalette();

		expect(items('Faktury')).toHaveLength(20);
	});

	it('výběr faktury ji předá formuláři a přejde na něj', async () => {
		await vaultS({ invoices: ['20260001'] });
		await openPalette();

		await items('Faktury')[0]!.trigger('click');

		await vi.waitFor(() => expect(currentPath()).toBe('/invoice/20260001'));
	});

	it('další otevření vezme faktury z paměti, dokud je zápis přes appku nezahodí', async () => {
		await vaultS({ invoices: ['20260001'] });
		await openPalette();
		expect(items('Faktury')).toHaveLength(1);

		open(false);
		await flushPromises();
		await vaultS({ invoices: ['20260002', '20260003'] });
		open();
		await flushPromises();

		expect(items('Faktury')).toHaveLength(1);
		expect(backend.args('list_invoices')).toHaveLength(1);

		open(false);
		await flushPromises();
		useNuxtApp().vueApp.runWithContext(useInvoices).forgetArchive();
		open();
		await flushPromises();

		expect(group('Faktury')!.text()).not.toContain('20260001');
		expect(items('Faktury')).toHaveLength(2);
	});

	it('selhání čtení faktur paletu neshodí', async () => {
		backend.breaks('list_invoices', 'vault je nedostupný');
		await openPalette();

		expect(items('Faktury')).toHaveLength(0);
		expect(group('Akce')!.text()).toContain('Nová faktura');
		expect(layer().find('[data-testid="palette-invoices-error"]').text()).toBe(
			'Faktury se nepodařilo načíst: vault je nedostupný',
		);
	});

	it('další otevření po opravě chybu nehlásí', async () => {
		backend.breaks('list_invoices', 'vault je nedostupný');
		await openPalette();
		open(false);
		await flushPromises();

		backend.repairs('list_invoices');
		open();
		await flushPromises();

		expect(layer().find('[data-testid="palette-invoices-error"]').exists()).toBe(false);
		expect(layer().find('[data-testid="palette-footer"]').text()).toContain('Procházet');
	});
});

describe('odběratelé a ceník', () => {
	it('nabízí odběratele a otevře jeho kartu', async () => {
		await vaultS({ contacts: [contact('k1', 'Studio Mráz')] });
		await openPalette();

		expect(group('Odběratelé')!.text()).toContain('Studio Mráz');
		await items('Odběratelé')[0]!.trigger('click');
		await vi.waitFor(() => expect(currentPath()).toBe('/customers/k1'));
	});

	it('nabízí položky ceníku a otevře položku', async () => {
		await vaultS({ pricelist: [pricelistItem('p1', 'Konzultace')] });
		await openPalette();

		expect(group('Ceník')!.text()).toContain('Konzultace');
		await items('Ceník')[0]!.trigger('click');
		await vi.waitFor(() => expect(currentPath()).toBe('/pricelist/p1'));
	});

	it('najde položku i bez napsané diakritiky', async () => {
		await vaultS({ contacts: [contact('k1', 'Studio Mráz')] });
		await openPalette();

		await layer().find('[data-testid="palette-search"]').setValue('mraz');

		await vi.waitFor(() => expect(group('Odběratelé')!.text()).toContain('Studio Mráz'));
	});
});

describe('prázdný stav a klávesy', () => {
	it('spodní tlačítko otevře vyhledaný příkaz', async () => {
		await openPalette();
		await layer().find('[data-testid="palette-search"]').setValue('Ceník');
		await vi.waitFor(() => {
			expect(items('Akce')).toHaveLength(1);
			expect(layer().find('[data-testid="palette-open"]').attributes('disabled')).toBeUndefined();
		});
		await layer().find('[data-testid="palette-open"]').trigger('click');
		await vi.waitFor(() => expect(currentPath()).toBe('/pricelist'));
		expect(useState<boolean>('paletteOpen', () => false).value).toBe(false);
	});

	it('zvýrazněný řádek, který z nabídky zmizí, už spodní tlačítko neotevře', async () => {
		await vaultS({ contacts: [contact('k1', 'Studio Mráz')] });
		await openPalette();
		await layer().find('[data-testid="palette-search"]').setValue('Studio Mráz');
		await vi.waitFor(() =>
			expect(layer().find('[data-testid="palette-open"]').attributes('disabled')).toBeUndefined(),
		);

		await useContacts().remove('k1');

		await vi.waitFor(() => expect(layer().find('[data-testid="palette-open"]').attributes('disabled')).toBe(''));
		expect(currentPath()).toBe('/');
	});

	it('bez výsledků nelze otevřít předchozí příkaz a tlačítko Zavřít paletu zavře', async () => {
		await openPalette();
		await layer().find('[data-testid="palette-search"]').setValue('qwertzuiop');
		await vi.waitFor(() => {
			expect(layer().text()).toContain('Nic nenalezeno');
			expect(layer().find('[data-testid="palette-open"]').attributes('disabled')).toBe('');
		});
		await layer().find('[data-testid="palette-close"]').trigger('click');
		expect(useState<boolean>('paletteOpen', () => false).value).toBe(false);
		expect(currentPath()).toBe('/');
	});

	it('bez jakýchkoli položek řekne, že nic nenašla', async () => {
		await openPalette();

		await layer().find('[data-testid="palette-search"]').setValue('qwertzuiop');

		// Hledání běží mimo tik vykreslení, takže se na výsledek čeká, ne hádá.
		await vi.waitFor(() => expect(layer().text()).toContain('Nic nenalezeno'));
	});

	it('Esc paletu zavře i ve sdíleném stavu', async () => {
		await openPalette();
		expect(layer().find('[data-testid="palette-search"]').exists()).toBe(true);

		document.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'Escape',
				bubbles: true,
			}),
		);
		await flushPromises();

		expect(useState<boolean>('paletteOpen', () => false).value).toBe(false);
	});

	it('patka ukazuje klávesy k ovládání', async () => {
		await openPalette();
		const footer = layer().find('[data-testid="palette-footer"]').text();

		expect(footer).toContain('Procházet');
		expect(footer).toContain('Otevřít');
		expect(footer).toContain('Zavřít');
	});

	it('výběr „Nová faktura" vede na prázdný formulář', async () => {
		await openPalette();
		const nova = items('Akce').find((b) => b.text() === 'Nová faktura');

		await nova!.trigger('click');
		await vi.waitFor(() => expect(currentPath()).toBe('/invoice/new'));
	});
});

describe('hledaný výraz', () => {
	it('otevření vyprázdní, co se hledalo minule', async () => {
		await openPalette();

		await layer().find('[data-testid="palette-search"]').setValue('faktura');
		expect(layer().find<HTMLInputElement>('[data-testid="palette-search"]').element.value).toBe('faktura');

		open(false);
		await flushPromises();
		open();
		await flushPromises();

		expect(layer().find<HTMLInputElement>('[data-testid="palette-search"]').element.value).toBe('');
	});
});
