import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { FOCUS_CHANGED_EVENT } from '~/bindings';
import plugin from '~/plugins/native-chrome.client';

import { backend, outsideDesktop } from '../setup/backend';
import { runPlugin } from '../setup/plugin';

// Podstrčený je jen `useColorMode()`: stav vzhledu zakládá plugin `@nuxtjs/color-mode`, který
// v testovacím runtimu neběží.
const { useColorModeMock } = vi.hoisted(() => ({ useColorModeMock: vi.fn() }));

mockNuxtImport('useColorMode', () => useColorModeMock);

let colorMode: ReturnType<typeof ref<string>>;

async function mount() {
	const app = useNuxtApp();
	await app.callHook('app:mounted', app.vueApp);
}

function dragOver(types: string[] | null): Event {
	const event = new Event('dragover', { cancelable: true });
	Object.defineProperty(event, 'dataTransfer', { value: types && { types } });
	window.dispatchEvent(event);
	return event;
}

beforeEach(() => {
	colorMode = ref('light');
	document.documentElement.className = '';
	useColorModeMock.mockImplementation(() => colorMode);
});

describe('matné sklo pod panelem', () => {
	it('mimo desktopovou appku nedělá nic', () => {
		outsideDesktop();

		runPlugin(plugin);

		expect(document.documentElement.classList.contains('native')).toBe(false);
		expect(backend.window.theme).toBeNull();
	});

	it('v okně appky zapne průhledný podklad', () => {
		runPlugin(plugin);

		expect(document.documentElement.classList.contains('native')).toBe(true);
	});
});

describe('vzhled okna', () => {
	it('po mountu nastaví vzhled okna podle přepínače', async () => {
		runPlugin(plugin);
		await mount();

		expect(backend.window.theme).toBe('light');
	});

	it('přepnutí na tmavý režim přenastaví i okno', async () => {
		runPlugin(plugin);
		await mount();

		colorMode.value = 'dark';
		await vi.waitFor(() => expect(backend.window.theme).toBe('dark'));
	});

	it('neznámý režim bere jako světlý', async () => {
		colorMode.value = 'system';
		runPlugin(plugin);
		await mount();

		expect(backend.window.theme).toBe('light');
	});

	it('chybu z okna ohlásí toastem', async () => {
		backend.fails('set_window_theme', 'okno nebere motiv');

		runPlugin(plugin);
		await mount();
		await vi.waitFor(() => {
			expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
				expect.objectContaining({
					title: 'Nastavení vzhledu okna selhalo',
					description: 'okno nebere motiv',
				}),
			);
		});
	});

	it('před mountem vzhled nenastavuje', () => {
		runPlugin(plugin);

		expect(backend.window.theme).toBeNull();
	});
});

describe('okno na pozadí', () => {
	it('po ztrátě zaostření označí dokument třídou window-inactive', async () => {
		runPlugin(plugin);
		await mount();

		backend.setFocused(false);

		expect(document.documentElement.classList.contains('window-inactive')).toBe(true);
	});

	it('po návratu zaostření třídu zase sundá', async () => {
		runPlugin(plugin);
		await mount();

		backend.setFocused(false);
		backend.setFocused(true);

		expect(document.documentElement.classList.contains('window-inactive')).toBe(false);
	});

	it('před mountem zaostření nesleduje', () => {
		runPlugin(plugin);

		expect(backend.listening(FOCUS_CHANGED_EVENT)).toBe(0);
	});
});

describe('soubor puštěný mimo Výdaje', () => {
	it('tažený soubor okno neotevře', () => {
		runPlugin(plugin);

		expect(dragOver(['Files']).defaultPrevented).toBe(true);
	});

	it('tažený text nechá prohlížeči', () => {
		runPlugin(plugin);

		expect(dragOver(['text/plain']).defaultPrevented).toBe(false);
	});

	it('událost bez přenášených dat nechá prohlížeči', () => {
		runPlugin(plugin);

		expect(dragOver(null).defaultPrevented).toBe(false);
	});
});
