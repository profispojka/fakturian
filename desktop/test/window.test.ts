import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { ipcMain } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLOSE_REQUESTED_EVENT, FOCUS_CHANGED_EVENT, MCP_MESSAGE_EVENT } from '~/bindings';

import { loggedLines } from './support.ts';

import { INVOKE_CHANNEL, LISTEN_CHANNEL } from '../ipc.ts';
import { originOf, secureContents, startShell, windowOptions } from '../window.ts';

vi.mock(import('node:timers/promises'), async (importOriginal) => {
	const timers = await importOriginal();
	return {
		...timers,
		setTimeout: vi.fn(timers.setTimeout),
	};
});

vi.mock('electron', () => ({
	ipcMain: {
		handle: vi.fn(),
		on: vi.fn(),
	},
	app: {
		getAppPath: () => '/Applications/Fakturian.app/Contents/Resources/app.asar',
		isPackaged: true,
	},
}));

const ORIGIN = 'app://fakturian';

const DEFAULTS = {
	title: 'Fakturian',
	width: 1100,
	height: 720,
	minWidth: 760,
	minHeight: 480,
	show: false,
	titleBarStyle: 'hidden',
	vibrancy: 'sidebar',
	visualEffectState: 'followWindow',
	backgroundColor: '#00000000',
	webPreferences: {
		preload: '/app/preload.cjs',
		contextIsolation: true,
		sandbox: true,
		nodeIntegration: false,
		webSecurity: true,
		devTools: false,
	},
};

const SCREEN = [
	{
		x: 0,
		y: 0,
		width: 1512,
		height: 944,
	},
];

let home = '';
let stateFile = '';

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), 'fakturian-window-'));
	stateFile = join(home, 'Library', 'Application Support', 'com.fakturian.desktop', '.window-state.json');
	vi.stubEnv('HOME', home);
	vi.mocked(ipcMain.handle).mockClear();
	vi.mocked(ipcMain.on).mockClear();
});

afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(home, { recursive: true });
});

async function saveState(content: string): Promise<void> {
	await mkdir(join(stateFile, '..'), { recursive: true });
	await writeFile(stateFile, content);
}

function options() {
	return windowOptions({
		preload: '/app/preload.cjs',
		areas: SCREEN,
		devTools: false,
	});
}

describe('velikost a poloha okna', () => {
	it('první spuštění má výchozí okno', async () => {
		expect(await options()).toEqual(DEFAULTS);
		expect(await loggedLines(home)).toEqual([]);
	});

	it('uložené okno se vrátí na své místo', async () => {
		await saveState('{"width":1300,"height":850,"x":40,"y":60}');

		expect(await options()).toEqual({
			...DEFAULTS,
			width: 1300,
			height: 850,
			x: 40,
			y: 60,
		});
	});

	it('okno z odpojeného monitoru si nechá velikost, polohu ne', async () => {
		await saveState('{"width":1300,"height":850,"x":3000,"y":60}');

		expect(await options()).toEqual({
			...DEFAULTS,
			width: 1300,
			height: 850,
		});
	});

	it('okno, které obrazovky jen dotýká, se vrátí bez polohy, okno na druhém monitoru s ní', async () => {
		const placed = async (x: number, y: number, areas = SCREEN) => {
			await saveState(
				JSON.stringify({
					width: 1300,
					height: 850,
					x,
					y,
				}),
			);
			const restored = await windowOptions({
				preload: '/app/preload.cjs',
				areas,
				devTools: false,
			});
			return [x, y, restored.x, restored.y];
		};
		const second = [
			...SCREEN,
			{
				x: 1512,
				y: 0,
				width: 1920,
				height: 1080,
			},
		];

		expect([
			await placed(1512, 0),
			await placed(-1300, 0),
			await placed(0, 944),
			await placed(0, -850),
			await placed(1511, 943),
			await placed(2000, 100, second),
		]).toEqual([
			[1512, 0, undefined, undefined],
			[-1300, 0, undefined, undefined],
			[0, 944, undefined, undefined],
			[0, -850, undefined, undefined],
			[1511, 943, 1511, 943],
			[2000, 100, 2000, 100],
		]);
	});

	it('poškozený nebo nečitelný stav se zaloguje a okno má výchozí velikost', async () => {
		await saveState('{"width":');
		expect(await options()).toEqual(DEFAULTS);

		await saveState('{"width":300,"height":850,"x":0,"y":0}');
		expect(await options()).toEqual(DEFAULTS);

		await rm(stateFile);
		await mkdir(stateFile);
		expect(await options()).toEqual(DEFAULTS);

		expect(await loggedLines(home)).toEqual([
			`Stav okna ${stateFile} je poškozený (Unexpected end of JSON input), okno má výchozí velikost.`,
			`Stav okna ${stateFile} je poškozený (width: Hodnota je příliš malá: number musí být >=760), okno má výchozí velikost.`,
			'Stav okna nejde přečíst: EISDIR: illegal operation on a directory, read',
		]);
	});
});

