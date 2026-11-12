import { commands, type DesktopBridge } from '~/bindings';

function bridge(): DesktopBridge {
	if (!globalThis.fakturian) throw new Error('Okno běží jen v desktopové appce.');
	return globalThis.fakturian;
}

// Stránky, komponenty a pluginy sahají na systém (Finder, prohlížeč, dialogy, oznámení, okno) přes
// tuhle službu; příkazy backendu volají jen služby a composables.
export const systemServices = {
	openUrl: commands.openUrl,
	revealPath: commands.revealPath,
	pickFiles: commands.pickFiles,
	pickSavePath: commands.pickSavePath,
	notify: commands.notify,
	homeDir: commands.homeDir,
	setWindowTheme: commands.setWindowTheme,
	closeWindow: commands.closeWindow,

	on(channel: string, listener: (payload: unknown) => void): () => void {
		return bridge().on(channel, listener);
	},

	// Prázdná cesta znamená soubor, který na disku neleží (třeba obrázek přetažený z prohlížeče).
	pathForFile(file: File): string {
		return bridge().pathForFile(file);
	},
};
