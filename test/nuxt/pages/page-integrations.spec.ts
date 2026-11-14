import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import { useFio } from '~/composables/useFio';
import { emptySupplier } from '~/schemas/suppliers';

import { backend } from '../setup/backend';
import { mountPage, answerDialog, currentPath, goto, layer } from '../setup/mount';
import { prepareVault } from '../setup/vault';

import type { Contact } from '~/schemas/customers';

const TOKEN = 'a'.repeat(64);

function mount() {
	return mountPage('/integrations');
}

function contact(id: string, name: string): Contact {
	return {
		id,
		name,
		ico: '27082440',
		address: {
			street: 'Dlouhá 1',
			city: 'Praha',
			zip: '11000',
		},
	};
}

async function vaultS(content: { contacts?: Contact[] } = {}): Promise<void> {
	await prepareVault({
		'nastaveni.json': {
			supplier: {
				...emptySupplier(),
				bankAccount: '2000145399',
				bankCode: '0800',
			},
			contacts: content.contacts ?? [],
			pricelist: [],
		},
	});
}

beforeEach(async () => {
	await vaultS();
	backend.mcp.socket = '/Users/jan/Library/Application Support/com.fakturian.desktop/mcp.sock';
});

describe('Fio banka', () => {
	it('stav tokenu se ověří po otevření stránky', async () => {
		await mount();
		expect(backend.args('fio_has_token')).toEqual([{}]);
	});

	it('délku stahované historie říká konstanta Fio', async () => {
		const c = await mount();
		expect(c.text()).toContain('Za posledních 90 dní');
	});

	it('bez tokenu to řekne puntíkem', async () => {
		const c = await mount();

		expect(c.find('[data-testid="fio-status"]').text()).toBe('Bez tokenu');
		expect(c.find('[data-testid="fio-status"]').attributes('data-off')).toBe('true');
	});

	it('s uloženým tokenem se puntík rozsvítí', async () => {
		backend.fio.token = TOKEN;
		const c = await mount();

		expect(c.find('[data-testid="fio-status"]').text()).toBe('Token uložen');
		expect(c.find('[data-testid="fio-status"]').attributes('data-off')).toBeUndefined();
	});

	it('token se zadává jako heslo', async () => {
		const c = await mount();

		expect(c.find('[data-testid="fio-token"]').attributes('type')).toBe('password');
	});

	it('uložením token pošle do Keychainu a pole vyprázdní', async () => {
		const c = await mount();
		await c.find<HTMLInputElement>('[data-testid="fio-token"]').setValue(`  ${TOKEN}  `);

		await c.find('[data-testid="action-save"]').trigger('click');
		await flushPromises();

		expect(backend.fio.token).toBe(TOKEN);
		expect(c.find<HTMLInputElement>('[data-testid="fio-token"]').element.value).toBe('');
		expect(c.find('[data-testid="status-message"]').text()).toContain('Uloženo');
	});

	it('bez zadaného tokenu je uložení zakázané', async () => {
		const c = await mount();

		expect(c.find('[data-testid="action-save"]').attributes('disabled')).toBe('');

		await c.find<HTMLInputElement>('[data-testid="fio-token"]').setValue('neco');
		await flushPromises();
		expect(c.find('[data-testid="action-save"]').attributes('disabled')).toBeUndefined();
	});

	it('vyprázdněné pole uprostřed kliknutí nic neuloží', async () => {
		const c = await mount();
		await c.find<HTMLInputElement>('[data-testid="fio-token"]').setValue(TOKEN);
		await flushPromises();

		void c.find<HTMLInputElement>('[data-testid="fio-token"]').setValue('   ');
		await c.find('[data-testid="action-save"]').trigger('click');
		await flushPromises();

		expect(backend.fio.token).toBeNull();
	});

	it('Uložit je tlačítko, které mačká ⌘S', async () => {
		const c = await mount();

		expect(c.find('[data-testid="action-save"]').attributes('data-save')).toBe('');
	});

	it('během zápisu do klíčenky je Uložit zamčené', async () => {
		backend.postpone('fio_set_token');
		const c = await mount();
		await c.find<HTMLInputElement>('[data-testid="fio-token"]').setValue(TOKEN);
		await flushPromises();

		await c.find('[data-testid="action-save"]').trigger('click');

		expect(c.find('[data-testid="action-save"]').attributes('disabled')).toBe('');
	});

	it('chybu Keychainu ohlásí toastem, ne v liště', async () => {
		backend.fio.keychainFails = true;
		const c = await mount();
		await c.find<HTMLInputElement>('[data-testid="fio-token"]').setValue(TOKEN);

		await c.find('[data-testid="action-save"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Token se nepodařilo uložit',
				description: 'Klíčenka je nedostupná.',
				color: 'error',
			}),
		);
		expect(c.find('[data-testid="status-message"]').exists()).toBe(false);
	});

	it('klidovou větu v liště vystřídá až výsledek uložení', async () => {
		const c = await mount();

		expect(c.find('[data-testid="integrations-footer"]').text()).toContain('Tokeny jsou uložené v klíčence macOS');

		await c.find<HTMLInputElement>('[data-testid="fio-token"]').setValue(TOKEN);
		await c.find('[data-testid="action-save"]').trigger('click');
		await flushPromises();

		expect(c.find('[data-testid="status-message"]').text()).toContain('Uloženo');
		expect(c.find('[data-testid="integrations-footer"]').text()).not.toContain(
			'Tokeny jsou uložené v klíčence macOS',
		);
	});

	it('smazání tokenu se potvrdí hláškou', async () => {
		backend.fio.token = TOKEN;
		const c = await mount();

		await c.find('[data-testid="fio-token-delete"]').trigger('click');
		expect(layer().find('[data-testid="dialog-message"]').text()).toContain('odpojí od Fio banky');
		expect(backend.fio.token).toBe(TOKEN);
		await answerDialog(true);

		expect(backend.fio.token).toBeNull();
		expect(c.find('[data-testid="status-message"]').text()).toContain('smazán');
	});

	it('odmítnuté smazání token zachová', async () => {
		backend.fio.token = TOKEN;
		const c = await mount();

		await c.find('[data-testid="fio-token-delete"]').trigger('click');
		await answerDialog(false);

		expect(backend.fio.token).toBe(TOKEN);
	});

	it('selhání mazání tokenu se ohlásí', async () => {
		backend.fio.token = TOKEN;
		const c = await mount();
		// Klíčenka se zamkne až po načtení stránky — jinak by se o tokenu vůbec nedozvěděla a tlačítko
		// „Smazat token" by nenabídla.
		backend.fio.keychainFails = true;

		await c.find('[data-testid="fio-token-delete"]').trigger('click');
		await answerDialog(true);

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Token se nepodařilo smazat',
				color: 'error',
			}),
		);
	});

	it('bez uloženého tokenu se mazání nenabízí', async () => {
		const c = await mount();

		expect(c.find('[data-testid="fio-token-delete"]').exists()).toBe(false);
	});

	it('nedostupnou klíčenku řekne místo „bez tokenu"', async () => {
		// Zamčená klíčenka není prázdná — „Bez tokenu" by uživatele poslalo zadávat token, který tam je.
		backend.fio.keychainFails = true;
		const c = await mount();

		expect(c.find('[data-testid="fio-status"]').text()).toBe('Klíčenka nedostupná');
		expect(c.find('[data-testid="fio-status"]').attributes('data-error')).toBe('true');
		expect(c.find('[data-testid="fio-token-error"]').text()).toBe('Klíčenka je nedostupná.');
	});

	it('selhanou synchronizaci drží u Fio, dokud se nepovede další', async () => {
		backend.fio.token = TOKEN;
		useFio().syncError.value = 'Nepodařilo se spojit s Fio';
		const c = await mount();

		expect(c.find('[data-testid="fio-status"]').text()).toBe('Synchronizace selhala');
		expect(c.find('[data-testid="fio-status"]').attributes('data-error')).toBe('true');
		expect(c.find('[data-testid="fio-sync-error"] [data-slot="title"]').text()).toBe(
			'Poslední synchronizace Fio selhala',
		);
		expect(c.find('[data-testid="fio-sync-error"] [data-slot="description"]').text()).toBe(
			'Nepodařilo se spojit s Fio',
		);
	});

	it('bez tokenu starou chybu synchronizace neukazuje', async () => {
		useFio().syncError.value = 'Nepodařilo se spojit s Fio';
		const c = await mount();

		expect(c.find('[data-testid="fio-status"]').text()).toBe('Bez tokenu');
		expect(c.find('[data-testid="fio-status"]').attributes('data-error')).toBeUndefined();
		expect(c.find('[data-testid="fio-sync-error"]').exists()).toBe(false);
	});

	it('nový token starou chybu synchronizace zahodí', async () => {
		useFio().syncError.value = 'Token je neplatný';
		const c = await mount();
		await c.find<HTMLInputElement>('[data-testid="fio-token"]').setValue(TOKEN);

		await c.find('[data-testid="action-save"]').trigger('click');
		await flushPromises();

		expect(useFio().syncError.value).toBe('');
		expect(c.find('[data-testid="fio-status"]').text()).toBe('Token uložen');
	});

	it('smazaný token starou chybu synchronizace zahodí', async () => {
		backend.fio.token = TOKEN;
		useFio().syncError.value = 'Token je neplatný';
		const c = await mount();

		await c.find('[data-testid="fio-token-delete"]').trigger('click');
		await answerDialog(true);

		expect(useFio().syncError.value).toBe('');
	});

	it('odchod s neuloženým tokenem se ptá a odmítnutím se zůstane', async () => {
		await goto('/integrations');
		const c = await mount();
		await c.find<HTMLInputElement>('[data-testid="fio-token"]').setValue(TOKEN);

		const leaving = goto('/');
		await answerDialog(false);
		await leaving;

		expect(currentPath()).toBe('/integrations');
	});

	it('po uložení tokenu se odchod neptá', async () => {
		await goto('/integrations');
		const c = await mount();
		await c.find<HTMLInputElement>('[data-testid="fio-token"]').setValue(TOKEN);
		await c.find('[data-testid="action-save"]').trigger('click');
		await flushPromises();

		await goto('/');

		expect(currentPath()).toBe('/');
		expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(false);
	});
});

