import { describe, expect, it, vi } from 'vitest';

import { useVault } from '~/composables/useVault';

import { backend } from '../setup/backend';

function remembered(): unknown {
	return backend.store.get('vaultPath');
}

describe('načtení uložené cesty', () => {
	it('vezme cestu z úložiště a ohlásí připravenost', async () => {
		backend.store.set('vaultPath', '/vault');
		const v = useNuxtApp().vueApp.runWithContext(useVault);

		await v.init();
		expect(v.vaultPath.value).toBe('/vault');
		expect(v.ready.value).toBe(true);
	});

	it('bez uložené cesty je vault prázdný, ale ready', async () => {
		const v = useNuxtApp().vueApp.runWithContext(useVault);

		await v.init();
		expect(v.vaultPath.value).toBeNull();
		expect(v.ready.value).toBe(true);
	});

	it('výchozí cesta míří do Dokumentů', async () => {
		expect(await useNuxtApp().vueApp.runWithContext(useVault).defaultVaultPath()).toBe(
			'/Users/test/Documents/Fakturian',
		);
	});
});

describe('nastavení složky', () => {
	it('složku připraví, uloží a zapamatuje', async () => {
		const v = useNuxtApp().vueApp.runWithContext(useVault);
		await v.setVault('/nova');

		expect(backend.folders.has('/nova')).toBe(true);
		expect(remembered()).toBe('/nova');
		expect(v.vaultPath.value).toBe('/nova');
	});
});

describe('výběr datové složky', () => {
	it('první vybranou složku rovnou otevře', async () => {
		backend.dialog.push('/vybrana');
		const v = useNuxtApp().vueApp.runWithContext(useVault);

		expect(await v.pickVault()).toBe(true);
		expect(v.vaultPath.value).toBe('/vybrana');
	});

	it('dialog startuje ve stávající složce', async () => {
		backend.dialog.push('/jinam');
		const v = useNuxtApp().vueApp.runWithContext(useVault);
		await v.setVault('/puvodni');

		await v.pickVault();
		expect(backend.dialogStarts.at(-1)).toBe('/puvodni');
	});

	it('bez složky startuje dialog v Dokumentech', async () => {
		backend.dialog.push('/prvni');

		await useNuxtApp().vueApp.runWithContext(useVault).pickVault();
		expect(backend.dialogStarts.at(-1)).toBe('/Users/test/Documents/Fakturian');
	});

	it('zrušený výběr složku nemění', async () => {
		backend.dialog.push(null);
		const v = useNuxtApp().vueApp.runWithContext(useVault);

		expect(await v.pickVault()).toBe(false);
		expect(backend.folders.size).toBe(0);
		expect(v.vaultPath.value).toBeNull();
	});
});

describe('přepnutí na jinou složku', () => {
	it('zapamatuje novou složku a načte appku znovu na Přehledu', async () => {
		const replace = vi.spyOn(window.location, 'replace');
		const v = useNuxtApp().vueApp.runWithContext(useVault);
		await v.setVault('/puvodni');

		expect(await v.setVault('/nova')).toBe(false);

		expect(backend.folders.has('/nova')).toBe(true);
		expect(remembered()).toBe('/nova');
		expect(replace).toHaveBeenCalledWith('/');
	});

	it('do odjezdu drží paměť starou složku', async () => {
		const v = useNuxtApp().vueApp.runWithContext(useVault);
		await v.setVault('/puvodni');

		await v.setVault('/nova');
		expect(v.vaultPath.value).toBe('/puvodni');
	});

	it('při přepnutí na složku s daty v té původní nic nesahá', async () => {
		backend.dialog.push('/cizi');
		const v = useNuxtApp().vueApp.runWithContext(useVault);
		await v.setVault('/puvodni');
		backend.writeFile('/puvodni', 'platby.json', { payments: {} });
		backend.create('/cizi');
		backend.writeFile('/cizi', 'nastaveni.json', {
			supplier: null,
			contacts: [],
			pricelist: [],
		});

		expect(await v.pickVault()).toBe(false);
		expect(backend.folder('/puvodni').files.has('platby.json')).toBe(true);
	});

	it('volba téže složky appku znovu nenačítá ani nic nezahazuje', async () => {
		const replace = vi.spyOn(window.location, 'replace');
		const v = useNuxtApp().vueApp.runWithContext(useVault);
		await v.setVault('/a');
		const pending = useState<unknown>('pendingInvoice', () => null);
		pending.value = { number: '20260001' };

		expect(await v.setVault('/a')).toBe(true);
		expect(pending.value).toEqual({ number: '20260001' });
		expect(replace).not.toHaveBeenCalled();
	});
});

