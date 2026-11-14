import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { Server, Socket } from 'node:net';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { connect, type Lines, readSocket, socketDir, socketPair } from './sockets.ts';

import {
	Bridge,
	MAX_BACKLOG,
	MAX_CLIENTS,
	MAX_LINE,
	mcpConnector,
	mcpSocketPath,
	type McpServer,
	READY,
	readLines,
	rejection,
	rpcError,
	SERVER_ERROR,
	serveMcp,
	tokenPath,
	toolError,
	type WindowMessage,
} from '../../mcp/mod.ts';
import { loggedLines, rejection as rejectionOf, thrownBy } from '../support.ts';

const UNAUTHORIZED = 'Spojení nenese platný klíč mostu z mcp.token. Pokud se Fakturian právě spouštěl, zkus to znovu.';
const DISCONNECTED = 'Agent se od mostu odpojil.';
const TOO_LONG = 'Zpráva je delší než 1 MiB — most ji odmítl.';
const REQUEST = '{"jsonrpc":"2.0","id":7,"method":"tools/list"}';

// Okno, které si zprávy zapíše; `next()` počká na další.
function windowFor() {
	const seen: WindowMessage[] = [];
	let read = 0;
	let wake: (() => void) | undefined;
	const bridge = new Bridge((message) => {
		seen.push(message);
		wake?.();
	});
	const arrived = () =>
		new Promise<void>((resolve) => {
			wake = resolve;
		});
	return {
		bridge,
		seen,
		async next() {
			while (read >= seen.length) await arrived();
			read += 1;
			return seen[read - 1];
		},
	};
}

vi.mock(import('node:crypto'), async (importOriginal) => {
	const crypto = await importOriginal();
	return {
		...crypto,
		randomBytes: vi.fn(crypto.randomBytes),
	};
});

// Zaseknuté spojení má test shodit hned: celá sada běží v desítkách milisekund.
vi.setConfig({
	testTimeout: 2000,
	hookTimeout: 2000,
});

let dir = '';
const sockets: Socket[] = [];

beforeEach(async () => {
	dir = await socketDir('mcp');
});

afterEach(async () => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	for (const socket of sockets.splice(0)) socket.destroy();
	await rm(dir, { recursive: true });
});

async function pair(): Promise<[Socket, Socket]> {
	const ends = await socketPair(dir);
	sockets.push(...ends);
	return ends;
}