describe('bez ukázek', () => {
	it('stránka neukazuje účet ani odběratele z datové složky', async () => {
		await vaultS({ contacts: [contact('k1', 'Studio Mráz')] });
		const c = await mount();

		expect(c.text()).not.toContain('Studio Mráz');
		expect(c.text()).not.toContain('2000145399');
	});
});

describe('Claude connector (MCP)', () => {
	it('cestu k socketu si vyžádá z nativní vrstvy', async () => {
		backend.mcp.socket = '/tmp/fakturian-test.sock';
		const c = await mount();

		expect(c.find('[data-testid="mcp-socket"]').text()).toBe('/tmp/fakturian-test.sock');
	});

	it('puntík u MCP hlásí, jestli most běží', async () => {
		const c = await mount();

		const dot = c.find('[data-testid="mcp-status"]');
		expect(dot.text()).toBe('Most běží');
		expect(dot.attributes('data-off')).toBeUndefined();
	});

	it('most, který se nespustil, puntík ohlásí jako chybu i s důvodem', async () => {
		backend.breaks(
			'mcp_socket_path',
			'Most se nepodařilo spustit, takže se Claude k Fakturianu nepřipojí. Ukonči Fakturian a spusť ho znovu.',
		);
		const c = await mount();

		const dot = c.find('[data-testid="mcp-status"]');
		expect(dot.text()).toBe('Most neběží');
		expect(dot.attributes('data-error')).toBe('true');
		expect(dot.attributes('data-off')).toBeUndefined();
		expect(c.find('[data-testid="mcp-paths-error"]').text()).toBe(
			'Most se nepodařilo spustit, takže se Claude k Fakturianu nepřipojí. Ukonči Fakturian a spusť ho znovu.',
		);
		expect(c.find('[data-testid="mcp-socket"]').exists()).toBe(false);
	});

	it('nezjištěný connector se ohlásí taky, most přitom běží', async () => {
		backend.breaks('mcp_connector', 'Cesta ke spustitelnému souboru appky není dostupná');
		const c = await mount();

		expect(c.find('[data-testid="mcp-status"]').text()).toBe('Most nejde zjistit');
		expect(c.find('[data-testid="mcp-paths-error"]').text()).toBe(
			'Cesta ke spustitelnému souboru appky není dostupná',
		);
		expect(c.find('[data-testid="mcp-socket"]').exists()).toBe(true);
	});

	it('bez cesty k socketu puntík řekne, že most není', async () => {
		backend.mcp.socket = '';
		const c = await mount();

		const dot = c.find('[data-testid="mcp-status"]');
		expect(dot.text()).toBe('Bez mostu');
		expect(dot.attributes('data-off')).toBe('true');
	});

	it('s oběma cestami chybu nehlásí', async () => {
		const c = await mount();

		expect(c.find('[data-testid="mcp-paths-error"]').exists()).toBe(false);
	});

	it('domovskou složku v cestě zkrátí na vlnovku', async () => {
		const c = await mount();

		expect(c.find('[data-testid="mcp-socket"]').text()).toBe(
			'~/Library/Application Support/com.fakturian.desktop/mcp.sock',
		);
	});

	it('když cestu k socketu nejde zjistit, karta MCP zůstane bez cesty', async () => {
		backend.breaks('mcp_socket_path', 'most neběží');
		const c = await mount();

		expect(c.find('[data-testid="integrations-mcp"]').exists()).toBe(true);
		expect(c.find('[data-testid="mcp-socket"]').exists()).toBe(false);
	});

	it('příkaz míří na spustitelný soubor appky s přepínačem --mcp', async () => {
		const c = await mount();

		expect(c.find('[data-testid="mcp-command"]').text()).toBe(
			'claude mcp add fakturian -- /Applications/Fakturian.app/Contents/MacOS/Fakturian --mcp',
		);
		expect(c.find('[data-testid="mcp-path-hint"]').exists()).toBe(false);
	});

	it('ve vývoji předá Electronu i cestu k appce a cestu s mezerou i apostrofem uzavře pro shell', async () => {
		backend.mcp.connector = {
			command: '/Users/jan/fakturian/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
			args: ["/Users/jan/Jan's projekty/fakturian", '--mcp'],
		};
		const c = await mount();

		expect(c.find('[data-testid="mcp-command"]').text()).toBe(
			String.raw`claude mcp add fakturian -- /Users/jan/fakturian/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron '/Users/jan/Jan'\''s projekty/fakturian' --mcp`,
		);
	});

	it('bez známé cesty zůstane v příkazu zástupná cesta', async () => {
		backend.breaks('mcp_connector', 'Cesta ke spustitelnému souboru appky není dostupná');
		const c = await mount();

		expect(c.find('[data-testid="mcp-command"]').text()).toBe(
			"claude mcp add fakturian -- '<cesta-k-Fakturianu>/Fakturian.app/Contents/MacOS/Fakturian' --mcp",
		);
		expect(c.find('[data-testid="mcp-path-hint"]').text()).toBe('Za cestu dosaď složku, kde Fakturian máš.');
	});

	it('příkaz k registraci jde zkopírovat', async () => {
		const c = await mount();
		await c.find('[data-testid="mcp-copy"]').trigger('click');
		await flushPromises();

		expect(await navigator.clipboard.readText()).toBe(
			'claude mcp add fakturian -- /Applications/Fakturian.app/Contents/MacOS/Fakturian --mcp',
		);
	});
});