describe('když se něco nepovede', () => {
	it('nepřečtené úložiště nechá vault nepřipravený', async () => {
		backend.breaks('load_vault_path', 'fakturian.json nejde přečíst');
		const v = useNuxtApp().vueApp.runWithContext(useVault);

		await expect(v.init()).rejects.toBe('fakturian.json nejde přečíst');
		expect(v.ready.value).toBe(false);
		expect(v.vaultPath.value).toBeNull();
	});

	it('selhání přípravy složky ji nenastaví ani nezapamatuje', async () => {
		backend.breaks('ensure_vault', 'do složky nejde zapisovat');
		const v = useNuxtApp().vueApp.runWithContext(useVault);

		await expect(v.setVault('/jenpro-cteni')).rejects.toBe('do složky nejde zapisovat');
		expect(v.vaultPath.value).toBeNull();
		expect(remembered()).toBeUndefined();
	});

	it('nezapamatovaná první složka je varování, ne ztráta složky', async () => {
		backend.breaks('save_vault_path', 'disk je plný');
		const v = useNuxtApp().vueApp.runWithContext(useVault);

		await expect(v.setVault('/nova')).resolves.toBe(true);
		expect(v.vaultPath.value).toBe('/nova');

		const t = useNuxtApp()
			.vueApp.runWithContext(useToast)
			.toasts.value.find((x) => x.title === 'Cestu k datové složce se nepodařilo zapamatovat');
		expect(t?.description).toContain('disk je plný');
	});

	it('bez zapamatování se nepřepne a stránka zůstane', async () => {
		const replace = vi.spyOn(window.location, 'replace');
		const v = useNuxtApp().vueApp.runWithContext(useVault);
		await v.setVault('/puvodni');
		backend.breaks('save_vault_path', 'disk je plný');

		await expect(v.setVault('/nova')).rejects.toBe('disk je plný');
		expect(remembered()).toBe('/puvodni');
		expect(replace).not.toHaveBeenCalled();
	});

	it('nepřipravitelná složka tu stávající nepřepne', async () => {
		const replace = vi.spyOn(window.location, 'replace');
		backend.dialog.push('/jenpro-cteni');
		backend.breaks('ensure_vault', 'do složky nejde zapisovat');
		const v = useNuxtApp().vueApp.runWithContext(useVault);
		v.vaultPath.value = '/puvodni';

		await expect(v.pickVault()).rejects.toBe('do složky nejde zapisovat');
		expect(v.vaultPath.value).toBe('/puvodni');
		expect(remembered()).toBeUndefined();
		expect(replace).not.toHaveBeenCalled();
	});
});

describe('otevření ve Finderu', () => {
	it('otevře zvolenou složku', async () => {
		const v = useNuxtApp().vueApp.runWithContext(useVault);
		await v.setVault('/vault');

		await v.openInFinder();
		expect(backend.exposed).toEqual(['/vault']);
	});

	it('bez zvolené složky neotevírá nic', async () => {
		await useNuxtApp().vueApp.runWithContext(useVault).openInFinder();
		expect(backend.exposed).toEqual([]);
	});
});