describe('most mezi spojeními a oknem', () => {
	it('zprávy čekají na okno a po připojení dojdou v pořadí', async () => {
		const window = windowFor();
		const [ours] = await pair();
		const session = window.bridge.open(ours);

		await window.bridge.receive(session, 'první');
		await window.bridge.receive(session, 'druhá');
		expect(window.seen).toEqual([]);

		window.bridge.attach();
		await window.bridge.receive(session, 'třetí');

		expect(window.seen).toEqual([
			{
				session,
				line: 'první',
			},
			{
				session,
				line: 'druhá',
			},
			{
				session,
				line: 'třetí',
			},
		]);
	});

	it('znovu načítané okno dostane jen zprávy nových spojení', async () => {
		const window = windowFor();
		const [first] = await pair();
		const [second] = await pair();
		const old = window.bridge.open(first);
		window.bridge.attach();

		window.bridge.detach();
		const fresh = window.bridge.open(second);
		await window.bridge.receive(old, REQUEST);
		await window.bridge.receive(fresh, REQUEST);
		window.bridge.close(old);
		expect(window.seen).toEqual([]);

		window.bridge.attach();
		expect(window.seen).toEqual([
			{
				session: fresh,
				line: REQUEST,
			},
		]);
	});

	it('stránka, která se nepřipojila, nechá zprávy další', async () => {
		const window = windowFor();
		const [ours] = await pair();
		const session = window.bridge.open(ours);
		await window.bridge.receive(session, REQUEST);

		// Tak začíná i první načtení okna po startu appky.
		window.bridge.detach();
		window.bridge.attach();

		expect(window.seen).toEqual([
			{
				session,
				line: REQUEST,
			},
		]);
		expect(ours.destroyed).toBe(false);
	});

	it('plná fronta odmítne požadavek a notifikaci zahodí', async () => {
		const window = windowFor();
		const [ours, peer] = await pair();
		const lines = readSocket(peer);
		const session = window.bridge.open(ours);
		for (let i = 0; i < MAX_BACKLOG; i++) await window.bridge.receive(session, '{}');

		await window.bridge.receive(session, REQUEST);
		await window.bridge.receive(session, '{"jsonrpc":"2.0","method":"notifications/initialized"}');
		await window.bridge.send(session, 'konec');

		expect(await lines.first(2)).toEqual([
			toolError(7, 'Okno Fakturianu se ještě načítá. Zkus to za chvíli.'),
			'konec',
		]);
		window.bridge.attach();
		expect(window.seen).toHaveLength(MAX_BACKLOG);
	});

	it('zavření spojení se ohlásí oknu a connector most zapomene', async () => {
		const window = windowFor();
		window.bridge.attach();
		const [ours] = await pair();
		const session = window.bridge.open(ours);

		window.bridge.close(session);
		window.bridge.close(session);

		expect(window.seen).toEqual([{ session }]);
		expect(JSON.stringify(window.seen[0])).toBe(`{"session":${session}}`);
		await expect(window.bridge.send(session, '{}')).rejects.toThrow(DISCONNECTED);
	});

	it('každé spojení má vlastní číslo', async () => {
		const { bridge } = windowFor();
		const [first] = await pair();
		const [second] = await pair();

		expect(bridge.open(first)).not.toBe(bridge.open(second));
	});

	it('odpověď okna dojde jen jejímu spojení jako jeden řádek', async () => {
		const { bridge } = windowFor();
		const [firstOurs, firstPeer] = await pair();
		const [secondOurs, secondPeer] = await pair();
		const first = readSocket(firstPeer);
		const second = readSocket(secondPeer);
		const one = bridge.open(firstOurs);
		const two = bridge.open(secondOurs);

		await bridge.send(one, '{"jsonrpc":"2.0","id":1,"result":{}}');
		await bridge.send(two, 'druhý');

		expect(await first.next()).toBe('{"jsonrpc":"2.0","id":1,"result":{}}');
		expect(await second.next()).toBe('druhý');
	});

	it('víceřádková odpověď se odmítne', async () => {
		const { bridge } = windowFor();
		const [ours] = await pair();
		const session = bridge.open(ours);

		await expect(bridge.send(session, '{\n}')).rejects.toThrow('Zpráva pro connector musí být na jednom řádku.');
	});

	it('odpověď neznámému spojení je chyba', async () => {
		const { bridge } = windowFor();

		const error = await rejectionOf(bridge.send(42, '{}'));

		expect([error, Object.hasOwn(error as Error, 'cause')]).toEqual([new Error(DISCONNECTED), false]);
	});

	it('zápis, který selže, je odpojený connector', async () => {
		const { bridge } = windowFor();
		const [ours, peer] = await pair();
		const session = bridge.open(ours);
		peer.destroy();
		await once(peer, 'close');

		await expect(bridge.send(session, '{}')).rejects.toThrow(
			new Error(DISCONNECTED, { cause: expect.objectContaining({ code: 'EPIPE' }) }),
		);
		expect(ours.destroyed).toBe(true);
	});

	it('odeslaná odpověď po sobě nenechá časovač', async () => {
		const { bridge } = windowFor();
		const [ours] = await pair();
		const session = bridge.open(ours);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

		await bridge.send(session, '{}');

		expect(vi.getTimerCount()).toBe(0);
	});

	it('connector, který nečte, se odpojí, místo aby držel odpověď', async () => {
		const { bridge } = windowFor();
		const [ours, peer] = await pair();
		const lines = readSocket(peer);
		peer.pause();
		const session = bridge.open(ours);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

		const sending = rejectionOf(bridge.send(session, 'a'.repeat(MAX_LINE)));
		await vi.advanceTimersByTimeAsync(5000);

		expect(await sending).toEqual(new Error(DISCONNECTED));
		peer.resume();
		await lines.first(Number.POSITIVE_INFINITY);
		expect(lines.closed).toBe(true);
	});

	it('zaseklý connector nezdrží ostatní', async () => {
		const { bridge } = windowFor();
		const [stuckOurs, stuckPeer] = await pair();
		stuckPeer.pause();
		const [otherOurs, otherPeer] = await pair();
		const other = readSocket(otherPeer);
		const stuck = bridge.open(stuckOurs);
		const session = bridge.open(otherOurs);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

		const stuckWrite = rejectionOf(bridge.send(stuck, 'a'.repeat(MAX_LINE)));
		await bridge.send(session, '{}');

		expect(await other.next()).toBe('{}');
		await vi.advanceTimersByTimeAsync(5000);
		expect(await stuckWrite).toEqual(new Error(DISCONNECTED));
	});

	it('znovu načítané okno ukončí spojení, aby jejich volání nevisela', async () => {
		const { bridge } = windowFor();
		const [ours, peer] = await pair();
		const lines = readSocket(peer);
		bridge.open(ours);
		bridge.attach();

		bridge.detach();

		expect(await lines.next()).toBe(null);
	});
});

