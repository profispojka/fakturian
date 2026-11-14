import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

import App from '~/app.vue';
import { MCP_MESSAGE_EVENT } from '~/bindings';
import InvoiceContactPicker from '~/components/invoice/ContactPicker.vue';
import { useVault } from '~/composables/useVault';
import { emptySupplier, type Supplier } from '~/schemas/suppliers';
import { NOT_DESKTOP_MESSAGE } from '~/utils/desktop';

import { backend, outsideDesktop } from '../setup/backend';
import { completeSupplier } from '../setup/fixtures';
import { mountUi, currentPath, focusSvgIcon, shortcut } from '../setup/mount';

async function mount() {
	// Stránky mají vlastní specy a potřebují data i náhrady, o které tady nejde.
	const c = mountUi(App, {
		global: {
			stubs: {
				NuxtPage: true,
			},
		},
	});
	await flushPromises();
	return c;
}

// Stránka jen s tlačítkem Uložit; zaznamená, kde byl fokus v okamžiku stisku.
function mountSaveButton(attrs: { disabled?: boolean } = {}) {
	const pressed = vi.fn<(focused: Element | null) => void>();
	mountUi(
		defineComponent({
			setup: () => () =>
				h('button', {
					type: 'button',
					'data-save': '',
					...attrs,
					onClick: () => pressed(document.activeElement),
				}),
		}),
	);
	return pressed;
}

function wizardOpened() {
	return useState('vaultWizardOpen', () => false).value;
}

function paletteOpen() {
	return useState('paletteOpen', () => false).value;
}

function rememberedFolder(supplier: Supplier | null = completeSupplier()): void {
	backend.create('/vault');
	backend.writeFile('/vault', 'nastaveni.json', {
		supplier: supplier,
		contacts: [],
		pricelist: [],
	});
	backend.store.set('vaultPath', '/vault');
	backend.mcp.socket = '/tmp/fakturian-test.sock';
}

function withoutRememberedFolder(): void {
	backend.store.delete('vaultPath');
}

/** Složku někdo přesunul nebo odpojil disk; appka si pamatuje cestu, na které nic není. */
function folderGone(): void {
	backend.folders.delete('/vault');
}

beforeEach(() => {
	rememberedFolder();
});
describe('start mimo desktopovou appku', () => {
	it('řekne, že jde o desktopovou appku, a data vůbec nenačítá', async () => {
		outsideDesktop();
		const c = await mount();

		expect(c.find('[data-testid="start-note"]').text()).toContain(NOT_DESKTOP_MESSAGE);
		expect(useNuxtApp().vueApp.runWithContext(useVault).ready.value).toBe(false);
		expect(backend.args('read_data_file')).toEqual([]);
	});

	it('mimo desktopovou appku neotevírá ani průvodce', async () => {
		outsideDesktop();
		await mount();

		expect(wizardOpened()).toBe(false);
	});
});

