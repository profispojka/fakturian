import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { h, reactive } from 'vue';

import { useVault } from '~/composables/useVault';
import { MENU } from '~/constants/palette';
import Default from '~/layouts/default.vue';
import { newInvoice } from '~/schemas/invoices';
import { emptySupplier } from '~/schemas/suppliers';
import { today } from '~/utils/date';

import { backend, wireInvoice } from '../setup/backend';
import { mountUi, currentPath, goto, layer } from '../setup/mount';
import { prepareVault } from '../setup/vault';

import type { Contact } from '~/schemas/customers';
import type { Expense } from '~/schemas/expenses';
import type { PriceItem } from '~/schemas/pricelist';
import type { Supplier } from '~/schemas/suppliers';

/**
 * Levý panel nad **skutečnou** složkou: odznáčky se počítají z toho, co ve vaultu leží, ne z
 * dosazených čísel.
 */
const { useColorModeMock } = vi.hoisted(() => ({ useColorModeMock: vi.fn() }));

mockNuxtImport('useColorMode', () => useColorModeMock);

let colorMode: { value: string; preference: string };

async function mount(path = '/') {
	await goto(path);
	const c = mountUi(Default);
	await flushPromises();
	return c;
}

function sections(c: Awaited<ReturnType<typeof mount>>, to: string) {
	return c.find(`[data-testid="menu-section${to}"]`);
}

function badge(c: Awaited<ReturnType<typeof mount>>, to: string): string {
	const mark = sections(c, to).find('[data-testid="menu-badge"]');
	return mark.exists() ? mark.text() : '';
}

function badgeLabel(c: Awaited<ReturnType<typeof mount>>, to: string): string | undefined {
	return sections(c, to).find('[data-testid="menu-badge"]').attributes('title');
}

function selectedSections(c: Awaited<ReturnType<typeof mount>>) {
	return c.findAll('[data-testid^="menu-section"]').filter((r) => r.attributes('aria-current') === 'page');
}

async function vaultS(
	content: {
		supplier?: Supplier | null;
		contacts?: Contact[];
		pricelist?: PriceItem[];
		expenses?: Expense[];
		invoices?: { number: string; totalCents: number }[];
	} = {},
): Promise<void> {
	await prepareVault({
		'nastaveni.json': {
			supplier:
				content.supplier === undefined
					? {
							...emptySupplier(),
							name: 'Jan Novák',
							ico: '12345679',
						}
					: content.supplier,
			contacts: content.contacts ?? [],
			pricelist: content.pricelist ?? [],
		},
		'vydaje.json': {
			expenses: content.expenses ?? [],
		},
	});
	for (const f of content.invoices ?? []) {
		const inv = newInvoice(null, f.number);
		inv.issueDate = today();
		inv.dueDate = today();
		inv.lines = [
			{
				id: 'r1',
				description: 'Práce',
				quantity: 1,
				unit: 'ks',
				unitPriceCents: f.totalCents,
			},
		];
		backend.folder('/vault').invoices.set(f.number, wireInvoice(inv));
	}
}

function contact(id: string): Contact {
	return {
		id,
		name: `Odběratel ${id}`,
		ico: '27082440',
		address: {
			street: 'Dlouhá 1',
			city: 'Praha',
			zip: '11000',
		},
	};
}

beforeEach(async () => {
	colorMode = reactive({
		value: 'light',
		preference: 'system',
	});
	useColorModeMock.mockReturnValue(colorMode);
	await vaultS();
});

describe('hlavička panelu', () => {
	it('ukáže jméno firmy a IČO', async () => {
		const c = await mount();

		expect(c.text()).toContain('Jan Novák');
		expect(c.text()).toContain('12345679');
		expect(c.find('[data-testid="menu-avatar"]').text()).toBe('JN');
	});

	it('klikem na IČO se zkopíruje', async () => {
		const c = await mount();

		await c.find('[data-testid="menu-ico"]').trigger('click');
		await flushPromises();

		expect(await navigator.clipboard.readText()).toBe('12345679');
	});

	it('bez vyplněného IČO se čip nenabízí', async () => {
		await vaultS({
			supplier: {
				...emptySupplier(),
				name: 'Bez IČO',
				ico: '',
			},
		});
		const c = await mount();

		expect(c.find('[data-testid="menu-ico"]').exists()).toBe(false);
		expect(c.text()).toContain('Bez IČO');
	});

	it('klik na čip po zmizení IČO nic nekopíruje', async () => {
		const c = await mount();
		const chip = c.find('[data-testid="menu-ico"]');
		const write = vi.spyOn(navigator.clipboard, 'write');

		await vaultS({
			supplier: {
				...emptySupplier(),
				name: 'Jan Novák',
				ico: '',
			},
		});
		await chip.trigger('click');
		await flushPromises();

		expect(write).not.toHaveBeenCalled();
	});
});