describe('původ stránky', () => {
	it('vlastní schéma i dev server mají svůj původ, nečitelná adresa žádný', () => {
		expect(originOf('app://fakturian/invoice/new?x=1')).toBe(ORIGIN);
		expect(originOf('http://127.0.0.1:1420/customers')).toBe('http://127.0.0.1:1420');
		expect(originOf('nesmysl')).toBe('null');
	});
});

class FakeSocket extends EventEmitter {
	destroy = vi.fn();
	write = vi.fn();
}

class FakeContents extends EventEmitter {
	send = vi.fn();
	destroyed = false;
	setWindowOpenHandler = vi.fn();
	session = {
		setPermissionRequestHandler: vi.fn(),
		setPermissionCheckHandler: vi.fn(),
	};

	isDestroyed() {
		return this.destroyed;
	}
}

// Jako `BrowserWindow`: `close` se dá zastavit, jinak okno skončí událostí `closed`.
class FakeWindow extends EventEmitter {
	webContents = new FakeContents();
	show = vi.fn();
	showInactive = vi.fn();
	blur = vi.fn();
	closed = 0;

	getNormalBounds() {
		return {
			x: 40,
			y: 60,
			width: 1200,
			height: 800,
		};
	}

	close() {
		let prevented = false;
		this.emit('close', { preventDefault: () => (prevented = true) });
		if (prevented) return;
		this.closed += 1;
		this.emit('closed');
	}
}

function quitEvent() {
	return {
		prevented: false,
		preventDefault() {
			this.prevented = true;
		},
	};
}

const settle = () => new Promise((done) => setImmediate(done));

describe('zabezpečení stránky', () => {
	it('nová okna, cizí adresy a oprávnění webu se odmítnou', () => {
		const contents = new FakeContents();
		secureContents(contents, ORIGIN);

		expect(vi.mocked(contents.setWindowOpenHandler).mock.calls[0][0]()).toEqual({ action: 'deny' });
		const navigations = ['app://fakturian/invoice', 'https://binaro.cz/', 'file:///etc/passwd'].map((url) => {
			const event = {
				url,
				preventDefault: vi.fn(),
			};
			contents.emit('will-navigate', event);
			return [url, event.preventDefault.mock.calls.length];
		});
		expect(navigations).toEqual([
			['app://fakturian/invoice', 0],
			['https://binaro.cz/', 1],
			['file:///etc/passwd', 1],
		]);
		const answer = vi.fn();
		vi.mocked(contents.session.setPermissionRequestHandler).mock.calls[0][0](contents, 'media', answer);
		expect(answer).toHaveBeenCalledWith(false);
		expect(vi.mocked(contents.session.setPermissionCheckHandler).mock.calls[0][0]()).toBe(false);
	});
});

