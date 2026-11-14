import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import {
	type BrowserWindow,
	type BrowserWindowConstructorOptions,
	type IpcMainEvent,
	type IpcMainInvokeEvent,
	ipcMain,
	type Rectangle,
	type WebContents,
} from 'electron';

import { CLOSE_REQUESTED_EVENT, FOCUS_CHANGED_EVENT, MCP_MESSAGE_EVENT } from '~/bindings';
import { errorText, issuesText } from '~/utils/errors';
import { type Zod, z } from '~/utils/zod';

import { commands, dispatcher } from './commands.ts';
import { EVENT_CHANNELS, INVOKE_CHANNEL, LISTEN_CHANNEL } from './ipc.ts';
import { log } from './log.ts';
import { Bridge, type McpServer } from './mcp/mod.ts';
import { appSupportDir } from './preferences.ts';
import { parseJson } from './store.ts';
import { errorCode, writeAtomic } from './util.ts';
import { MIN_WINDOW_SIZE } from './window-size.ts';

// Klient MCP, který nečte, by zavírání mostu zdržel; zavření appky na něj nečeká donekonečna.
const MCP_CLOSE_WAIT = 2000;

const MCP_DOWN =
	'Most se nepodařilo spustit, takže se Claude k Fakturianu nepřipojí. Ukonči Fakturian a spusť ho znovu.';

const geometrySchema = z.strictObject({
	width: z.int().min(MIN_WINDOW_SIZE.width),
	height: z.int().min(MIN_WINDOW_SIZE.height),
	x: z.int(),
	y: z.int(),
});

type Geometry = Zod.infer<typeof geometrySchema>;

function stateFile(): string {
	return join(appSupportDir(), '.window-state.json');
}

// `URL.origin` je u schématu, které WHATWG nezná (`app:`), vždycky `"null"`.
export function originOf(url: string): string {
	const parsed = URL.parse(url);
	if (parsed === null) return 'null';
	return `${parsed.protocol}//${parsed.host}`;
}

// Okno po odpojeném monitoru by se otevřelo mimo obrazovku a nešlo by na něj kliknout.
function visible(geometry: Geometry, areas: Rectangle[]): boolean {
	return areas.some(
		(area) =>
			geometry.x < area.x + area.width &&
			geometry.x + geometry.width > area.x &&
			geometry.y < area.y + area.height &&
			geometry.y + geometry.height > area.y,
	);
}

async function savedGeometry(): Promise<Geometry | undefined> {
	let file: string;
	let text: string;
	try {
		file = stateFile();
		// Stryker disable next-line StringLiteral: ekvivalentní mutant, bez kódování přijde Buffer a `JSON.parse` ho přečte jako UTF-8.
		text = await readFile(file, 'utf8');
	} catch (error) {
		// Chybějící soubor je první spuštění.
		if (errorCode(error) !== 'ENOENT') await log(`Stav okna nejde přečíst: ${errorText(error)}`);
		return undefined;
	}
	let json: unknown;
	try {
		json = parseJson(text);
	} catch (error) {
		await log(`Stav okna ${file} je poškozený (${errorText(error)}), okno má výchozí velikost.`);
		return undefined;
	}
	const geometry = geometrySchema.safeParse(json);
	if (!geometry.success) {
		await log(`Stav okna ${file} je poškozený (${issuesText(geometry.error)}), okno má výchozí velikost.`);
		return undefined;
	}
	return geometry.data;
}

// Pod průhlednou stránkou (`native` ve frontendu) leží vibrancy macOS; semafory zůstávají na místě
// systémového titulku a frontend pro ně nechává nahoře pruh.
export async function windowOptions({
	preload,
	areas,
	devTools,
}: {
	preload: string;
	areas: Rectangle[];
	devTools: boolean;
}): Promise<BrowserWindowConstructorOptions> {
	const options: BrowserWindowConstructorOptions = {
		title: 'Fakturian',
		width: 1100,
		height: 720,
		minWidth: MIN_WINDOW_SIZE.width,
		minHeight: MIN_WINDOW_SIZE.height,
		show: false,
		titleBarStyle: 'hidden',
		vibrancy: 'sidebar',
		visualEffectState: 'followWindow',
		backgroundColor: '#00000000',
		webPreferences: {
			preload,
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			webSecurity: true,
			devTools,
		},
	};
	const geometry = await savedGeometry();
	if (geometry === undefined) return options;
	if (!visible(geometry, areas)) {
		return {
			...options,
			width: geometry.width,
			height: geometry.height,
		};
	}
	return {
		...options,
		...geometry,
	};
}

async function saveGeometry(win: BrowserWindow): Promise<void> {
	const { width, height, x, y } = win.getNormalBounds();
	try {
		const file = stateFile();
		await mkdir(dirname(file), { recursive: true });
		await writeAtomic(
			file,
			new TextEncoder().encode(
				JSON.stringify(
					{
						width,
						height,
						x,
						y,
					},
					null,
					2,
				),
			),
		);
	} catch (error) {
		await log(`Stav okna nejde uložit: ${errorText(error)}`);
	}
}

async function closeServer(server: McpServer): Promise<void> {
	const timer = new AbortController();
	try {
		const outcome = await Promise.race([server.close(), sleep(MCP_CLOSE_WAIT, 'late', { signal: timer.signal })]);
		if (outcome === 'late') await log(`MCP most se nezavřel do ${MCP_CLOSE_WAIT / 1000} s, appka končí bez něj.`);
	} catch (error) {
		await log(`MCP most se nepodařilo zavřít: ${errorText(error)}`);
	} finally {
		timer.abort();
	}
}

