import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import Snapshots from '~/components/settings/Snapshots.vue';
import { useVault } from '~/composables/useVault';

import { backend } from '../setup/backend';
import { mountUi } from '../setup/mount';
import { prepareVault } from '../setup/vault';

const SNAPSHOTS = '/vault/.fakturian/snapshots';

beforeEach(async () => {
	await prepareVault();
});

async function card() {
	const c = mountUi(Snapshots);
	await flushPromises();
	return c;
}

describe('karta Zálohy', () => {
	it('bez jediné zálohy nabídne jen vysvětlení', async () => {
		const c = await card();

		expect(c.find('[data-testid="snapshots-empty"]').exists()).toBe(true);
		expect(c.find('[data-testid="snapshots-reveal"]').exists()).toBe(false);
	});

	it('uloženou zálohu ukáže ve Finderu', async () => {
		backend.folder('/vault').snapshotsPath = SNAPSHOTS;
		const c = await card();

		expect(c.find('[data-testid="snapshots-empty"]').exists()).toBe(false);
		await c.find('[data-testid="snapshots-reveal"]').trigger('click');
		await flushPromises();

		expect(backend.exposed).toEqual([SNAPSHOTS]);
	});

	it('nedostupný Finder se ozve chybou, ne tichým nic', async () => {
		backend.folder('/vault').snapshotsPath = SNAPSHOTS;
		backend.breaks('reveal_path', 'Finder neodpovídá');
		const c = await card();

		await c.find('[data-testid="snapshots-reveal"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Zálohy se nepodařilo otevřít ve Finderu',
				description: 'Finder neodpovídá',
				color: 'error',
			}),
		);
	});

	it('odmítnutý dotaz na cestu nahlásí chybu a kartu nerozbije', async () => {
		backend.breaks('snapshots_path', 'Datová složka není dostupná.');
		const c = await card();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Zálohy se nepodařilo najít',
				color: 'error',
			}),
		);
		expect(c.find('[data-testid="snapshots-empty"]').exists()).toBe(true);
	});

	it('prázdnou cestu k zálohám odmítne a kartu nechá bez tlačítka', async () => {
		backend.folder('/vault').snapshotsPath = '';
		const c = await card();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Zálohy se nepodařilo najít',
				description: 'Cestu k zálohám nejde přečíst (Hodnota je příliš malá: string musí mít >=1 znaků).',
				color: 'error',
			}),
		);
		expect(c.find('[data-testid="snapshots-reveal"]').exists()).toBe(false);
	});

	it('bez datové složky se na cestu neptá a chybu ohlásí', async () => {
		useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value = null;

		await card();

		expect(backend.args('snapshots_path')).toEqual([]);
		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Zálohy se nepodařilo najít',
				description: 'Není zvolena datová složka',
				color: 'error',
			}),
		);
	});
});
