import { join } from 'node:path';

import { app, BrowserWindow, Menu, protocol, screen, session } from 'electron';

import { errorText } from '~/utils/errors';

import { keepTokenInMemory } from './fio.ts';
import { log } from './log.ts';
import { runConnector } from './mcp/connector.ts';
import { MCP_ARG, mcpSocketPath, serveMcp } from './mcp/mod.ts';
import { applicationMenu } from './menu.ts';
import { appSupportDir } from './preferences.ts';
import { APP_ORIGIN, APP_SCHEME, appHandler, developmentPolicy } from './protocol.ts';
import { originOf, startShell, windowOptions } from './window.ts';

process.on('uncaughtException', (error) => void log(`Nezachycená chyba v hlavním procesu: ${errorText(error)}`));
process.on('unhandledRejection', (reason) => void log(`Neošetřené odmítnutí v hlavním procesu: ${errorText(reason)}`));

async function start(): Promise<void> {
	// Stejná složka, kterou čtou `preferences.ts`, log i socket MCP, ne `~/Library/Application Support/Fakturian`.
	app.setPath('userData', appSupportDir());
	protocol.registerSchemesAsPrivileged([
		{
			scheme: APP_SCHEME,
			privileges: {
				standard: true,
				secure: true,
				supportFetchAPI: true,
				codeCache: true,
			},
		},
	]);
	if (!app.requestSingleInstanceLock()) {
		app.quit();
		return;
	}
	app.setAboutPanelOptions({ copyright: '© 2026 binaro.cz' });
	await app.whenReady();

	// Adresa dev serveru z prostředí by v balíčku pustila k příkazům cizí stránku.
	const devUrl = app.isPackaged ? undefined : process.env.FAKTURIAN_DEV_URL;
	// E2E sada běží vedle práce uživatele: appka mu nesmí vzít fokus ani sáhnout do jeho klíčenky.
	const e2e = !app.isPackaged && process.env.FAKTURIAN_E2E === '1';
	if (e2e) {
		keepTokenInMemory();
		app.dock?.hide();
	}
	if (devUrl === undefined) {
		protocol.handle(APP_SCHEME, appHandler(join(import.meta.dirname, '..', 'public')));
	} else {
		const policy = developmentPolicy(devUrl);
		session.defaultSession.webRequest.onHeadersReceived(({ responseHeaders }, respond) =>
			respond({
				responseHeaders: {
					...responseHeaders,
					'Content-Security-Policy': [policy],
				},
			}),
		);
	}

	const devTools = !app.isPackaged;
	const options = await windowOptions({
		preload: join(import.meta.dirname, 'preload.cjs'),
		areas: screen.getAllDisplays().map((display) => display.workArea),
		devTools,
	});
	const win = new BrowserWindow(options);
	const shell = startShell(win, {
		origin: devUrl === undefined ? APP_ORIGIN : originOf(devUrl),
		serveMcp: (bridge) => serveMcp(mcpSocketPath(), bridge),
		background: e2e,
	});
	Menu.setApplicationMenu(
		Menu.buildFromTemplate(
			applicationMenu({
				name: app.name,
				requestClose: shell.requestClose,
				devTools,
			}),
		),
	);
	app.on('before-quit', shell.guardQuit);
	app.on('window-all-closed', () => app.quit());
	app.on('second-instance', () => {
		if (win.isDestroyed()) return;
		if (win.isMinimized()) win.restore();
		win.focus();
	});
	await win.loadURL(devUrl ?? `${APP_ORIGIN}/`);
}

// Connector MCP je táž appka: agent ji spouští na pozadí, bez okna, bez ikony v Docku a bez zámku
// jedné instance, který drží appka s oknem. Na stdout smí jít jen JSON-RPC.
async function connect(): Promise<void> {
	app.dock?.hide();
	let code = 1;
	try {
		code = await runConnector(process.stdin, process.stdout, mcpSocketPath());
	} catch (error) {
		process.stderr.write(`${errorText(error)}\n`);
	}
	app.exit(code);
}

async function launch(): Promise<void> {
	try {
		await start();
	} catch (error) {
		await log(`Fakturian se nepodařilo spustit: ${errorText(error)}`);
		app.exit(1);
	}
}

// Bez `await` na nejvyšší úrovni: Electron vydá `ready` až po vyhodnocení hlavního modulu, takže
// čekání na `whenReady()` uvnitř něj by se nikdy nedočkalo.
if (process.argv.includes(MCP_ARG)) void connect();
else void launch();
