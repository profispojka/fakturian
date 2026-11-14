import { describe, expect, it } from 'vitest';

import { useState } from '#app';
import EmptyState from '~/components/EmptyState.vue';
import VaultEmptyState from '~/components/vault/EmptyState.vue';

import { mountUi } from '../setup/mount';

describe('VaultEmptyState', () => {
	it('řekne, že složka není zvolená', () => {
		expect(mountUi(VaultEmptyState).find('[data-testid="vault-empty-text"]').text()).toContain('datová složka');
	});

	it('tlačítkem otevře průvodce vaultem', async () => {
		const c = mountUi(VaultEmptyState);
		await c.find('[data-testid="vault-empty-choose"]').trigger('click');

		expect(useState<boolean>('vaultWizardOpen', () => false).value).toBe(true);
	});
});

describe('EmptyState', () => {
	it.each<[string, Record<string, unknown>, string]>([
		[
			'chyby',
			{
				items: [1],
				error: 'Ceník se nepodařilo načíst.',
			},
			'empty-state-error',
		],
		['prázdné evidence', { items: [] }, 'empty-state'],
		[
			'filtru bez shody',
			{
				items: [1],
				filtered: [],
			},
			'empty-state-filtered',
		],
	])('třídu od volajícího nese věta %s', (_case, props, testId) => {
		const p = mountUi(EmptyState, {
			props,
			attrs: {
				class: 'mt-3',
			},
		}).find(`[data-testid="${testId}"]`);

		expect(p.classes()).toContain('mt-3');
		expect(p.classes()).toContain('text-ui');
	});

	it('s naplněným seznamem nevykreslí nic', () => {
		const c = mountUi(EmptyState, {
			props: {
				items: [1],
				filtered: [1],
			},
			attrs: {
				class: 'mt-3',
			},
		});

		expect(c.html()).toBe('<!--v-if-->');
	});

	it('chyba přebíjí prázdnou evidenci', () => {
		const c = mountUi(EmptyState, {
			props: {
				items: [],
				error: 'vault je nedostupný',
			},
		});

		expect(c.find('[data-testid="empty-state"]').exists()).toBe(false);
		expect(c.find('[data-testid="empty-state-error"]').text()).toBe('Došlo k chybě: vault je nedostupný');
	});
});
