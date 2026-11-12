import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';

import App from '~/app.vue';
import InvoiceContactPicker from '~/components/invoice/ContactPicker.vue';

import { backend } from '../setup/backend';
import { completeSupplier } from '../setup/fixtures';
import { mountPage, mountUi } from '../setup/mount';
import { prepareVault, writes } from '../setup/vault';

const { useColorModeMock } = vi.hoisted(() => ({ useColorModeMock: vi.fn() }));
mockNuxtImport('useColorMode', () => useColorModeMock);

// ⌘S drží `app.vue` a mačká „Uložit" stránky, takže běží obojí; stránku vykreslí `mountPage`.
function mountSettings() {
	mountUi(App, {
		global: {
			stubs: {
				NuxtPage: true,
			},
		},
	});
	return mountPage('/settings');
}

async function openModal(): Promise<void> {
	mountUi(InvoiceContactPicker, {
		props: {
			contacts: [],
		},
		attrs: {
			open: true,
		},
	});
	await flushPromises();
}

async function press(key = 's', modifiers: KeyboardEventInit = { metaKey: true }): Promise<KeyboardEvent> {
	await flushPromises();
	const e = new KeyboardEvent('keydown', {
		...modifiers,
		key,
		cancelable: true,
	});
	window.dispatchEvent(e);
	await flushPromises();
	return e;
}

/** Počítá se zápis, ne obsah — ten už leží ve fixture. */
function saves(): number {
	return writes('nastaveni.json');
}

beforeEach(async () => {
	useColorModeMock.mockReturnValue(
		reactive({
			value: 'light',
			preference: 'system',
		}),
	);
	await prepareVault({
		'nastaveni.json': {
			supplier: {
				...completeSupplier(),
			},
			contacts: [],
			pricelist: [],
		},
	});
	backend.returns('scan_vault', {
		candidates: [],
		skipped: [],
		supplier: null,
		truncated: false,
	});
});

describe('co platí o každé zkratce', () => {
	it('příkaz běží a potlačí výchozí akci prohlížeče', async () => {
		await mountSettings();

		const e = await press();

		expect(saves()).toBe(1);
		expect(e.defaultPrevented).toBe(true);
	});

	it('funguje i při psaní do formuláře a s velkým písmenem', async () => {
		const c = await mountSettings();
		c.find<HTMLInputElement>('[name="ico"]').element.focus();

		await press('S');

		expect(saves()).toBe(1);
	});

	it.each(['Windows NT 10.0', 'X11; Linux x86_64'])('na %s používá Ctrl místo ⌘', async (platform) => {
		vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(`Mozilla/5.0 (${platform})`);
		await mountSettings();

		const command = await press();
		expect(command.defaultPrevented).toBe(false);
		expect(saves()).toBe(0);

		const control = await press('s', { ctrlKey: true });
		expect(control.defaultPrevented).toBe(true);
		expect(saves()).toBe(1);
	});

	it('obyčejné psaní, jiná zkratka a další modifikátory příkaz nespustí', async () => {
		await mountSettings();

		const plain = await press('s', {});
		const other = await press('q');
		const shifted = await press('s', {
			metaKey: true,
			shiftKey: true,
		});

		expect(plain.defaultPrevented).toBe(false);
		expect(other.defaultPrevented).toBe(false);
		expect(shifted.defaultPrevented).toBe(false);
		expect(saves()).toBe(0);
	});

	it('pod otevřeným modalem příkaz neběží', async () => {
		await mountSettings();
		await openModal();

		await press();

		expect(saves()).toBe(0);
	});

	it('zavřený modal příkaz nechá být', async () => {
		await mountSettings();
		mountUi(InvoiceContactPicker, {
			props: {
				contacts: [],
			},
			attrs: {
				open: false,
			},
		});
		await flushPromises();

		await press();

		expect(saves()).toBe(1);
	});
});