describe('slupka okna', () => {
	let win: FakeWindow;
	let server: { socket: string; close: ReturnType<typeof vi.fn> };
	let bridgeOf: ReturnType<typeof vi.fn>;
	let shell: ReturnType<typeof startShell>;

	const page = (overrides = {}) => ({
		sender: win.webContents,
		senderFrame: {
			parent: null,
			url: 'app://fakturian/invoice/new',
		},
		...overrides,
	});

	function invoke(name: string, args: unknown, event = page()) {
		const [[channel, handler]] = vi.mocked(ipcMain.handle).mock.calls;
		expect(channel).toBe(INVOKE_CHANNEL);
		return handler(event, name, args);
	}

	function listen(channel: unknown, active: unknown, event = page()) {
		const [[name, handler]] = vi.mocked(ipcMain.on).mock.calls;
		expect(name).toBe(LISTEN_CHANNEL);
		handler(event, channel, active);
	}

	beforeEach(async () => {
		win = new FakeWindow();
		server = {
			socket: '/Users/jana/Library/Application Support/com.fakturian.desktop/mcp.sock',
			close: vi.fn(() => Promise.resolve()),
		};
		bridgeOf = vi.fn(() => Promise.resolve(server));
		shell = startShell(win, {
			origin: ORIGIN,
			serveMcp: bridgeOf,
		});
		await settle();
	});

	it('příkaz ze stránky appky se spustí a vrátí výsledek', async () => {
		expect(await invoke('home_dir', {})).toEqual({
			ok: true,
			value: home,
		});
		expect(await invoke('home_dir', { home: '/x' })).toEqual({
			ok: false,
			error: 'Příkaz home_dir dostal neplatné argumenty (Neznámé klíče: "home").',
		});
	});

	it('příkaz odjinud než z hlavního rámce stránky appky se odmítne a zaloguje', async () => {
		const refused = {
			ok: false,
			error: 'Příkazy smí volat jen stránka appky.',
		};
		for (const event of [
			page({
				senderFrame: {
					parent: {},
					url: 'app://fakturian/',
				},
			}),
			page({
				senderFrame: {
					parent: null,
					url: 'https://binaro.cz/',
				},
			}),
			page({ senderFrame: null }),
			page({ sender: new FakeContents() }),
		]) {
			expect(await invoke('home_dir', {}, event)).toEqual(refused);
		}

		expect(await loggedLines(home)).toEqual([
			'Příkaz home_dir přišel odjinud než ze stránky appky (app://fakturian/), odmítnut.',
			'Příkaz home_dir přišel odjinud než ze stránky appky (https://binaro.cz/), odmítnut.',
			'Příkaz home_dir přišel odjinud než ze stránky appky (undefined), odmítnut.',
			'Příkaz home_dir přišel odjinud než ze stránky appky (app://fakturian/invoice/new), odmítnut.',
		]);
	});

	it('připravené okno se ukáže a změnu fokusu dostane stránka', () => {
		win.emit('ready-to-show');
		win.emit('blur');
		win.emit('focus');

		expect(win.webContents.setWindowOpenHandler).toHaveBeenCalledOnce();
		expect(win.show).toHaveBeenCalledOnce();
		expect(win.showInactive).not.toHaveBeenCalled();
		expect(win.blur).not.toHaveBeenCalled();
		expect(win.webContents.send.mock.calls).toEqual([
			[FOCUS_CHANGED_EVENT, false],
			[FOCUS_CHANGED_EVENT, true],
		]);
	});

	it('okno na pozadí se ukáže bez aktivace appky', () => {
		const background = new FakeWindow();
		startShell(background, {
			origin: ORIGIN,
			serveMcp: bridgeOf,
			background: true,
		});
		background.emit('ready-to-show');

		expect(background.showInactive).toHaveBeenCalledOnce();
		expect(background.blur).toHaveBeenCalledOnce();
		expect(background.show).not.toHaveBeenCalled();
	});

	it('zavření bez posluchače ve stránce okno rovnou zavře a uloží jeho stav', async () => {
		win.close();
		await vi.waitFor(() => expect(win.closed).toBe(1));

		expect(win.closed).toBe(1);
		expect(server.close).toHaveBeenCalledOnce();
		expect(JSON.parse(await readFile(stateFile, 'utf8'))).toEqual({
			width: 1200,
			height: 800,
			x: 40,
			y: 60,
		});
	});

	it('zavření s posluchačem čeká na stránku, okno zavře až close_window', async () => {
		listen(CLOSE_REQUESTED_EVENT, true);

		win.close();
		shell.requestClose();
		const quit = quitEvent();
		shell.guardQuit(quit);

		expect(win.closed).toBe(0);
		expect(quit.prevented).toBe(true);
		expect(win.webContents.send.mock.calls).toEqual([
			[CLOSE_REQUESTED_EVENT, null],
			[CLOSE_REQUESTED_EVENT, null],
			[CLOSE_REQUESTED_EVENT, null],
		]);

		expect(await invoke('close_window', {})).toEqual({
			ok: true,
			value: null,
		});
		expect(win.closed).toBe(1);
		expect(await invoke('close_window', {})).toEqual({
			ok: true,
			value: null,
		});
		shell.requestClose();
		const late = quitEvent();
		shell.guardQuit(late);

		expect(win.closed).toBe(1);
		expect(late.prevented).toBe(false);
		expect(win.webContents.send).toHaveBeenCalledTimes(3);
	});

	it('posluchač zavření z cizí stránky zavření nezdrží', async () => {
		listen(
			CLOSE_REQUESTED_EVENT,
			true,
			page({
				senderFrame: {
					parent: null,
					url: 'https://binaro.cz/',
				},
			}),
		);

		shell.requestClose();
		await vi.waitFor(() => expect(win.closed).toBe(1));

		expect(win.webContents.send).not.toHaveBeenCalled();
	});

	it('odhlášený, cizí nebo neznámý posluchač zavření nezdrží', async () => {
		listen(
			CLOSE_REQUESTED_EVENT,
			true,
			page({
				senderFrame: {
					parent: null,
					url: 'https://binaro.cz/',
				},
			}),
		);
		listen('fakturian:invoke', true);
		listen(42, true);
		listen(CLOSE_REQUESTED_EVENT, true);
		listen(CLOSE_REQUESTED_EVENT, false);

		win.close();
		await vi.waitFor(() => expect(win.closed).toBe(1));

		expect(win.closed).toBe(1);
		expect(win.webContents.send).not.toHaveBeenCalled();
	});

	it('nová stránka posluchače zahodí, navigace uvnitř stránky ani v rámci ne', async () => {
		listen(CLOSE_REQUESTED_EVENT, true);
		win.webContents.emit('did-start-navigation', {
			isMainFrame: true,
			isSameDocument: true,
		});
		win.webContents.emit('did-start-navigation', {
			isMainFrame: false,
			isSameDocument: false,
		});
		shell.requestClose();
		expect(win.webContents.send).toHaveBeenCalledWith(CLOSE_REQUESTED_EVENT, null);

		win.webContents.emit('did-start-navigation', {
			isMainFrame: true,
			isSameDocument: false,
		});
		shell.requestClose();
		await vi.waitFor(() => expect(win.closed).toBe(1));

		expect(win.closed).toBe(1);
	});

	it('spadlá stránka zavření nezdrží a pád se zaloguje', async () => {
		listen(CLOSE_REQUESTED_EVENT, true);
		win.webContents.emit(
			'render-process-gone',
			{},
			{
				reason: 'crashed',
				exitCode: 11,
			},
		);
		win.webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'http://127.0.0.1:1420/', true);
		win.webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'app://fakturian/frame', false);

		shell.requestClose();
		await vi.waitFor(() => expect(win.closed).toBe(1));

		expect(win.closed).toBe(1);
		// Obě zprávy se zapisují souběžně, pořadí v logu proto není dané.
		const logged = await loggedLines(home);
		expect(logged.toSorted()).toEqual([
			'Stránka appky spadla (crashed, kód 11).',
			'Stránka http://127.0.0.1:1420/ se nenačetla: ERR_NAME_NOT_RESOLVED (-105).',
		]);
	});

	it('okno zrušené stránkou nechá appku skončit a zavře most', () => {
		listen(CLOSE_REQUESTED_EVENT, true);
		win.webContents.destroyed = true;
		win.emit('closed');
		win.emit('closed');
		const quit = quitEvent();
		shell.guardQuit(quit);
		win.emit('focus');

		expect(quit.prevented).toBe(false);
		expect(server.close).toHaveBeenCalledOnce();
		expect(win.webContents.send).not.toHaveBeenCalled();
	});

	it('neuložený stav okna i nezavřený most se zalogují, okno se stejně zavře', async () => {
		// Bez `~/Library` nejde zapsat ani log, zprávy proto skončí na stderr.
		await writeFile(join(home, 'Library'), '');
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
		server.close.mockRejectedValue(new Error('socket drží klient'));

		win.close();
		await vi.waitFor(() => expect(win.closed).toBe(1));

		expect(stderr.mock.calls).toEqual([
			[
				`Stav okna nejde uložit: ENOTDIR: not a directory, mkdir '${join(home, 'Library', 'Application Support', 'com.fakturian.desktop')}'\n`,
			],
			['MCP most se nepodařilo zavřít: socket drží klient\n'],
		]);
	});

	it('stránka se dozví cestu socketu, na kterém most naslouchá', async () => {
		expect(await invoke('mcp_socket_path', {})).toEqual({
			ok: true,
			value: '/Users/jana/Library/Application Support/com.fakturian.desktop/mcp.sock',
		});
	});

	it('most posílá zprávy připojené stránce a nová stránka odpojí agenty', async () => {
		const [[bridge]] = bridgeOf.mock.calls;
		const socket = new FakeSocket();
		const session = bridge.open(socket);
		await bridge.receive(session, '{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
		expect(win.webContents.send).not.toHaveBeenCalled();

		expect(await invoke('mcp_attach', {})).toEqual({
			ok: true,
			value: null,
		});
		expect(win.webContents.send.mock.calls).toEqual([
			[
				MCP_MESSAGE_EVENT,
				{
					session,
					line: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
				},
			],
		]);

		win.webContents.emit('did-start-navigation', {
			isMainFrame: true,
			isSameDocument: false,
		});
		expect(socket.destroy).toHaveBeenCalled();
		expect(
			await invoke('mcp_send', {
				session,
				line: '{}',
			}),
		).toEqual({
			ok: false,
			error: 'Agent se od mostu odpojil.',
		});
	});
});

