import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';

import { CLOSE_REQUESTED_EVENT } from '~/bindings';
import { useUnsavedGuard } from '~/composables/useForm';
import plugin from '~/plugins/unsaved-guard.client';

import { backend, outsideDesktop, requestClose } from '../setup/backend';
import { mountUi } from '../setup/mount';
import { runPlugin } from '../setup/plugin';

function openPage(canDiscard: boolean) {
	return mountUi(
		defineComponent({
			name: 'RozepsanaStranka',
			setup() {
				useUnsavedGuard(() => Promise.resolve(canDiscard));
				return () => h('div');
			},
		}),
	);
}

describe('zavěšení na okno', () => {
	it('mimo desktopovou appku nedělá nic', () => {
		outsideDesktop();

		runPlugin(plugin);

		expect(backend.listening(CLOSE_REQUESTED_EVENT)).toBe(0);
	});

	it('poslouchá na žádost o zavření okna', () => {
		runPlugin(plugin);

		expect(backend.listening(CLOSE_REQUESTED_EVENT)).toBe(1);
	});
});

describe('verdikt při zavírání', () => {
	it('rozepsanou práci nechá okno otevřené', async () => {
		openPage(false);
		runPlugin(plugin);

		requestClose();
		await flushPromises();

		expect(backend.window.closed).toBe(false);
	});

	it('bez rozepsané práce okno zavře', async () => {
		openPage(true);
		runPlugin(plugin);

		requestClose();
		await flushPromises();

		expect(backend.window.closed).toBe(true);
	});

	it('bez přihlášené hlídky se okno zavře', async () => {
		runPlugin(plugin);

		requestClose();
		await flushPromises();

		expect(backend.window.closed).toBe(true);
	});

	it('okno, které se zavřít nepodařilo, ohlásí toastem', async () => {
		backend.fails('close_window', 'okno nejde zavřít');
		runPlugin(plugin);

		requestClose();
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Okno se nepodařilo zavřít',
				description: 'okno nejde zavřít',
				color: 'error',
			}),
		);
	});
});
