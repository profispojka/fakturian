import { beforeEach, describe, expect, it } from 'vitest';

import { useLogo } from '~/composables/useLogo';
import { useVault } from '~/composables/useVault';

import { backend } from '../setup/backend';
import { prepareVault } from '../setup/vault';

/**
 * Logo žije jako `logo.png` **přímo ve vaultu**, ne v konfiguraci appky, aby cestovalo s daty — kdo
 * si složku přenese na jiný stroj, má i logo.
 */
const LOGO = '/vault/logo.png';

beforeEach(async () => {
	await prepareVault();
});

describe('useLogo', () => {
	it('vybrané PNG uloží do vaultu jako logo.png', async () => {
		backend.dialog.push('/Users/jan/logo.png');
		const { setLogo, hasLogo } = useNuxtApp().vueApp.runWithContext(useLogo);

		expect(await setLogo()).toBe(true);
		expect(backend.args('set_vault_logo')).toEqual([
			{
				vaultPath: '/vault',
				source: '/Users/jan/logo.png',
			},
		]);
		expect(backend.files.has(LOGO)).toBe(true);
		expect(hasLogo.value).toBe(true);
	});

	it('zrušený dialog nic nekopíruje', async () => {
		backend.dialog.push(null);
		const { setLogo, hasLogo } = useNuxtApp().vueApp.runWithContext(useLogo);

		expect(await setLogo()).toBe(false);
		expect(backend.args('set_vault_logo')).toEqual([]);
		expect(hasLogo.value).toBe(false);
	});

	it('bez datové složky se ozve chybou', async () => {
		useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value = null;

		await expect(useNuxtApp().vueApp.runWithContext(useLogo).setLogo()).rejects.toThrow(
			new Error('Není zvolena datová složka'),
		);
	});

	it('smaže logo ze složky', async () => {
		backend.files.add(LOGO);
		const { removeLogo, hasLogo, refreshLogo } = useNuxtApp().vueApp.runWithContext(useLogo);
		await refreshLogo();

		await removeLogo();
		expect(backend.args('remove_vault_logo')).toEqual([{ vaultPath: '/vault' }]);
		expect(backend.files.has(LOGO)).toBe(false);
		expect(hasLogo.value).toBe(false);
	});

	it('bez datové složky se mazání jen tiše přeskočí', async () => {
		useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value = null;
		backend.files.add(LOGO);

		await useNuxtApp().vueApp.runWithContext(useLogo).removeLogo();
		expect(backend.args('remove_vault_logo')).toEqual([]);
		expect(backend.files.has(LOGO)).toBe(true);
	});

	it('nezkopírované logo nese chybu dál a stav nezvedne', async () => {
		backend.dialog.push('/Users/jan/logo.png');
		backend.fails('set_vault_logo', 'do složky nejde zapisovat');
		const { setLogo, hasLogo } = useNuxtApp().vueApp.runWithContext(useLogo);

		await expect(setLogo()).rejects.toBe('do složky nejde zapisovat');
		expect(hasLogo.value).toBe(false);
	});

	it('nesmazané logo nese chybu dál a zůstane přítomné', async () => {
		backend.files.add(LOGO);
		backend.fails('remove_vault_logo', 'soubor je zamčený');
		const { removeLogo, hasLogo, refreshLogo } = useNuxtApp().vueApp.runWithContext(useLogo);
		await refreshLogo();

		await expect(removeLogo()).rejects.toBe('soubor je zamčený');
		expect(hasLogo.value).toBe(true);
	});

	it('refreshLogo zjistí přítomnost loga ve vaultu', async () => {
		backend.files.add(LOGO);
		const { refreshLogo, hasLogo } = useNuxtApp().vueApp.runWithContext(useLogo);

		await refreshLogo();
		expect(backend.args('vault_has_logo')).toEqual([{ vaultPath: '/vault' }]);
		expect(hasLogo.value).toBe(true);
	});

	it('nedostupná složka nese chybu dál a stav loga nezmění', async () => {
		backend.files.add(LOGO);
		const { refreshLogo, hasLogo } = useNuxtApp().vueApp.runWithContext(useLogo);
		await refreshLogo();
		backend.breaks('vault_has_logo', 'Datová složka /vault neexistuje.');

		await expect(refreshLogo()).rejects.toBe('Datová složka /vault neexistuje.');
		expect(hasLogo.value).toBe(true);
	});

	it('bez datové složky je logo vždy nepřítomné', async () => {
		useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value = null;
		backend.files.add(LOGO);
		const { refreshLogo, hasLogo } = useNuxtApp().vueApp.runWithContext(useLogo);

		await refreshLogo();
		expect(backend.args('vault_has_logo')).toEqual([]);
		expect(hasLogo.value).toBe(false);
	});
});
