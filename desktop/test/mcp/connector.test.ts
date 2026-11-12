import { once } from 'node:events';
import { rm, writeFile } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { output, readSocket, socketDir } from './sockets.ts';

import { runConnector } from '../../mcp/connector.ts';
import { Bridge, MAX_LINE, type McpServer, READY, serveMcp, tokenPath, type WindowMessage } from '../../mcp/mod.ts';
import { VERSION } from '../../version.ts';

const APP_NOT_RUNNING = 'Fakturian neběží. Spusť appku — agent pracuje proti ní, ne přímo se soubory.';
const INTERRUPTED =
	'Spojení s Fakturianem se během volání přerušilo (appka skončila nebo se okno znovu načetlo). ' +
	'Výsledek není známý — u create_invoice nejdřív ověř list_invoices, než to zkusíš znovu.';
const CALL = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"summary"}}';
const CANCELLED = '{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1}}';
const PING = '{"jsonrpc":"2.0","id":4,"method":"ping"}';
const INITIALIZED = '{"jsonrpc":"2.0","method":"notifications/initialized"}';
const UNUSED_SOCKET = '/nikde/mcp.sock';

function call(id: unknown): string {
	return JSON.stringify({
		jsonrpc: '2.0',
		id,
		method: 'tools/call',
		params: {
			name: 'summary',
		},
	});
}

function cancelled(requestId: unknown): string {
	return JSON.stringify({
		jsonrpc: '2.0',
		method: 'notifications/cancelled',
		params: {
			requestId,
		},
	});
}

// Zrušení dlouhé `length` bajtů bez konce řádku.
function cancellationOf(length: number): string {
	const base = cancelled(9).replace('}}', ',"reason":""}}');
	return base.replace('"reason":""', `"reason":"${'a'.repeat(length - base.length)}"`);
}

// Volání dlouhé `length` bajtů bez konce řádku.
function paddedCall(length: number): string {
	return CALL.replace('summary', 'a'.repeat(length - CALL.length + 'summary'.length));
}

function answer(id: unknown) {
	return {
		jsonrpc: '2.0',
		id,
		result: {},
	};
}

function toolError(id: unknown, message: string) {
	return {
		jsonrpc: '2.0',
		id,
		result: {
			content: [
				{
					type: 'text',
					text: message,
				},
			],
			isError: true,
		},
	};
}

// Zaseknuté spojení má test shodit hned: celá sada běží v desítkách milisekund.
vi.setConfig({
	testTimeout: 2000,
	hookTimeout: 2000,
});

let dir = '';
const cleanups: (() => Promise<void> | void)[] = [];

beforeEach(async () => {
	dir = await socketDir('mcp-connector');
});

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
	await rm(dir, { recursive: true });
});

// Connector nad hotovým vstupem; odpovědi okna dojdou až po konci vstupu.
async function served(lines: string[], socket: string) {
	const out = output();
	const code = await runConnector(Readable.from([Buffer.from(`${lines.join('\n')}\n`)]), out.stream, socket);
	expect(code).toBe(0);
	return out.lines;
}

async function answers(lines: string[], socket: string, count = lines.length): Promise<unknown[]> {
	const received = await served(lines, socket);
	const first = await received.first(count);
	return first.map((line) => JSON.parse(line));
}

// Connector s rourou místo stdin, aby test mohl psát, až se předchozí volání vyřídí.
function connectorOn(socket: string) {
	const agent = new PassThrough();
	const out = output();
	const running = runConnector(agent, out.stream, socket);
	cleanups.push(async () => {
		agent.end();
		await running;
	});
	return {
		write: (...lines: string[]) => agent.write(`${lines.join('\n')}\n`),
		answers: async (count: number) => {
			const lines = await out.lines.first(count);
			return lines.map((line) => JSON.parse(line));
		},
		lines: out.lines,
	};
}

