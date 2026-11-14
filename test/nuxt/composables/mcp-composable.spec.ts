import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MCP_MESSAGE_EVENT } from '~/bindings';
import { useVault } from '~/composables/useVault';
import { useVaultData } from '~/composables/useVaultData';

import { backend, outsideDesktop } from '../setup/backend';
import { McpHost, completeContact, connectAgent, replyTo, sentTo, toasts, vaultWithContent } from '../setup/mcp-client';
import { mountUi } from '../setup/mount';
import { prepareVault } from '../setup/vault';

const BROKEN_PAYMENTS =
	'Soubor platby.json má poškozený obsah (payments: Neplatný vstup: očekáváno record, obdrženo řetězec).';

async function vaultWithBrokenPayments(): Promise<void> {
	await expect(
		prepareVault({
			'platby.json': {
				payments: 'rozbité',
			},
		}),
	).rejects.toThrow(new Error(BROKEN_PAYMENTS));
}

beforeEach(async () => {
	await vaultWithContent();
});

describe('protokol', () => {
	it('neznámý nástroj vrátí chybu, ne pád', async () => {
		await connectAgent();

		const reply = await replyTo(backend.mcp.call('neznamy_nastroj'));

		expect(reply).toEqual({
			result: null,
			error: 'Neznámý nástroj: neznamy_nastroj',
		});
	});

	it('metodu, kterou obsluhuje connector, okno odmítne s jejím id', async () => {
		await connectAgent();

		const id = backend.mcp.request('tools/list', {});

		await vi.waitFor(() =>
			expect(sentTo()).toEqual([
				{
					jsonrpc: '2.0',
					id,
					error: {
						code: -32_601,
						message: 'Neznámá metoda: tools/list',
					},
				},
			]),
		);
	});

	it('volání nástroje s chybnými parametry odmítne s jeho id', async () => {
		await connectAgent();

		const id = backend.mcp.request('tools/call', {
			arguments: {},
		});

		await vi.waitFor(() =>
			expect(sentTo()).toEqual([
				{
					jsonrpc: '2.0',
					id,
					error: {
						code: -32_602,
						message:
							'Neplatné volání nástroje (params.name: Neplatný vstup: očekáváno řetězec, obdrženo undefined).',
					},
				},
			]),
		);
	});

	it('volání, které není JSON-RPC 2.0, odmítne jako neplatný požadavek', async () => {
		await connectAgent();

		backend.mcp.deliver({
			session: 1,
			line: JSON.stringify({
				jsonrpc: '1.0',
				id: 3,
				method: 'tools/call',
				params: {
					name: 'summary',
				},
			}),
		});

		await vi.waitFor(() =>
			expect(sentTo()).toEqual([
				{
					jsonrpc: '2.0',
					id: 3,
					error: {
						code: -32_600,
						message: 'Zpráva není JSON-RPC 2.0.',
					},
				},
			]),
		);
	});

	it('nečitelný řádek odmítne chybou JSON-RPC bez id', async () => {
		await connectAgent();

		backend.mcp.deliver({
			session: 1,
			line: '{nejde',
		});

		await vi.waitFor(() =>
			expect(sentTo()).toEqual([
				{
					jsonrpc: '2.0',
					id: null,
					error: {
						code: -32_700,
						message: 'Zpráva není JSON.',
					},
				},
			]),
		);
	});

	it('zprávu bez id, které okno nerozumí, neodpoví, ale uživateli ji ohlásí', async () => {
		await connectAgent();

		backend.mcp.deliver({
			session: 1,
			line: '{"ahoj":1}',
		});
		await flushPromises();

		expect(backend.args('mcp_send')).toEqual([]);
		expect(toasts('Agent poslal zprávu, které appka nerozumí')).toEqual([
			{
				description: 'method: Neplatný vstup',
				color: 'warning',
			},
		]);
	});

	it('nečitelnou zprávu od mostu ohlásí toastem', async () => {
		await connectAgent();

		backend.mcp.deliver({ session: 'jedna' });
		await flushPromises();

		expect(toasts('MCP most poslal nečitelnou zprávu')).toEqual([
			{
				description: 'session: Neplatný vstup: očekáváno číslo, obdrženo řetězec',
				color: 'error',
			},
		]);
		expect(backend.args('mcp_send')).toEqual([]);
	});

	it('zrušení s metadaty klienta volání zruší', async () => {
		await connectAgent();
		const reading = backend.postpone('list_invoices');
		const id = backend.mcp.call('list_invoices');

		backend.mcp.deliver({
			session: 1,
			line: JSON.stringify({
				jsonrpc: '2.0',
				method: 'notifications/cancelled',
				params: {
					requestId: id,
					_meta: {
						origin: 'test',
					},
				},
			}),
		});
		reading.finish();
		await flushPromises();

		expect(sentTo()).toEqual([]);
	});

	it('volání bez argumentů vezme jako prázdné argumenty', async () => {
		await connectAgent();

		const reply = await replyTo(
			backend.mcp.request('tools/call', {
				name: 'list_contacts',
			}),
		);

		expect(reply).toEqual({
			result: [],
			error: null,
		});
	});

	it('argumenty null odmítne, místo aby je vzal za prázdné', async () => {
		await connectAgent();

		const reply = await replyTo(backend.mcp.call('list_contacts', null));

		expect(reply).toEqual({
			result: null,
			error: 'Neplatné argumenty (Neplatný vstup: očekáváno object, obdrženo null).',
		});
	});

	it('chybu IPC předá agentovi jako text', async () => {
		backend.breaks('list_invoices', 'Složka není dostupná.');
		await connectAgent();

		const reply = await replyTo(backend.mcp.call('list_invoices'));

		expect(reply).toEqual({
			result: null,
			error: 'Složka není dostupná.',
		});
	});

	it('odpověď, kterou nejde doručit, ohlásí toastem', async () => {
		backend.breaks('mcp_send', 'Agent se od mostu odpojil.');
		await connectAgent();

		backend.mcp.call('list_contacts');

		await vi.waitFor(() =>
			expect(toasts('Odpověď agentovi se nepodařilo doručit')).toEqual([
				{
					description: 'Agent se od mostu odpojil.',
					color: 'warning',
				},
			]),
		);
	});
});