// Stránka smí jen zobrazit build appky; okna, cizí adresy a oprávnění webu se odmítají.
export function secureContents(contents: WebContents, origin: string): void {
	contents.setWindowOpenHandler(() => ({ action: 'deny' }));
	contents.on('will-navigate', (event) => {
		if (originOf(event.url) !== origin) event.preventDefault();
	});
	contents.session.setPermissionRequestHandler((_contents, _permission, answer) => answer(false));
	contents.session.setPermissionCheckHandler(() => false);
}

export interface Shell {
	requestClose: () => void;
	// Posluchač `before-quit`: Dock, odhlášení i `app.quit()` musí projít hlídkou rozepsaného dokladu.
	guardQuit: (event: { preventDefault(): void }) => void;
}

// Zavřít chce uživatel křížkem, ⌘W i ⌘Q; o rozepsaném dokladu ale ví jen webview. Když na událost
// nečeká (stránka nenaběhla nebo spadla), okno se zavře hned, jinak by nešlo zavřít vůbec.
export function startShell(
	win: BrowserWindow,
	{
		origin,
		serveMcp,
		background = false,
	}: {
		origin: string;
		serveMcp: (bridge: Bridge) => Promise<McpServer>;
		// Okno se ukáže, ale appka se neaktivuje a fokus nechá tomu, kdo s ním právě pracuje (E2E sada).
		background?: boolean;
	},
): Shell {
	const contents = win.webContents;
	const listening = new Set<string>();
	let server: McpServer | undefined;
	let closing = false;

	function send(channel: string, payload: unknown): void {
		if (!contents.isDestroyed()) contents.send(channel, payload);
	}

	// Most posílá jen připojené stránce (`mcp_attach`); nová stránka se připojí sama.
	const bridge = new Bridge((message) => send(MCP_MESSAGE_EVENT, message));

	function forgetPage(): void {
		listening.clear();
		bridge.detach();
	}

	async function openMcp(): Promise<void> {
		try {
			server = await serveMcp(bridge);
		} catch (error) {
			await log(`MCP socket se nepodařilo otevřít: ${errorText(error)}`);
		}
	}
	const opening = openMcp();

	// Čeká na výsledek otevření: stránka Integrace nesmí hlásit běžící most jen podle cesty k socketu.
	async function mcpSocket(): Promise<string> {
		await opening;
		if (server === undefined) throw new Error(MCP_DOWN);
		return server.socket;
	}

	// Zavřením posledního okna proces končí, takže úklid musí proběhnout před ním.
	async function shutdown(): Promise<null> {
		if (closing) return null;
		closing = true;
		await saveGeometry(win);
		if (server !== undefined) await closeServer(server);
		win.close();
		return null;
	}

	function requestClose(): void {
		if (closing) return;
		if (listening.has(CLOSE_REQUESTED_EVENT)) send(CLOSE_REQUESTED_EVENT, null);
		else void shutdown();
	}

	// Jen hlavní rámec naší stránky; cizí rámec nebo stránka po přesměrování nesmí volat příkazy.
	function fromPage(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
		const frame = event.senderFrame;
		return event.sender === contents && frame !== null && frame.parent === null && originOf(frame.url) === origin;
	}

	const dispatch = dispatcher(
		commands(
			{
				window: win,
				close: shutdown,
				mcpSocket,
			},
			bridge,
		),
	);
	ipcMain.handle(INVOKE_CHANNEL, async (event, name: unknown, args: unknown) => {
		if (fromPage(event)) {
			const result = await dispatch(name, args);
			return result;
		}
		await log(`Příkaz ${String(name)} přišel odjinud než ze stránky appky (${event.senderFrame?.url}), odmítnut.`);
		return {
			ok: false,
			error: 'Příkazy smí volat jen stránka appky.',
		};
	});
	ipcMain.on(LISTEN_CHANNEL, (event, channel: unknown, active: unknown) => {
		// Stryker disable next-line ConditionalExpression: ekvivalentní mutant, jiné než textové jméno v seznamu událostí stejně není.
		if (typeof channel !== 'string') return;
		if (!fromPage(event) || !EVENT_CHANNELS.includes(channel)) return;
		if (active === true) listening.add(channel);
		else listening.delete(channel);
	});

	secureContents(contents, origin);
	win.once('ready-to-show', () => {
		if (!background) {
			win.show();
			return;
		}
		// `showInactive()` okno postaví nad okna ostatních appek, `blur()` ho na macOS pošle dospod.
		win.showInactive();
		win.blur();
	});
	win.on('close', (event) => {
		// Zavírá-li okno úklid sám, nesmí ho posluchač zastavit a poslat znovu do webview.
		if (closing) return;
		event.preventDefault();
		requestClose();
	});
	// `window.close()` ze stránky okno zruší bez `close`; hlídat pak není co a `before-quit` by
	// jinak čekal na stránku, která už není, a appka by běžela bez okna.
	win.on('closed', () => {
		if (closing) return;
		closing = true;
		if (server !== undefined) void closeServer(server);
	});
	win.on('focus', () => send(FOCUS_CHANGED_EVENT, true));
	win.on('blur', () => send(FOCUS_CHANGED_EVENT, false));
	// Přenačtená stránka posluchače zahodí; zprávy agenta počkají, než se nová připojí.
	contents.on('did-start-navigation', (event) => {
		if (event.isMainFrame && !event.isSameDocument) forgetPage();
	});
	contents.on('render-process-gone', (_event, details) => {
		forgetPage();
		void log(`Stránka appky spadla (${details.reason}, kód ${details.exitCode}).`);
	});
	contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
		if (isMainFrame) void log(`Stránka ${url} se nenačetla: ${description} (${code}).`);
	});

	return {
		requestClose,
		guardQuit(event) {
			if (closing) return;
			event.preventDefault();
			requestClose();
		},
	};
}