describe('navigace', () => {
	it('vypíše všechny sekce', async () => {
		const c = await mount();

		for (const row of MENU.flat()) expect(c.text()).toContain(row.label);
	});

	it('zvýrazní právě jeden řádek', async () => {
		const c = await mount('/invoice');

		expect(selectedSections(c)).toHaveLength(1);
	});

	it.each([
		['/invoice/new', '/invoice'],
		['/invoice/20260001', '/invoice'],
		['/expense/new', '/expense'],
		['/expense/v1', '/expense'],
		['/customers/new', '/customers'],
		['/customers/k1', '/customers'],
		['/pricelist/new', '/pricelist'],
		['/pricelist/p1', '/pricelist'],
	])('formulář %s svítí u sekce %s', async (form, section) => {
		const c = await mount(form);
		const active = selectedSections(c)[0]!;

		expect(active.attributes('href')).toBe(section);
	});
});

describe('odznáčky u sekcí', () => {
	it('bez dat se nekreslí žádný odznáček', async () => {
		const c = await mount();

		expect(c.findAll('[data-testid="menu-badge"]')).toHaveLength(0);
	});

	it('nezaplacené doklady hlásí u Faktur', async () => {
		await vaultS({
			invoices: [1, 2, 3].map((i) => ({
				number: `2026000${i}`,
				totalCents: 121_000,
			})),
		});
		const c = await mount();

		expect(badge(c, '/invoice')).toBe('3');
	});

	it('výdaje za měsíc hlásí částkou', async () => {
		await vaultS({
			expenses: [
				{
					id: 'v1',
					supplier: 'S',
					description: '',
					amountCents: 12_480_00,
					date: today(),
				},
			],
		});
		const c = await mount();

		expect(badge(c, '/expense')).toContain('Kč');
	});

	it('odběratelé ani ceník odznak nemají', async () => {
		await vaultS({
			contacts: [1, 2, 3, 4, 5].map((i) => contact(`k${i}`)),
			pricelist: [1, 2, 3, 4].map((i) => ({
				id: `p${i}`,
				name: `Položka ${i}`,
				priceCents: 10_000,
				unit: 'ks',
			})),
		});
		const c = await mount();

		expect(badge(c, '/customers')).toBe('');
		expect(badge(c, '/pricelist')).toBe('');
	});

	it('odznáček má vysvětlující popisek', async () => {
		await vaultS({
			invoices: [1, 2, 3].map((i) => ({
				number: `2026000${i}`,
				totalCents: 121_000,
			})),
		});
		const c = await mount();

		expect(badgeLabel(c, '/invoice')).toBe('Nezaplacené doklady');
	});
});

describe('stav dokladů v panelu', () => {
	it('fakturaci ukáže jen odznáčkem bez karty grafu', async () => {
		await vaultS({
			invoices: [
				{
					number: '20260001',
					totalCents: 45_000_00,
				},
			],
		});
		const c = await mount();

		expect(c.find('[data-testid="menu-card"]').exists()).toBe(false);
		expect(c.find('[data-testid="menu-section/invoice"]').find('[data-testid="menu-badge"]').text()).toBe('1');
	});

	it('nepovedené čtení dokladů ohlásí toastem', async () => {
		backend.breaks('list_invoices', 'vault je nedostupný');
		await mount();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Doklady se nepodařilo načíst',
				description: 'vault je nedostupný',
				color: 'error',
			}),
		);
	});
});