describe('stav dat', () => {
	it('bez datové složky to agentovi řekne', async () => {
		// Okno po `init()`, které žádnou uloženou složku nenašlo.
		useNuxtApp().vueApp.runWithContext(useVault).ready.value = true;
		useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value = null;
		await connectAgent();

		const reply = await replyTo(backend.mcp.call('list_invoices'));

		expect(reply).toEqual({
			result: null,
			error: 'Fakturian nemá zvolenou datovou složku.',
		});
	});

	it('v čerstvém okně před zjištěním složky řekne, že se data načítají', async () => {
		// Stav okna, které se právě načetlo a ještě nepřečetlo uloženou cestu ke složce.
		useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value = null;
		await connectAgent();

		const reply = await replyTo(backend.mcp.call('list_contacts'));

		expect(reply).toEqual({
			result: null,
			error: 'Data se ještě načítají. Zkus to za chvíli.',
		});
	});

	it('dokud se data načítají, řekne agentovi, ať to zkusí za chvíli', async () => {
		const reading = backend.postpone('read_data_file');
		const loading = useNuxtApp().vueApp.runWithContext(useVaultData).load();
		await connectAgent();

		const reply = await replyTo(backend.mcp.call('list_contacts'));
		reading.finish();
		await loading;

		expect(reply).toEqual({
			result: null,
			error: 'Data se ještě načítají. Zkus to za chvíli.',
		});
	});

	it('nad poškozeným souborem odpoví chybou, ne prázdnými daty', async () => {
		await vaultWithBrokenPayments();
		await connectAgent();

		const reply = await replyTo(backend.mcp.call('list_invoices'));

		expect(reply).toEqual({
			result: null,
			error: `Data ve složce se nepodařilo načíst — ${BROKEN_PAYMENTS}`,
		});
	});

	it('opravený a znovu načtený soubor nástroje zase pustí', async () => {
		await vaultWithBrokenPayments();
		backend.writeFile('/vault', 'platby.json', {
			payments: {},
		});
		await useNuxtApp().vueApp.runWithContext(useVaultData).load();
		await connectAgent();

		const reply = await replyTo(backend.mcp.call('list_invoices'));

		expect(reply).toEqual({
			result: [],
			error: null,
		});
	});

	it('s nečitelnou fakturou ve složce neodpoví neúplným součtem', async () => {
		backend.returns('list_invoices', {
			items: [],
			broken: [
				{
					fileName: '2026001.pdf',
					path: '/vault/faktury/2026001.pdf',
					reason: 'ISDOC chybí',
				},
			],
		});
		await connectAgent();

		const reply = await replyTo(backend.mcp.call('summary'));

		expect(reply).toEqual({
			result: null,
			error: 'Ve složce jsou faktury, které nejde přečíst (2026001.pdf); bez nich by výsledek nebyl úplný. Přehled v appce ukazuje, co s nimi je.',
		});
	});
});