// Skutečný most; okno s `answering` odpoví na každý požadavek jeho metodou, jinak jen poslouchá.
async function runApp(answering: boolean) {
	const path = join(dir, 'mcp.sock');
	const seen: WindowMessage[] = [];
	let wake: (() => void) | undefined;
	const bridge: Bridge = new Bridge((message) => {
		seen.push(message);
		wake?.();
		if (!answering || message.line === undefined) return;
		const request = JSON.parse(message.line);
		if (request.id === undefined) return;
		const reply = JSON.stringify({
			jsonrpc: '2.0',
			id: request.id,
			result: {
				method: request.method,
			},
		});
		// Connector, který mezitím odešel, odpověď nepotřebuje.
		void Promise.allSettled([bridge.send(message.session, reply)]);
	});
	const arrived = () =>
		new Promise<void>((resolve) => {
			wake = resolve;
		});
	bridge.attach();
	const server: McpServer = await serveMcp(path, bridge);
	cleanups.push(() => server.close());
	return {
		path,
		bridge,
		// Na notifikace okno neodpovídá, takže se na jejich záznam čeká.
		async messages(count: number): Promise<WindowMessage[]> {
			while (seen.length < count) await arrived();
			return seen.slice(0, count);
		},
		async seen(count: number): Promise<(string | undefined)[]> {
			const messages = await this.messages(count);
			return messages.map((message) => message.line);
		},
	};
}

// Appka, která spojení přijme a udělá s ním, co řekne `handle`.
async function fakeApp(handle: (socket: Socket, lines: ReturnType<typeof readSocket>) => Promise<void> | void) {
	const path = join(dir, 'mcp.sock');
	// Konec řádku navíc: connector klíč ořízne, jinak by neseděl.
	await writeFile(tokenPath(path), 'test-klic\n');
	const connections = new Set<Socket>();
	const server = createServer((socket) => {
		connections.add(socket);
		socket.on('error', () => undefined);
		void handle(socket, readSocket(socket));
	});
	server.listen(path);
	await once(server, 'listening');
	cleanups.push(async () => {
		const closed = once(server, 'close');
		server.close();
		for (const socket of connections) socket.destroy();
		await closed;
	});
	return path;
}

// Appka, která každé spojení po představení nechá přečíst `count` řádků, na volání s `id`
// z `answered` odpoví a spojení zavře — jako když skončí nebo se okno znovu načte.
function appEndingAfter(count: number, answered: unknown[]) {
	return fakeApp(async (socket, lines) => {
		await lines.next();
		socket.write(`${READY}\n`);
		for (let i = 0; i < count; i++) {
			const received = await lines.next();
			const request = JSON.parse(received);
			if (answered.includes(request.id)) socket.write(`${JSON.stringify(answer(request.id))}\n`);
		}
		socket.end();
	});
}