describe('rychlé „nové"', () => {
	it('nabídka se otevře a zavře tlačítkem', async () => {
		const c = await mount();
		expect(c.find('[data-testid="menu-new"]').text()).toContain('Vytvořit');
		expect(c.find('[data-testid="menu-new"]').text()).toBe('Vytvořit ⌘N');

		await c.find('[data-testid="menu-new"]').trigger('click');
		expect(c.find('[data-testid="menu-new"]').attributes('aria-expanded')).toBe('true');

		await c.find('[data-testid="menu-new"]').trigger('click');
		expect(c.find('[data-testid="menu-new"]').attributes('aria-expanded')).toBe('false');
	});

	it('otevření palety příkazů zavře nabídku vytváření', async () => {
		const c = await mount();
		await c.find('[data-testid="menu-new"]').trigger('click');
		await flushPromises();
		expect(c.find('[data-testid="menu-new"]').attributes('aria-expanded')).toBe('true');

		useState<boolean>('paletteOpen').value = true;
		await flushPromises();

		expect(c.find('[data-testid="menu-new"]').attributes('aria-expanded')).toBe('false');
		expect(layer().find('[data-testid="menu-new-invoice"]').exists()).toBe(false);
	});

	it('výběrem se spustí zakládání a nabídka se zavře', async () => {
		const c = await mount();
		await c.find('[data-testid="menu-new"]').trigger('click');

		await vi.waitFor(() => expect(layer().find('[data-testid="menu-new-invoice"]').exists()).toBe(true));
		await layer().find('[data-testid="menu-new-invoice"]').trigger('click');
		await vi.waitFor(() => expect(currentPath()).toBe('/invoice/new'));

		expect(c.find('[data-testid="menu-new"]').attributes('aria-expanded')).toBe('false');
	});

	it('klik mimo nabídku ji zavře', async () => {
		const c = await mount();
		await c.find('[data-testid="menu-new"]').trigger('click');

		await flushPromises();
		await c.find('[data-testid="menu-ico"]').trigger('pointerdown');
		await flushPromises();

		expect(c.find('[data-testid="menu-new"]').attributes('aria-expanded')).toBe('false');
	});
});

describe('datová složka', () => {
	const pageSlot = {
		default: () =>
			h(
				'p',
				{
					'data-testid': 'page-slot',
				},
				'stránka',
			),
	};

	async function mountWithPage(path = '/') {
		await goto(path);
		const c = mountUi(Default, { slots: pageSlot });
		await flushPromises();
		return c;
	}

	it('se zvolenou složkou vykreslí stránku', async () => {
		const c = await mountWithPage();

		expect(c.find('[data-testid="page-slot"]').exists()).toBe(true);
		expect(c.find('[data-testid="vault-empty"]').exists()).toBe(false);
	});

	it('bez zvolené složky nabídne místo stránky průvodce', async () => {
		const vault = useNuxtApp().vueApp.runWithContext(useVault);
		vault.vaultPath.value = null;
		vault.ready.value = true;
		const c = await mountWithPage();

		expect(c.find('[data-testid="vault-empty"]').exists()).toBe(true);
		expect(c.find('[data-testid="page-slot"]').exists()).toBe(false);
		expect(c.find('[data-testid="vault-page-title"]').text()).toBe('Datová složka');
	});

	it('než se zapamatovaná složka přečte, netvrdí, že žádná není', async () => {
		const vault = useNuxtApp().vueApp.runWithContext(useVault);
		vault.vaultPath.value = null;
		vault.ready.value = false;
		const c = await mountWithPage();

		expect(c.find('[data-testid="vault-empty"]').exists()).toBe(false);
		expect(c.find('[data-testid="page-slot"]').exists()).toBe(false);
	});

	it('Nastavení se vykreslí i bez složky', async () => {
		useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value = null;
		const c = await mountWithPage('/settings');

		expect(c.find('[data-testid="page-slot"]').exists()).toBe(true);
		expect(c.find('[data-testid="vault-empty"]').exists()).toBe(false);
	});

	it('Integrace se vykreslí i bez složky', async () => {
		useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value = null;
		const c = await mountWithPage('/integrations');

		expect(c.find('[data-testid="page-slot"]').exists()).toBe(true);
	});
});