describe('spojení', () => {
	it('každé spojení dostane odpovědi jen na své požadavky', async () => {
		await vaultWithContent({ contacts: [completeContact('k1', 'Acme')] });
		await connectAgent();

		const first = backend.mcp.call('list_contacts', {}, 1);
		const second = backend.mcp.call('list_invoices', {}, 2);

		const contacts = await replyTo(first, 1);
		const invoices = await replyTo(second, 2);
		expect(contacts.result).toEqual([
			{
				name: 'Acme',
				ico: '25596641',
				email: 'fakturace@acme.cz',
				city: 'Praha',
			},
		]);
		expect(invoices.result).toEqual([]);
		expect(sentTo(1).map((m) => m.id)).toEqual([first]);
		expect(sentTo(2).map((m) => m.id)).toEqual([second]);
	});

	it('zrušení v jednom spojení nesáhne na volání se stejným id v jiném', async () => {
		await connectAgent();
		const reading = backend.postpone('list_invoices');
		// Stejné id obou volání: každý connector čísluje svoje požadavky sám.
		backend.mcp.deliver({
			session: 1,
			line: JSON.stringify({
				jsonrpc: '2.0',
				id: 5,
				method: 'tools/call',
				params: {
					name: 'list_invoices',
				},
			}),
		});
		backend.mcp.deliver({
			session: 2,
			line: JSON.stringify({
				jsonrpc: '2.0',
				id: 5,
				method: 'tools/call',
				params: {
					name: 'list_contacts',
				},
			}),
		});

		backend.mcp.cancel(5, 2);
		reading.finish();

		const reply = await replyTo(5, 1);
		expect(reply).toEqual({
			result: [],
			error: null,
		});
	});

	it('zavřené spojení zruší svoje rozběhnutá volání a neodpoví na ně', async () => {
		await connectAgent();
		const reading = backend.postpone('list_invoices');
		backend.mcp.call('list_invoices');

		backend.mcp.deliver({ session: 1 });
		reading.finish();
		await flushPromises();

		expect(sentTo()).toEqual([]);
	});

	it('pod číslem zavřeného spojení se dá začít znovu', async () => {
		await connectAgent();
		await replyTo(backend.mcp.call('list_contacts'));

		backend.mcp.deliver({ session: 1 });
		const reply = await replyTo(backend.mcp.call('list_contacts'));

		expect(reply.result).toEqual([]);
	});

	it('zavření spojení, které okno nezná, nic neshodí', async () => {
		await connectAgent();

		backend.mcp.deliver({ session: 7 });
		await flushPromises();

		expect(backend.args('mcp_send')).toEqual([]);
	});
});

describe('obsluha na pozadí', () => {
	it('v okně appky nejdřív poslouchá, pak se k mostu připojí', async () => {
		mountUi(McpHost);
		await flushPromises();

		// Opačně by se ztratily zprávy, které most po připojení vysype z fronty.
		expect(
			backend.calls.map((c) => c.command).filter((command) => command === 'listen' || command.startsWith('mcp_')),
		).toEqual(['listen', 'mcp_attach']);
	});

	it('s oknem zmizí i posluchač', async () => {
		const c = mountUi(McpHost);
		await flushPromises();
		expect(backend.listening(MCP_MESSAGE_EVENT)).toBe(1);

		c.unmount();

		expect(backend.listening(MCP_MESSAGE_EVENT)).toBe(0);
	});

	it('mimo desktopovou appku se nespustí vůbec', async () => {
		outsideDesktop();
		mountUi(McpHost);

		await flushPromises();

		expect(backend.args('mcp_attach')).toEqual([]);
		expect(backend.listening(MCP_MESSAGE_EVENT)).toBe(0);
	});

	it('selhání připojení k mostu ohlásí toastem', async () => {
		backend.breaks('mcp_attach', 'most neběží');
		mountUi(McpHost);

		await flushPromises();

		expect(toasts('MCP most selhal')).toEqual([
			{
				description: 'most neběží',
				color: 'error',
			},
		]);
	});
});