describe('connector bez appky', () => {
	it('initialize představí server bez appky', async () => {
		expect(await answers(['{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'], UNUSED_SOCKET)).toEqual([
			{
				jsonrpc: '2.0',
				id: 1,
				result: {
					protocolVersion: '2024-11-05',
					capabilities: {
						tools: {},
					},
					serverInfo: {
						name: 'fakturian',
						version: VERSION,
					},
				},
			},
		]);
	});

	it('seznam nástrojů dojde bez appky', async () => {
		const [list] = await answers(['{"jsonrpc":"2.0","id":"a","method":"tools/list"}'], UNUSED_SOCKET);

		expect(list).toMatchObject({
			jsonrpc: '2.0',
			id: 'a',
		});
		expect(list.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
			'list_invoices',
			'get_invoice',
			'list_contacts',
			'list_expenses',
			'pricelist_status',
			'summary',
			'create_invoice',
		]);
		expect(list.result.tools[0].inputSchema).toMatchObject({ type: 'object' });
	});

	it('ping dostane prázdnou odpověď', async () => {
		expect(await answers([PING], UNUSED_SOCKET)).toEqual([answer(4)]);
	});

	it('neznámá metoda je v chybě jménem', async () => {
		expect(await answers(['{"jsonrpc":"2.0","id":5,"method":"resources/list"}'], UNUSED_SOCKET)).toEqual([
			{
				jsonrpc: '2.0',
				id: 5,
				error: {
					code: -32_601,
					message: 'Neznámá metoda: resources/list',
				},
			},
		]);
	});

	it('nečitelný řádek dostane chybu rozboru a protokol jede dál', async () => {
		expect(await answers(['{nejde', PING], UNUSED_SOCKET)).toEqual([
			{
				jsonrpc: '2.0',
				id: null,
				error: {
					code: -32_700,
					message: 'Zpráva není JSON.',
				},
			},
			answer(4),
		]);
	});

	it('vstup, který není UTF-8, dostane chybu rozboru a protokol jede dál', async () => {
		const out = output();
		const input = Readable.from([
			Buffer.concat([Buffer.from('{"x":"'), Buffer.from([0xff]), Buffer.from(`"}\n${PING}\n`)]),
		]);

		expect(await runConnector(input, out.stream, UNUSED_SOCKET)).toBe(0);

		const lines = await out.lines.first(2);
		expect(lines.map((line) => JSON.parse(line))).toEqual([
			{
				jsonrpc: '2.0',
				id: null,
				error: {
					code: -32_700,
					message: 'Zpráva není text v UTF-8.',
				},
			},
			answer(4),
		]);
	});

	it('notifikace, odpovědi klienta, prázdné a cizí řádky zůstanou bez odpovědi', async () => {
		const received = await served(
			[
				INITIALIZED,
				'{"jsonrpc":"2.0","id":9,"result":{}}',
				'   ',
				'[1]',
				'5',
				'{"jsonrpc":"2.0","id":3,"method":5}',
				'{"jsonrpc":"2.0","method":"tools/call"}',
				PING,
			],
			UNUSED_SOCKET,
		);

		const lines = await received.first(1);
		expect(lines.map((line) => JSON.parse(line))).toEqual([answer(4)]);
		expect(received.received).toHaveLength(1);
	});

	it('id volání, které by okno změnilo, se odmítne', async () => {
		const error = (id: unknown) => ({
			jsonrpc: '2.0',
			id,
			error: {
				code: -32_600,
				message: 'Id volání musí být řetězec nebo celé nezáporné číslo menší než 2^53.',
			},
		});

		expect(
			await answers(
				[
					call(1.5),
					call(true),
					call(-1),
					call(null),
					'{"jsonrpc":"2.0","id":9007199254740992,"method":"tools/call"}',
				],
				UNUSED_SOCKET,
			),
		).toEqual([error(1.5), error(true), error(-1), error(null), error(9_007_199_254_740_992)]);
	});

	it('volání nástroje se dozví, že appka neběží', async () => {
		expect(await answers([CALL], UNUSED_SOCKET)).toEqual([toolError(1, APP_NOT_RUNNING)]);
	});

	it('zrušení s id je neznámá metoda', async () => {
		expect(
			await answers(
				['{"jsonrpc":"2.0","id":5,"method":"notifications/cancelled","params":{"requestId":1}}'],
				UNUSED_SOCKET,
			),
		).toEqual([
			{
				jsonrpc: '2.0',
				id: 5,
				error: {
					code: -32_601,
					message: 'Neznámá metoda: notifications/cancelled',
				},
			},
		]);
	});

	it('zrušení bez appky zůstane potichu', async () => {
		const received = await served([CANCELLED, PING], UNUSED_SOCKET);

		const lines = await received.first(1);
		expect(lines.map((line) => JSON.parse(line))).toEqual([answer(4)]);
	});

	it('volání na limitu se odmítne s jeho id dřív, než dojde k appce', async () => {
		expect(await answers([paddedCall(MAX_LINE)], UNUSED_SOCKET)).toEqual([
			toolError(1, 'Zpráva je delší než 1 MiB — most ji odmítl.'),
		]);
	});

	it('socket, který nikdo neobsluhuje, je vypnutá appka', async () => {
		const path = join(dir, 'mcp.sock');
		await writeFile(tokenPath(path), 'klic');

		expect(await answers([CALL], path)).toEqual([toolError(1, APP_NOT_RUNNING)]);
	});
});

