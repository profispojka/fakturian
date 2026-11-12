import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CLOSE_REQUESTED_EVENT, FOCUS_CHANGED_EVENT, MCP_MESSAGE_EVENT } from '~/bindings';

import { rejection } from './support.ts';

import { INVOKE_CHANNEL, LISTEN_CHANNEL } from '../ipc.ts';

vi.mock('electron', async () => {
	const { EventEmitter: Emitter } = await import('node:events');
	class FakeRenderer extends Emitter {
		invoke = vi.fn();
		send = vi.fn();
	}
	const renderer = new FakeRenderer();
	return {
		contextBridge: {
			exposeInMainWorld: vi.fn(),
		},
		ipcRenderer: renderer,
		webUtils: {
			getPathForFile: vi.fn(() => '/Users/jana/Downloads/faktura.pdf'),
		},
	};
});

await import('../preload.ts');

const [[name, bridge]] = vi.mocked(contextBridge.exposeInMainWorld).mock.calls;

beforeEach(() => {
	vi.mocked(ipcRenderer.invoke).mockReset();
	vi.mocked(ipcRenderer.send).mockClear();
});

describe('most do stránky', () => {
	it('stránka ho dostane jako window.fakturian', () => {
		expect(name).toBe('fakturian');
		expect(Object.keys(bridge)).toEqual(['invoke', 'on', 'pathForFile']);
	});

	it('příkaz jde jedním kanálem a vrátí hodnotu', async () => {
		vi.mocked(ipcRenderer.invoke).mockResolvedValue({
			ok: true,
			value: '/Users/jana',
		});

		expect(await bridge.invoke('home_dir', {})).toBe('/Users/jana');
		expect(ipcRenderer.invoke).toHaveBeenCalledWith(INVOKE_CHANNEL, 'home_dir', {});
	});

	it('chyba příkazu dojde jako holý řetězec', async () => {
		vi.mocked(ipcRenderer.invoke).mockResolvedValue({
			ok: false,
			error: 'Datová složka /x neexistuje.',
		});

		expect(await rejection(bridge.invoke('list_invoices', { vaultPath: '/x' }))).toBe(
			'Datová složka /x neexistuje.',
		);
	});

	it('odmítnutí od Electronu se do stránky nedostane', async () => {
		vi.mocked(ipcRenderer.invoke).mockRejectedValue(
			new Error("Error invoking remote method 'fakturian:invoke': Error: No handler registered"),
		);

		expect(await rejection(bridge.invoke('home_dir', {}))).toBe('Příkaz home_dir hlavní proces nepřijal.');
	});

	it('přetažený soubor dostane cestu z webUtils', () => {
		const file = { name: 'faktura.pdf' };

		expect(bridge.pathForFile(file)).toBe('/Users/jana/Downloads/faktura.pdf');
		expect(webUtils.getPathForFile).toHaveBeenCalledWith(file);
	});
});

describe('události z hlavního procesu', () => {
	it('posluchač dostane jen obsah zprávy a po odhlášení nic', () => {
		const received: unknown[] = [];
		const stop = bridge.on(MCP_MESSAGE_EVENT, (payload: unknown) => received.push(payload));

		ipcRenderer.emit(
			MCP_MESSAGE_EVENT,
			{ sender: 'main' },
			{
				session: 1,
				line: '{}',
			},
		);
		stop();
		ipcRenderer.emit(MCP_MESSAGE_EVENT, { sender: 'main' }, { session: 2 });

		expect(received).toEqual([
			{
				session: 1,
				line: '{}',
			},
		]);
	});

	it('hlavní proces ví, jestli stránka na událost čeká', () => {
		const first = bridge.on(CLOSE_REQUESTED_EVENT, () => undefined);
		const second = bridge.on(CLOSE_REQUESTED_EVENT, () => undefined);
		first();
		first();
		second();
		const focus = bridge.on(FOCUS_CHANGED_EVENT, () => undefined);
		focus();

		expect(vi.mocked(ipcRenderer.send).mock.calls).toEqual([
			[LISTEN_CHANNEL, CLOSE_REQUESTED_EVENT, true],
			[LISTEN_CHANNEL, CLOSE_REQUESTED_EVENT, false],
			[LISTEN_CHANNEL, FOCUS_CHANGED_EVENT, true],
			[LISTEN_CHANNEL, FOCUS_CHANGED_EVENT, false],
		]);
		expect(ipcRenderer.listenerCount(CLOSE_REQUESTED_EVENT)).toBe(0);
	});

	it('kanál, který hlavní proces neposílá, se odmítne', () => {
		expect(() => bridge.on('fakturian:invoke', () => undefined)).toThrow(
			new Error('Událost fakturian:invoke hlavní proces neposílá.'),
		);
		expect(ipcRenderer.send).not.toHaveBeenCalled();
	});
});
