import { contextBridge, type IpcRendererEvent, ipcRenderer, webUtils } from 'electron';

import { EVENT_CHANNELS, INVOKE_CHANNEL, type IpcResult, LISTEN_CHANNEL } from './ipc.ts';

import type { CommandName, CommandResults, DesktopBridge } from '~/bindings';

const listening = new Map<string, number>();

// Hlavní proces musí vědět, jestli stránka na událost čeká: zavření okna jinak čeká na odpověď,
// která od spadlé nebo nenačtené stránky nepřijde.
function count(channel: string, change: 1 | -1): void {
	const before = listening.get(channel) ?? 0;
	const after = before + change;
	listening.set(channel, after);
	if ((before === 0) !== (after === 0)) ipcRenderer.send(LISTEN_CHANNEL, channel, after > 0);
}

const bridge: DesktopBridge = {
	// Kontrakt chce odmítnutí holým řetězcem: `Error` by `contextBridge` cestou do stránky přepsal.
	// Obálku tvoří náš hlavní proces a tvar hodnoty mu hlídá `Contract` v `commands.ts`.
	async invoke<Name extends CommandName>(name: Name, args: unknown): Promise<CommandResults[Name]> {
		let result: IpcResult<CommandResults[Name]>;
		try {
			result = await ipcRenderer.invoke(INVOKE_CHANNEL, name, args);
		} catch {
			// Odmítnutí od Electronu („Error invoking remote method…“) by uživateli nic neřeklo.
			return Promise.reject(`Příkaz ${name} hlavní proces nepřijal.`);
		}
		if (!result.ok) return Promise.reject(result.error);
		return result.value;
	},
	on(channel, listener) {
		if (!EVENT_CHANNELS.includes(channel)) throw new Error(`Událost ${channel} hlavní proces neposílá.`);
		const handler = (_event: IpcRendererEvent, payload: unknown) => listener(payload);
		ipcRenderer.on(channel, handler);
		count(channel, 1);
		let subscribed = true;
		return () => {
			if (!subscribed) return;
			subscribed = false;
			ipcRenderer.removeListener(channel, handler);
			count(channel, -1);
		};
	},
	pathForFile: (file) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld('fakturian', bridge);