describe('odpovědi mostu v JSON-RPC', () => {
	it('chybu dostane jen požadavek', () => {
		expect(rejection(REQUEST, 'Nejde to.')).toBe(toolError(7, 'Nejde to.'));
		// `null` je v JSON-RPC pořád id.
		expect(rejection('{"jsonrpc":"2.0","id":null,"method":"ping"}', 'Nejde to.')).toBe(
			toolError(null, 'Nejde to.'),
		);
		// Na notifikaci se neodpovídá.
		expect(rejection('{"jsonrpc":"2.0","method":"ping"}', 'Nejde to.')).toBe(undefined);
		// Odpověď klienta není požadavek.
		expect(rejection('{"jsonrpc":"2.0","id":7,"result":{}}', 'Nejde to.')).toBe(undefined);
		expect(rejection('{nejde', 'Nejde to.')).toBe(undefined);
		expect(rejection('7', 'Nejde to.')).toBe(undefined);
		expect(rejection('null', 'Nejde to.')).toBe(undefined);
	});

	it('chyba protokolu je JSON-RPC', () => {
		expect(JSON.parse(rpcError('a', SERVER_ERROR, 'Nejde to.'))).toEqual({
			jsonrpc: '2.0',
			id: 'a',
			error: {
				code: -32_000,
				message: 'Nejde to.',
			},
		});
	});

	it('chyba appky je výsledek nástroje, který agent přečte', () => {
		expect(JSON.parse(toolError('a', 'Nejde to.'))).toEqual({
			jsonrpc: '2.0',
			id: 'a',
			result: {
				content: [
					{
						type: 'text',
						text: 'Nejde to.',
					},
				],
				isError: true,
			},
		});
	});
});

describe('řádky spojení', () => {
	async function* chunks(...parts: string[]) {
		for (const part of parts) yield Buffer.from(part);
	}

	async function read(lines: AsyncGenerator<Buffer | null, void>): Promise<(string | null)[]> {
		const all: (string | null)[] = [];
		for await (const line of lines) all.push(line === null ? null : line.toString());
		return all;
	}

	it('řádky přes hranice kusů se slepí a useknutý konec se zahodí', async () => {
		expect(await read(readLines(chunks('a\nb', 'c\n\nd', 'e')))).toEqual(['a', 'bc', '']);
	});

	it('řádek přes limit skončí čtení, ať v něm konec je, nebo ne', async () => {
		expect(await read(readLines(chunks('abc\nabcd\nx\n'), 4))).toEqual(['abc', null]);
		expect(await read(readLines(chunks('abc', 'de'), 4))).toEqual([null]);
		expect(await read(readLines(chunks('abcd'), 4))).toEqual([]);
		expect(await read(readLines(chunks('aa\nbbb\n'), 4))).toEqual(['aa', 'bbb']);
	});
});

describe('cesty mostu', () => {
	it('socket leží v Application Support, ne ve vaultu', () => {
		vi.stubEnv('HOME', '/Users/jana');

		expect(mcpSocketPath()).toBe('/Users/jana/Library/Application Support/com.fakturian.desktop/mcp.sock');
	});

	it('bez domovské složky most nemá kde naslouchat', () => {
		vi.stubEnv('HOME', undefined);

		expect(thrownBy(mcpSocketPath)).toEqual(
			new Error('Domovskou složku nejde zjistit, MCP most proto nemá kde naslouchat.', {
				cause: new Error(
					'Domovská složka není známá: proměnná prostředí HOME chybí nebo není absolutní cesta.',
				),
			}),
		);
	});

	it('klíč leží vedle socketu', () => {
		expect(tokenPath('/podpora/mcp.sock')).toBe('/podpora/mcp.token');
	});

	it('connector je táž appka s přepínačem --mcp, ve vývoji Electron s cestou k appce', () => {
		expect(
			mcpConnector({
				execPath: '/Applications/Fakturian.app/Contents/MacOS/Fakturian',
				appPath: '/x',
				packaged: true,
			}),
		).toEqual({
			command: '/Applications/Fakturian.app/Contents/MacOS/Fakturian',
			args: ['--mcp'],
		});
		expect(
			mcpConnector({
				execPath: '/repo/node_modules/electron/dist/Electron',
				appPath: '/repo',
				packaged: false,
			}),
		).toEqual({
			command: '/repo/node_modules/electron/dist/Electron',
			args: ['/repo', '--mcp'],
		});
	});
});