describe('načtení dat po startu', () => {
	it('inicializuje vault a načte data', async () => {
		await mount();

		expect(useNuxtApp().vueApp.runWithContext(useVault).ready.value).toBe(true);
		expect(backend.args('read_data_file')).toEqual([
			{
				vaultPath: '/vault',
				name: 'nastaveni.json',
			},
			{
				vaultPath: '/vault',
				name: 'platby.json',
			},
			{
				vaultPath: '/vault',
				name: 'vydaje.json',
			},
		]);
		expect(backend.args('list_invoices')).toContainEqual({ vaultPath: '/vault' });
	});

	it('bez zvolené složky se data nenačítají', async () => {
		withoutRememberedFolder();
		await mount();

		expect(useNuxtApp().vueApp.runWithContext(useVault).ready.value).toBe(true);
		expect(backend.args('read_data_file')).toEqual([]);
	});

	it('vadný soubor ukáže místo stránky a nenabízí začít načisto', async () => {
		backend.breaks('read_data_file', 'vydaje.json má poškozený obsah');
		const c = await mount();

		const screen = c.find('[data-testid="start-error"]').text();
		expect(screen).toContain('Data ve složce nejdou načíst');
		expect(screen).toContain('poškozený obsah');
		expect(screen).toContain('Složka i doklady v ní jsou na místě.');
		expect(c.find('[data-testid="start-error-fresh"]').exists()).toBe(false);
		expect(c.find('[data-testid="start-error-retry"]').exists()).toBe(true);
		expect(c.find('[data-testid="menu-new"]').exists()).toBe(false);
	});

	it('chybějící složku ohlásí dřív, než z ní začne číst', async () => {
		folderGone();
		const c = await mount();

		const screen = c.find('[data-testid="start-error"]').text();
		expect(screen).toContain('Datová složka není na svém místě');
		expect(screen).toContain('Datová složka /vault neexistuje.');
		expect(screen).toContain('Pokud jsi složku přesunul nebo přejmenoval');
		expect(c.find('[data-testid="start-error-fresh"]').exists()).toBe(true);
		expect(c.find('[data-testid="start-error-retry"]').exists()).toBe(false);
		expect(backend.args('read_data_file')).toEqual([]);
	});

	it('po chybě načtení průvodce neotevírá', async () => {
		backend.breaks('read_data_file', 'rozbitý vault');
		await mount();

		expect(wizardOpened()).toBe(false);
	});

	it('bez složky na místě průvodce neotevírá', async () => {
		folderGone();
		await mount();

		expect(wizardOpened()).toBe(false);
	});
});

describe('cesta ven z obrazovky vadných dat', () => {
	it('po opravě souboru se appka na „Zkusit znovu“ rozjede', async () => {
		backend.breaks('read_data_file', 'vydaje.json má poškozený obsah');
		const c = await mount();
		backend.repairs('read_data_file');

		await c.find('[data-testid="start-error-retry"]').trigger('click');
		await flushPromises();

		expect(c.find('[data-testid="start-error"]').exists()).toBe(false);
		await vi.waitFor(() => expect(c.find('[data-testid="menu-new"]').exists()).toBe(true));
		expect(wizardOpened()).toBe(false);
	});

	it('nad stále vadným souborem zůstane hláška', async () => {
		backend.breaks('read_data_file', 'vydaje.json má poškozený obsah');
		const c = await mount();

		await c.find('[data-testid="start-error-retry"]').trigger('click');
		await flushPromises();

		expect(c.find('[data-testid="start-error"]').text()).toContain('poškozený obsah');
		expect(wizardOpened()).toBe(false);
	});

	it('složka, která mezitím zmizela, se ohlásí jako chybějící', async () => {
		backend.breaks('read_data_file', 'vydaje.json má poškozený obsah');
		const c = await mount();
		folderGone();

		await c.find('[data-testid="start-error-retry"]').trigger('click');
		await flushPromises();

		expect(c.find('[data-testid="start-error"]').text()).toContain('Datová složka není na svém místě');
		expect(c.find('[data-testid="start-error-fresh"]').exists()).toBe(true);
	});

	it('jiná složka se zapamatuje a appka se s ní načte znovu', async () => {
		backend.breaks('read_data_file', 'vydaje.json má poškozený obsah');
		const replace = vi.spyOn(window.location, 'replace');
		const c = await mount();
		backend.create('/nova');
		backend.dialog.push('/nova');

		await c.find('[data-testid="start-error-pick"]').trigger('click');
		await flushPromises();

		expect(backend.store.get('vaultPath')).toBe('/nova');
		expect(replace).toHaveBeenCalledWith('/');
	});

	it('nepovedený výběr jiné složky nechá obrazovku vadných dat', async () => {
		backend.breaks('read_data_file', 'vydaje.json má poškozený obsah');
		const c = await mount();
		backend.dialog.push('/jenpro-cteni');
		backend.breaks('ensure_vault', 'do složky nejde zapisovat');

		await c.find('[data-testid="start-error-pick"]').trigger('click');
		await flushPromises();

		const screen = c.find('[data-testid="start-error"]').text();
		expect(screen).toContain('Data ve složce nejdou načíst');
		expect(screen).toContain('do složky nejde zapisovat');
	});
});