describe('most MCP při startu a zavření', () => {
	it('socket, který nejde otevřít, appku nezastaví', async () => {
		const win = new FakeWindow();
		startShell(win, {
			origin: ORIGIN,
			serveMcp: () => Promise.reject(new Error('EADDRINUSE')),
		});
		await settle();

		win.close();
		await vi.waitFor(() => expect(win.closed).toBe(1));

		expect(win.closed).toBe(1);
		expect(await loggedLines(home)).toEqual(['MCP socket se nepodařilo otevřít: EADDRINUSE']);
	});

	it('most, který se neotevřel, stránka nedostane jako běžící', async () => {
		const win = new FakeWindow();
		startShell(win, {
			origin: ORIGIN,
			serveMcp: () => Promise.reject(new Error('EADDRINUSE')),
		});
		const [[, handler]] = vi.mocked(ipcMain.handle).mock.calls;

		expect(
			await handler(
				{
					sender: win.webContents,
					senderFrame: {
						parent: null,
						url: 'app://fakturian/integrations',
					},
				},
				'mcp_socket_path',
				{},
			),
		).toEqual({
			ok: false,
			error: 'Most se nepodařilo spustit, takže se Claude k Fakturianu nepřipojí. Ukonči Fakturian a spusť ho znovu.',
		});
	});

	it('odpověď o mostu počká, až je jasné, jestli se otevřel', async () => {
		const win = new FakeWindow();
		const opened = Promise.withResolvers();
		startShell(win, {
			origin: ORIGIN,
			serveMcp: () => opened.promise,
		});
		const [[, handler]] = vi.mocked(ipcMain.handle).mock.calls;

		const answer = handler(
			{
				sender: win.webContents,
				senderFrame: {
					parent: null,
					url: 'app://fakturian/integrations',
				},
			},
			'mcp_socket_path',
			{},
		);
		expect(await Promise.race([answer, settle()])).toBeUndefined();

		opened.resolve({
			socket: '/tmp/mcp.sock',
			close: () => Promise.resolve(),
		});

		expect(await answer).toEqual({
			ok: true,
			value: '/tmp/mcp.sock',
		});
	});

	it('okno zrušené dřív, než se most otevřel, appku pustí', async () => {
		const win = new FakeWindow();
		const shell = startShell(win, {
			origin: ORIGIN,
			serveMcp: () => new Promise(() => undefined),
		});
		win.emit('closed');
		const quit = quitEvent();
		shell.guardQuit(quit);
		// Zavírání neexistujícího mostu by se zalogovalo až po zápisu do souboru, ne hned.
		await new Promise((done) => setTimeout(done, 200));

		expect(quit.prevented).toBe(false);
		expect(await loggedLines(home)).toEqual([]);
	});

	it('zavřený most zruší čekání na dvě sekundy', async () => {
		const win = new FakeWindow();
		startShell(win, {
			origin: ORIGIN,
			serveMcp: () => Promise.resolve({ close: () => Promise.resolve() }),
		});
		await settle();

		win.close();
		await vi.waitFor(() => expect(win.closed).toBe(1));

		const [[delay, , waiting]] = vi.mocked(sleep).mock.calls;
		expect([delay, waiting?.signal?.aborted]).toEqual([2000, true]);
	});

	it('most, který nejde zavřít, se zaloguje', async () => {
		const win = new FakeWindow();
		startShell(win, {
			origin: ORIGIN,
			serveMcp: () => Promise.resolve({ close: () => Promise.reject(new Error('EBADF')) }),
		});
		await settle();

		win.close();
		await vi.waitFor(() => expect(win.closed).toBe(1));

		expect(await loggedLines(home)).toEqual(['MCP most se nepodařilo zavřít: EBADF']);
	});

	it('most, který se nezavře do dvou sekund, appku nezdrží', async () => {
		const win = new FakeWindow();
		startShell(win, {
			origin: ORIGIN,
			serveMcp: () => Promise.resolve({ close: () => new Promise(() => undefined) }),
		});
		await settle();

		win.close();
		await vi.waitFor(() => expect(win.closed).toBe(1), { timeout: 3000 });

		expect(await loggedLines(home)).toEqual(['MCP most se nezavřel do 2 s, appka končí bez něj.']);
	});
});