describe('connector se skutečnou appkou', () => {
	it('volání nástroje dojde do okna beze změny a odpověď zpátky', async () => {
		const app = await runApp(true);

		expect(await answers([CALL], app.path)).toEqual([
			{
				jsonrpc: '2.0',
				id: 1,
				result: {
					method: 'tools/call',
				},
			},
		]);
		expect(await app.seen(1)).toEqual([CALL]);
	});

	it('id, které okno zachová, projde', async () => {
		const app = await runApp(true);

		const received = await answers([call('a'), call(0), call(Number.MAX_SAFE_INTEGER)], app.path);
		const handled = received.map((one: { id: unknown; result?: { method: string } }) => [
			one.id,
			one.result?.method,
		]);

		expect(handled.toSorted()).toEqual([
			[0, 'tools/call'],
			[Number.MAX_SAFE_INTEGER, 'tools/call'],
			['a', 'tools/call'],
		]);
	});

	it('příliš dlouhé zrušení zůstane v connectoru, aby ostatní volání přežila', async () => {
		const app = await runApp(true);
		const long = cancellationOf(MAX_LINE);

		const received = await answers([CALL, long, PING], app.path, 2);

		// Na `ping` odpoví connector, na volání okno, takže pořadí odpovědí není dané.
		expect(received.toSorted((a: { id: number }, b: { id: number }) => a.id - b.id)).toEqual([
			{
				jsonrpc: '2.0',
				id: 1,
				result: {
					method: 'tools/call',
				},
			},
			answer(4),
		]);
		expect(await app.seen(1)).toEqual([CALL]);
	});

	it('zrušení na limitu do okna nedojde a rozběhnuté volání nepřeruší', async () => {
		const app = await runApp(false);
		const connector = connectorOn(app.path);

		connector.write(CALL, cancellationOf(MAX_LINE), call(2));

		expect(await app.seen(2)).toEqual([CALL, call(2)]);
	});

	it('zrušení těsně pod limitem do okna dojde', async () => {
		const app = await runApp(true);
		const near = cancellationOf(MAX_LINE - 1);

		await served([CALL, near], app.path);

		expect(await app.seen(2)).toEqual([CALL, near]);
	});

	it('odmítnutí zastaralého klíče skutečnou appkou dojde agentovi', async () => {
		const app = await runApp(true);
		await writeFile(tokenPath(app.path), 'stary-klic');

		expect(await answers([CALL], app.path)).toEqual([
			toolError(
				1,
				'Spojení nenese platný klíč mostu z mcp.token. Pokud se Fakturian právě spouštěl, zkus to znovu.',
			),
		]);
	});

	it('znovu načítané okno přeruší volání, které vyřizovalo', async () => {
		const app = await runApp(false);
		const connector = connectorOn(app.path);
		connector.write(CALL);
		expect(await app.seen(1)).toEqual([CALL]);

		app.bridge.detach();

		expect(await connector.answers(1)).toEqual([toolError(1, INTERRUPTED)]);
	});

	it('do okna dojde jen zrušení a volání nástroje', async () => {
		const app = await runApp(true);
		const withoutId = '{"jsonrpc":"2.0","method":"notifications/cancelled","params":{}}';
		const withoutParams = '{"jsonrpc":"2.0","method":"notifications/cancelled"}';

		await answers([CALL, PING, INITIALIZED, CANCELLED, withoutId, withoutParams], app.path, 2);

		expect(await app.seen(4)).toEqual([CALL, CANCELLED, withoutId, withoutParams]);
	});

	it('volání těsně pod limitem dojde do okna', async () => {
		const app = await runApp(true);

		const [received] = await answers([paddedCall(MAX_LINE - 1)], app.path);

		expect(received).toMatchObject({
			result: {
				method: 'tools/call',
			},
		});
	});

	it('druhé volání jde stejným spojením', async () => {
		const app = await runApp(true);

		const received = await answers([call(1), call(2)], app.path);

		expect(received).toEqual([
			{
				jsonrpc: '2.0',
				id: 1,
				result: {
					method: 'tools/call',
				},
			},
			{
				jsonrpc: '2.0',
				id: 2,
				result: {
					method: 'tools/call',
				},
			},
		]);
		const [first, second] = await app.messages(2);
		expect(second.session).toBe(first.session);
	});
});