describe('most na unixovém socketu', () => {
	let socket = '';
	const servers: McpServer[] = [];

	beforeEach(() => {
		socket = join(dir, 'mcp.sock');
	});

	afterEach(async () => {
		for (const server of servers.splice(0)) await server.close();
	});

	// Most s připojeným oknem; klíč čte ze souboru jako connector.
	async function startBridge(path = socket) {
		const window = windowFor();
		window.bridge.attach();
		servers.push(await serveMcp(path, window.bridge));
		const token = await readFile(tokenPath(path), 'utf8');
		return {
			...window,
			token,
		};
	}

	async function client(path = socket): Promise<{ socket: Socket; lines: Lines }> {
		const opened = await connect(path);
		sockets.push(opened);
		return {
			socket: opened,
			lines: readSocket(opened),
		};
	}

	// Connector, kterého most po představení klíčem pustil dál.
	async function introduced(token: string) {
		const opened = await client();
		opened.socket.write(`${token}\n`);
		expect(await opened.lines.next()).toBe(READY);
		return opened;
	}

	async function mode(path: string): Promise<number> {
		const info = await stat(path);
		return info.mode & 0o777;
	}

	it('connector s klíčem dojde k oknu a dostane jeho odpověď', async () => {
		const most = await startBridge();
		const agent = await introduced(most.token);

		agent.socket.write(`${REQUEST}\n`);
		const message = await most.next();
		await most.bridge.send(message.session, '{"jsonrpc":"2.0","id":7,"result":{}}');

		expect(message.line).toBe(REQUEST);
		expect(await agent.lines.next()).toBe('{"jsonrpc":"2.0","id":7,"result":{}}');
	});

	it('spojení bez klíče se odmítne a k oknu nic nedojde', async () => {
		const most = await startBridge();
		const agent = await client();

		agent.socket.write(`${REQUEST}\n`);

		expect(await agent.lines.next()).toBe(UNAUTHORIZED);
		expect(await agent.lines.next()).toBe(null);
		expect(most.seen).toEqual([]);
	});

	it('klíč s mezerou nebo návratem vozíku na konci projde', async () => {
		const most = await startBridge();
		const opened = await client();

		opened.socket.write(`${most.token} \r\n`);

		expect(await opened.lines.next()).toBe(READY);
	});

	it('chyba spojení odmítnutého pro plný most most neshodí', async () => {
		const listen = vi.spyOn(Server.prototype, 'listen');
		await startBridge();
		const [server] = listen.mock.contexts;
		const extra = Array.from({ length: MAX_CLIENTS + 1 }, () => new Socket());
		sockets.push(...extra);

		for (const connection of extra) server.emit('connection', connection);

		expect(() => extra.at(-1)?.emit('error', new Error('EPIPE'))).not.toThrow();
	});

	it('klíč stejné délky, který nesedí, se odmítne', async () => {
		const most = await startBridge();
		const agent = await client();

		agent.socket.write(`${'0'.repeat(most.token.length)}\n`);

		expect(await agent.lines.next()).toBe(UNAUTHORIZED);
	});

	it('spojení, které odejde před představením, k oknu nedojde', async () => {
		const most = await startBridge();
		const leaving = await client();
		leaving.socket.end();
		expect(await leaving.lines.next()).toBe(null);

		const agent = await introduced(most.token);
		agent.socket.write(`${REQUEST}\n`);

		const message = await most.next();
		expect(message.line).toBe(REQUEST);
	});

	it('klíč, který není UTF-8, se odmítne jako špatný', async () => {
		await startBridge();
		const agent = await client();

		agent.socket.write(Buffer.from([0xff, 0xfe, 0x0a]));

		expect(await agent.lines.next()).toBe(UNAUTHORIZED);
	});

	it('zpráva, která není UTF-8, dostane chybu místo zkomolené zprávy', async () => {
		const most = await startBridge();
		const agent = await introduced(most.token);

		agent.socket.write(Buffer.concat([Buffer.from('{"x":"'), Buffer.from([0xff]), Buffer.from('"}\n')]));
		agent.socket.write(`${REQUEST}\n`);

		const error = await agent.lines.next();
		expect(JSON.parse(error)).toEqual({
			jsonrpc: '2.0',
			id: null,
			error: {
				code: -32_700,
				message: 'Zpráva není text v UTF-8.',
			},
		});
		const message = await most.next();
		expect(message.line).toBe(REQUEST);
	});

	it('po limitu se odpojí jen spojení, které se nepředstavilo', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const most = await startBridge();
		const agent = await introduced(most.token);
		const silent = await client();

		await vi.advanceTimersByTimeAsync(4999);
		expect(silent.lines.closed).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(await silent.lines.next()).toBe(null);

		// Představené spojení limit přežilo a zprávu doručí.
		agent.socket.write(`${REQUEST}\n`);
		const message = await most.next();
		expect(message.line).toBe(REQUEST);
	});

	it('prázdné řádky k oknu nedojdou', async () => {
		const most = await startBridge();
		const agent = await introduced(most.token);

		agent.socket.write(`\n   \n${REQUEST}\n`);

		const message = await most.next();
		expect(message.line).toBe(REQUEST);
	});

	it('dva connectory mají každý své spojení', async () => {
		const most = await startBridge();
		const first = await introduced(most.token);
		const second = await introduced(most.token);

		first.socket.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
		const one = await most.next();
		second.socket.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
		const two = await most.next();
		await most.bridge.send(two.session, '{"jsonrpc":"2.0","id":1,"result":"druhý"}');
		await most.bridge.send(one.session, '{"jsonrpc":"2.0","id":1,"result":"první"}');

		expect(one.session).not.toBe(two.session);
		expect(await first.lines.next()).toBe('{"jsonrpc":"2.0","id":1,"result":"první"}');
		expect(await second.lines.next()).toBe('{"jsonrpc":"2.0","id":1,"result":"druhý"}');
	});

	it('odpojení connectoru se ohlásí oknu', async () => {
		const most = await startBridge();
		const agent = await introduced(most.token);
		agent.socket.write(`${REQUEST}\n`);
		const { session } = await most.next();

		agent.socket.destroy();

		expect(await most.next()).toEqual({ session });
		await expect(most.bridge.send(session, '{}')).rejects.toThrow(DISCONNECTED);
	});

	it('connectory nad limit se odmítnou, dokud jeden neodejde', async () => {
		const most = await startBridge();
		const connected = [];
		for (let i = 0; i < MAX_CLIENTS; i++) connected.push(await introduced(most.token));

		const refused = await client();
		expect(await refused.lines.next()).toBe('K mostu je připojeno příliš mnoho agentů najednou.');
		expect(await refused.lines.next()).toBe(null);

		const leaving = connected.pop();
		leaving.socket.destroy();
		await most.next();
		await introduced(most.token);
	});

	it('příliš dlouhý řádek s klíčem se odmítne', async () => {
		await startBridge();
		const agent = await client();

		agent.socket.write('a'.repeat(MAX_LINE + 1));

		expect(await agent.lines.next()).toBe(TOO_LONG);
	});

	it('příliš dlouhá zpráva dostane chybu protokolu a spojení se zavře', async () => {
		const most = await startBridge();
		const agent = await introduced(most.token);

		agent.socket.write(`${'a'.repeat(MAX_LINE + 1024)}\n`);

		expect(await agent.lines.next()).toBe(rpcError(null, SERVER_ERROR, TOO_LONG));
		expect(await agent.lines.next()).toBe(null);
		// Okno se dozví jen o zavření.
		const message = await most.next();
		expect(message.line).toBe(undefined);
	});

	it('řádek přesně na limitu do okna dojde', async () => {
		const most = await startBridge();
		const agent = await introduced(most.token);
		const prefix = '{"jsonrpc":"2.0","method":"x","params":{"padding":"';
		const suffix = '"}}';
		const message = `${prefix}${'a'.repeat(MAX_LINE - prefix.length - suffix.length - 1)}${suffix}`;
		expect(message.length + 1).toBe(MAX_LINE);

		agent.socket.write(`${message}\n`);

		const arrived = await most.next();
		expect(arrived.line).toHaveLength(message.length);
	});

	it('chybějící složka socketu vznikne a socket, složka i klíč patří jen vlastníkovi', async () => {
		const path = join(dir, 'runtime', 'mcp.sock');

		await startBridge(path);

		expect([await mode(path), await mode(join(dir, 'runtime')), await mode(tokenPath(path))]).toEqual([
			0o600, 0o700, 0o600,
		]);
	});

	it('běžící most řekne, na které cestě naslouchá', async () => {
		const path = join(dir, 'runtime', 'mcp.sock');

		await startBridge(path);

		expect(servers.map((server) => server.socket)).toEqual([path]);
	});

	it('klíč je dlouhý a náhodný', async () => {
		const first = await startBridge();
		const second = await startBridge(join(dir, 'druhy', 'mcp.sock'));

		expect(first.token).toMatch(/^[0-9a-f]{64}$/);
		expect(second.token).not.toBe(first.token);
	});

	it('socket bez rodičovské složky se odmítne', async () => {
		await expect(serveMcp('/', windowFor().bridge)).rejects.toThrow('MCP socket nemá rodičovskou složku.');
	});

	it('druhá instance živý socket ani jeho klíč nepřevezme', async () => {
		const most = await startBridge();

		await expect(serveMcp(socket, windowFor().bridge)).rejects.toThrow(
			'MCP socket už obsluhuje jiná instance Fakturianu.',
		);
		expect(await readFile(tokenPath(socket), 'utf8')).toBe(most.token);
	});

	it('socket, na který nejde naslouchat, klíč nechá být', async () => {
		// Neprázdná složka na místě socketu: nejde se k ní připojit, smazat ani na ni naslouchat.
		await mkdir(join(socket, 'uvnitr'), { recursive: true });
		await writeFile(tokenPath(socket), 'stary');

		const error = await rejectionOf(serveMcp(socket, windowFor().bridge));

		expect(error).toMatchObject({ code: 'EADDRINUSE' });
		expect(await readFile(tokenPath(socket), 'utf8')).toBe('stary');
	});

	it('klíč, který nejde vydat, most zavře a rozepsaný klíč uklidí', async () => {
		await mkdir(join(tokenPath(socket), 'uvnitr'), { recursive: true });

		const error = await rejectionOf(serveMcp(socket, windowFor().bridge));

		expect(error).toMatchObject({ code: expect.stringMatching(/^E/) });
		await expect(connect(socket)).rejects.toThrow('ENOENT');
		expect(await readdir(dir)).toEqual(['mcp.token']);
	});

	it('dočasný soubor klíče, který už existuje, se nepřepíše', async () => {
		vi.mocked(randomBytes).mockImplementation((size: number) => Buffer.alloc(size, 0xab));
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, `.mcp.token-${'ab'.repeat(8)}`), 'cizí');

		const error = await rejectionOf(serveMcp(socket, windowFor().bridge));

		expect(error).toMatchObject({ code: 'EEXIST' });
	});

	it('osiřelý socket i klíč se nahradí', async () => {
		await writeFile(socket, 'pozustatek');
		await writeFile(tokenPath(socket), 'stary');

		const most = await startBridge();

		expect(most.token).not.toBe('stary');
		await introduced(most.token);
	});

	it('chyba při přijímání spojení se zaloguje a most naslouchá dál', async () => {
		vi.stubEnv('HOME', dir);
		const listen = vi.spyOn(Server.prototype, 'listen');
		const most = await startBridge();
		const [server] = listen.mock.contexts;

		server.emit('error', new Error('EMFILE: too many open files'));

		await introduced(most.token);
		await vi.waitFor(async () => {
			expect(await loggedLines(dir)).toEqual(['MCP most nepřijal spojení: EMFILE: too many open files']);
		});
	});

	it('zavření mostu odpojí connectory a okno se to dozví', async () => {
		const most = await startBridge();
		const agent = await introduced(most.token);

		const [server] = servers.splice(0);
		await server.close();

		expect(await agent.lines.next()).toBe(null);
		expect(most.seen).toEqual([{ session: 1 }]);
	});
});