describe('cesta ven z obrazovky chybějící složky', () => {
	it('vybraná složka se zapamatuje a appka se s ní načte znovu', async () => {
		folderGone();
		const replace = vi.spyOn(window.location, 'replace');
		const c = await mount();
		backend.create('/nova');
		backend.dialog.push('/nova');

		await c.find('[data-testid="start-error-pick"]').trigger('click');
		await flushPromises();

		expect(backend.store.get('vaultPath')).toBe('/nova');
		expect(replace).toHaveBeenCalledWith('/');
	});

	it('zrušený výběr nechá obrazovku na místě', async () => {
		folderGone();
		const c = await mount();
		backend.dialog.push(null);

		await c.find('[data-testid="start-error-pick"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value).toBe('/vault');
		expect(c.find('[data-testid="start-error"]').text()).toContain('neexistuje');
	});

	it('bez přečtené cesty se vybraná složka rovnou načte a appka se rozjede', async () => {
		backend.breaks('load_vault_path', 'fakturian.json nejde přečíst');
		const c = await mount();
		backend.create('/nova');
		backend.writeFile('/nova', 'nastaveni.json', {
			supplier: completeSupplier(),
			contacts: [],
			pricelist: [],
		});
		backend.dialog.push('/nova');

		await c.find('[data-testid="start-error-pick"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value).toBe('/nova');
		expect(c.find('[data-testid="start-error"]').exists()).toBe(false);
		// Layout je asynchronní komponenta pod `Suspense` a dotáhne se až po dalším makrotasku.
		await vi.waitFor(() => expect(c.find('[data-testid="menu-new"]').exists()).toBe(true));
		expect(wizardOpened()).toBe(false);
	});

	it('když má nová složka vadný soubor, ukáže se obrazovka vadných dat', async () => {
		backend.breaks('load_vault_path', 'fakturian.json nejde přečíst');
		const c = await mount();
		backend.create('/nova');
		backend.dialog.push('/nova');
		backend.breaks('read_data_file', 'vydaje.json má poškozený obsah');

		await c.find('[data-testid="start-error-pick"]').trigger('click');
		await flushPromises();

		const screen = c.find('[data-testid="start-error"]').text();
		expect(screen).toContain('Data ve složce nejdou načíst');
		expect(screen).toContain('poškozený obsah');
		expect(c.find('[data-testid="start-error-fresh"]').exists()).toBe(false);
	});

	it('čistý start založí složku v Dokumentech a doptá se na dodavatele', async () => {
		backend.breaks('load_vault_path', 'fakturian.json nejde přečíst');
		const c = await mount();

		await c.find('[data-testid="start-error-fresh"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value).toBe('/Users/test/Documents/Fakturian');
		expect(c.find('[data-testid="start-error"]').exists()).toBe(false);
		expect(wizardOpened()).toBe(true);
	});

	it('čistý start místo zapamatované složky appku načte znovu', async () => {
		folderGone();
		const replace = vi.spyOn(window.location, 'replace');
		const c = await mount();

		await c.find('[data-testid="start-error-fresh"]').trigger('click');
		await flushPromises();

		expect(backend.store.get('vaultPath')).toBe('/Users/test/Documents/Fakturian');
		expect(replace).toHaveBeenCalledWith('/');
		expect(wizardOpened()).toBe(false);
	});
});

describe('onboarding', () => {
	it('bez datové složky otevře průvodce', async () => {
		withoutRememberedFolder();
		await mount();

		expect(wizardOpened()).toBe(true);
	});

	it('bez hotových fakturačních údajů otevře průvodce', async () => {
		rememberedFolder({
			...emptySupplier(),
			name: 'Jen jméno',
		});
		await mount();

		expect(wizardOpened()).toBe(true);
	});

	it('s hotovým nastavením průvodce neotevírá', async () => {
		await mount();

		expect(wizardOpened()).toBe(false);
	});
});

describe('klávesové zkratky', () => {
	it('⌘P otevře paletu příkazů', async () => {
		await mount();

		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				metaKey: true,
				key: 'P',
				cancelable: true,
			}),
		);

		expect(paletteOpen()).toBe(true);
	});

	it('nad otevřenou paletou zkratky nic nedělají', async () => {
		await mount();
		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				metaKey: true,
				key: 'p',
				cancelable: true,
			}),
		);
		expect(paletteOpen()).toBe(true);

		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				metaKey: true,
				key: ',',
				cancelable: true,
			}),
		);

		expect(currentPath()).toBe('/');
		expect(paletteOpen()).toBe(true);
	});

	it('⌘N otevře novou fakturu', async () => {
		await mount();

		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				metaKey: true,
				key: 'n',
				cancelable: true,
			}),
		);

		// `/invoice/new` je alias stránky faktury — teprve z něj pozná, že se má založit čistý doklad, ne
		// otevřít ten poslední.
		await vi.waitFor(() => expect(currentPath()).toBe('/invoice/new'));
	});

	it('⌘, otevře nastavení', async () => {
		await mount();

		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				metaKey: true,
				key: ',',
				cancelable: true,
			}),
		);

		await vi.waitFor(() => expect(currentPath()).toBe('/settings'));
	});

	it('samotné písmeno zkratku nespustí', async () => {
		await mount();

		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				metaKey: false,
				key: 'p',
				cancelable: true,
			}),
		);
		await flushPromises();

		expect(paletteOpen()).toBe(false);
		expect(currentPath()).toBe('/');
	});

	it('pod otevřeným modalem zkratky nic nedělají', async () => {
		await mount();
		const pressed = mountSaveButton();
		mountUi(InvoiceContactPicker, {
			props: {
				contacts: [],
			},
			attrs: {
				open: true,
			},
		});
		await flushPromises();

		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				metaKey: true,
				key: 'p',
				cancelable: true,
			}),
		);
		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				metaKey: true,
				key: 'n',
				cancelable: true,
			}),
		);
		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				metaKey: true,
				key: ',',
				cancelable: true,
			}),
		);
		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				metaKey: true,
				key: 's',
				cancelable: true,
			}),
		);
		await flushPromises();

		expect(paletteOpen()).toBe(false);
		expect(currentPath()).toBe('/');
		expect(pressed).not.toHaveBeenCalled();
	});

	it('⌘S zmáčkne tlačítko Uložit stránky a klávesu si vezme', async () => {
		await mount();
		const pressed = mountSaveButton();

		const e = await shortcut('s');

		expect(pressed).toHaveBeenCalledTimes(1);
		expect(e.defaultPrevented).toBe(true);
	});

	it('⌘S nejdřív opustí pole, aby zapsalo hodnotu', async () => {
		await mount();
		const pressed = mountSaveButton();
		const field = document.createElement('input');
		document.body.append(field);
		field.focus();

		await shortcut('s');

		expect(pressed).toHaveBeenCalledWith(document.body);
		field.remove();
	});

	it('⌘S zmáčkne Uložit i s fokusem na ikoně', async () => {
		await mount();
		const pressed = mountSaveButton();
		focusSvgIcon();

		await shortcut('s');

		expect(pressed).toHaveBeenCalledTimes(1);
	});

	it('zamčené Uložit ⌘S nezmáčkne', async () => {
		await mount();
		const pressed = mountSaveButton({ disabled: true });

		await shortcut('s');

		expect(pressed).not.toHaveBeenCalled();
	});

	it('bez tlačítka Uložit ⌘S nic nedělá', async () => {
		await mount();

		const e = await shortcut('s');

		expect(e.defaultPrevented).toBe(true);
		expect(currentPath()).toBe('/');
	});

	it('neznámá zkratka s ⌘ nic nedělá', async () => {
		await mount();

		const e = new KeyboardEvent('keydown', {
			metaKey: true,
			key: 'q',
			cancelable: true,
		});
		window.dispatchEvent(e);
		await flushPromises();

		expect(e.defaultPrevented).toBe(false);
		expect(currentPath()).toBe('/');
	});
});

describe('MCP most', () => {
	it('appka most obsluhuje, dokud je okno otevřené', async () => {
		const c = await mount();
		await flushPromises();

		expect(backend.args('mcp_attach')).toEqual([{}]);
		expect(backend.listening(MCP_MESSAGE_EVENT)).toBe(1);

		c.unmount();
		expect(backend.listening(MCP_MESSAGE_EVENT)).toBe(0);
	});
});