describe('connector s appkou, která spojení ukončí', () => {
	it('odmítnutí spojení appkou dojde agentovi', async () => {
		const path = await fakeApp(async (socket, lines) => {
			expect(await lines.next()).toBe('test-klic');
			socket.end('Spojení nenese platný klíč mostu z mcp.token.\n');
		});

		expect(await answers([CALL], path)).toEqual([toolError(1, 'Spojení nenese platný klíč mostu z mcp.token.')]);
	});

	it('odmítnuté spojení connector sám zavře', async () => {
		const closed = Promise.withResolvers<void>();
		const path = await fakeApp(async (socket, lines) => {
			await lines.next();
			socket.write('Odmítnuto.\n');
			socket.on('close', () => closed.resolve());
		});

		expect(await answers([CALL], path)).toEqual([toolError(1, 'Odmítnuto.')]);
		await closed.promise;
	});

	it('pozdrav appky s mezerami a návratem vozíku platí', async () => {
		const path = await fakeApp(async (socket, lines) => {
			await lines.next();
			socket.write(` ${READY} \r\n`);
			const request = JSON.parse(await lines.next());
			socket.write(`${JSON.stringify(answer(request.id))}\n`);
		});

		expect(await answers([CALL], path)).toEqual([answer(1)]);
	});

	it('appka, která zavěsí před představením, se ohlásí', async () => {
		const path = await fakeApp(async (socket, lines) => {
			await lines.next();
			socket.end();
		});

		expect(await answers([CALL], path)).toEqual([toolError(1, 'Fakturian spojení zavřel bez odpovědi.')]);
	});

	it('volání přerušené koncem appky dostane odpověď i tak', async () => {
		const path = await appEndingAfter(1, []);
		const connector = connectorOn(path);

		connector.write(CALL);

		expect(await connector.answers(1)).toEqual([toolError(1, INTERRUPTED)]);
	});

	it('zodpovězená a zrušená volání po konci spojení nic dalšího nedostanou', async () => {
		const path = await appEndingAfter(4, [1]);
		const connector = connectorOn(path);

		connector.write(call(1), call(2), cancelled(2), call(3));

		expect(await connector.answers(2)).toEqual([answer(1), toolError(3, INTERRUPTED)]);
	});

	it('zrušení po konci appky zůstane potichu', async () => {
		const path = await appEndingAfter(1, []);
		const connector = connectorOn(path);
		connector.write(call(1));
		await connector.answers(1);

		connector.write(cancelled(1), '{"jsonrpc":"2.0","id":9,"method":"ping"}');

		expect(await connector.answers(2)).toEqual([toolError(1, INTERRUPTED), answer(9)]);
	});

	it('po konci appky další volání otevře nové spojení', async () => {
		// První spojení volání 1 přeruší, druhé na volání 2 odpoví.
		const path = await appEndingAfter(1, [2]);
		const connector = connectorOn(path);
		connector.write(call(1));
		// Odpověď o přerušení přijde až po konci spojení, takže volání 2 staré spojení nezastihne.
		await connector.answers(1);

		connector.write(call(2));

		expect(await connector.answers(2)).toEqual([toolError(1, INTERRUPTED), answer(2)]);
	});

	it('řádky appky, které nejsou odpovědi, projdou beze změny', async () => {
		const path = await fakeApp(async (socket, lines) => {
			await lines.next();
			socket.write(`${READY}\n`);
			await lines.next();
			socket.write(`nejde\n[]\na\rb\r\n${INITIALIZED}\r\n${JSON.stringify(answer(1))}\n`);
		});
		const connector = connectorOn(path);

		connector.write(CALL);

		expect(await connector.lines.first(5)).toEqual(['nejde', '[]', 'a\rb', INITIALIZED, JSON.stringify(answer(1))]);
	});

	it('řádek appky, který není UTF-8, spojení ukončí a volání přeruší', async () => {
		const path = await fakeApp(async (socket, lines) => {
			await lines.next();
			socket.write(`${READY}\n`);
			await lines.next();
			socket.write(Buffer.from([0xff, 0x0a]));
		});
		const connector = connectorOn(path);

		connector.write(CALL);

		expect(await connector.answers(1)).toEqual([toolError(1, INTERRUPTED)]);
	});
});

describe('konec connectoru', () => {
	it('zavřený výstup protokol ukončí kódem 1 a důvod napíše na stderr', async () => {
		const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((_chunk, done) => {
			if (typeof done === 'function') done();
			return true;
		});
		const closed = new Writable({
			write(_chunk, _encoding, done) {
				done(new Error('EPIPE: broken pipe, write'));
			},
		});

		expect(await runConnector(Readable.from([Buffer.from(`${PING}\n`)]), closed, UNUSED_SOCKET)).toBe(1);
		// Bez posluchače by chyba zápisu jako událost `error` shodila celý proces.
		expect(closed.listenerCount('error')).toBe(1);
		expect(stderr).toHaveBeenCalledWith('EPIPE: broken pipe, write\n', expect.any(Function));
	});

	it('chyba čtení vstupu skončí kódem 1', async () => {
		vi.spyOn(process.stderr, 'write').mockImplementation((_chunk, done) => {
			if (typeof done === 'function') done();
			return true;
		});
		const broken = new Readable({
			read() {
				this.destroy(new Error('EIO: i/o error, read'));
			},
		});

		expect(await runConnector(broken, output().stream, UNUSED_SOCKET)).toBe(1);
	});
});
