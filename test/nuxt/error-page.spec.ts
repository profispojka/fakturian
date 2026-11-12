import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, shallowRef } from 'vue';

import ErrorPage from '~/error.vue';

import { currentPath, goto, mountUi } from '../setup/mount';

describe('chybová stránka', () => {
	it('řekne, co se stalo, a ukáže důvod', () => {
		const c = mountUi(ErrorPage, {
			props: {
				error: createError({
					message: 'Stránka se nenačetla',
				}),
			},
		});

		expect(c.find('[data-testid="app-error"]').text()).toContain('Fakturian narazil na chybu');
		expect(c.find('[data-testid="app-error"]').text()).toContain('Stránka se nenačetla');
	});

	it('další chyba přepíše důvod, který stránka ukazuje', async () => {
		const current = shallowRef(createError({ message: 'Stránka se nenačetla' }));
		const c = mountUi(
			defineComponent({
				name: 'NuxtChyba',
				setup: () => () => h(ErrorPage, { error: current.value }),
			}),
		);

		current.value = createError({ message: 'Datová složka zmizela' });
		await flushPromises();

		expect(c.find('[data-testid="app-error"]').text()).toContain('Datová složka zmizela');
		expect(c.find('[data-testid="app-error"]').text()).not.toContain('Stránka se nenačetla');
	});

	it('tlačítkem se vrátí na přehled', async () => {
		await goto('/invoice');
		const c = mountUi(ErrorPage, {
			props: {
				error: createError({
					message: 'Stránka se nenačetla',
				}),
			},
		});

		await c.find('[data-testid="app-error"] [data-slot="links"] button').trigger('click');

		await vi.waitFor(() => expect(currentPath()).toBe('/'));
	});
});
