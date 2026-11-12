import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import plugin from '~/plugins/errors.client';

import { runPlugin } from '../setup/plugin';

// `PromiseRejectionEvent` happy-dom nemá; plugin z události čte jen `reason`.
class Rejection extends Event {
	reason: unknown;
	constructor(reason: unknown) {
		super('unhandledrejection');
		this.reason = reason;
	}
}

describe('nechycená chyba', () => {
	it('chyba z komponenty skončí v toastu', async () => {
		runPlugin(plugin);

		await useNuxtApp().callHook('vue:error', new Error('Tabulka se nevykreslila'), null, 'render');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Něco se nepovedlo',
				description: 'Tabulka se nevykreslila',
				color: 'error',
			}),
		);
	});

	it('odmítnutý slib, na který nikdo nečekal, skončí v toastu', async () => {
		runPlugin(plugin);

		window.dispatchEvent(new Rejection(new Error('Zápis nedoběhl')));
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Něco se nepovedlo',
				description: 'Zápis nedoběhl',
				color: 'error',
			}),
		);
	});

	it('odmítnutí řetězcem z backendu ukáže ten řetězec', async () => {
		runPlugin(plugin);

		window.dispatchEvent(new Rejection('Datová složka /vault neexistuje.'));
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({ description: 'Datová složka /vault neexistuje.' }),
		);
	});
});
