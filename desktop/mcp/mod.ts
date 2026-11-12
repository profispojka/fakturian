import { randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { chmod, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { createConnection, createServer, type Socket } from 'node:net';
import { dirname, join } from 'node:path';

import { errorText } from '~/utils/errors';

import { log } from '../log.ts';
import { appSupportDir } from '../preferences.ts';
import { parseJson } from '../store.ts';

import type { Writable } from 'node:stream';
import type { McpConnector } from '~/bindings';
import type { windowMessageSchema } from '~/schemas/mcp';
import type { Zod } from '~/utils/zod';

// Strop délky jednoho řádku protokolu i s jeho koncem: řádek se celý drží v paměti, takže bez něj by
// jeden connector poslal nekonečný řádek a appce došla paměť.
export const MAX_LINE = 1024 * 1024;

// Connector otevírající spojení v cyklu by bez stropu vyčerpal deskriptory appky.
export const MAX_CLIENTS = 8;

// Kolik zpráv počká na okno, které se teprve načítá; strop brání nafukování paměti.
export const MAX_BACKLOG = 32;

// Přepínač, kterým appka místo okna obslouží agenta na stdio.
export const MCP_ARG = '--mcp';

// Odpověď appky na platný klíč, po ní jde spojením JSON-RPC. Místo ní může přijít holá věta
// s důvodem odmítnutí, kterou connector předá agentovi.
export const READY = 'ok';

// Kód chyby, kterou nezavinil agent.
export const SERVER_ERROR = -32_000;

// Text, který není JSON — i bajty, které nejsou UTF-8.
export const PARSE_ERROR = -32_700;

export const TOO_LONG = 'Zpráva je delší než 1 MiB — most ji odmítl.';

export const NOT_TEXT = 'Zpráva není text v UTF-8.';

const TOKEN_BYTES = 32;

const UNAUTHORIZED = 'Spojení nenese platný klíč mostu z mcp.token. Pokud se Fakturian právě spouštěl, zkus to znovu.';

const TOO_MANY_CLIENTS = 'K mostu je připojeno příliš mnoho agentů najednou.';

const WINDOW_BUSY = 'Okno Fakturianu se ještě načítá. Zkus to za chvíli.';

const DISCONNECTED = 'Agent se od mostu odpojil.';

// Spojení, které se neprokáže klíčem, by jinak místo mezi spojeními drželo napořád. Platí pro celé
// představení, takže zdržovat po bajtech nejde.
const HANDSHAKE_TIMEOUT = 5000;

// Connector, který nečte, by jinak zápis odpovědi držel napořád.
const WRITE_TIMEOUT = 5000;

const NEWLINE = 0x0a;

// Stryker disable next-line StringLiteral: neplatné kódování hodí RangeError už při importu, takže se nespustí žádný test.
const UTF8 = new TextDecoder('utf-8', { fatal: true });

// Řádek JSON-RPC od connectoru pro okno; bez `line` hlásí, že connector spojení zavřel.
export type WindowMessage = Zod.infer<typeof windowMessageSchema>;

export interface McpServer {
	close(): Promise<void>;
}

// V `~/Library/Application Support/`, ne ve vaultu — ten se synchronizuje do cloudu. Bez domovské
// složky se most neotevře: náhradní místo typu `/tmp` může zapisovat kdokoli.
export function mcpSocketPath(): string {
	let dir: string;
	try {
		dir = appSupportDir();
	} catch (error) {
		throw new Error('Domovskou složku nejde zjistit, MCP most proto nemá kde naslouchat.', { cause: error });
	}
	return join(dir, 'mcp.sock');
}

// Klíč, který appka při každém startu vydá a connector posílá na začátku spojení. Socket s právy
// 0600 pustí jen procesy téhož účtu; klíč navíc odmítne proces, který o souboru neví.
export function tokenPath(socket: string): string {
	return join(dirname(socket), 'mcp.token');
}

// Connector je táž appka spuštěná s `MCP_ARG`. Ve vývoji je spustitelný soubor Electron, který appku
// najde až podle cesty v prvním argumentu.
export function mcpConnector(electron: { execPath: string; appPath: string; packaged: boolean }): McpConnector {
	return {
		command: electron.execPath,
		args: electron.packaged ? [MCP_ARG] : [electron.appPath, MCP_ARG],
	};
}

export function rpcError(id: unknown, code: number, message: string): string {
	return JSON.stringify({
		jsonrpc: '2.0',
		id,
		error: {
			code,
			message,
		},
	});
}

// Chyba appky jde jako `isError`, ne jako chyba protokolu: agent ji má přečíst a říct uživateli,
// co dělat.
export function toolError(id: unknown, message: string): string {
	return JSON.stringify({
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
	});
}

// Chyba na volání, které nedošlo k oknu. Notifikace ani nečitelný řádek odpověď nedostanou: na
// notifikaci se v JSON-RPC neodpovídá a bez `id` by agent nevěděl, k čemu chyba patří.
export function rejection(line: string, message: string): string | undefined {
	let request: unknown;
	try {
		request = parseJson(line);
	} /* Stryker disable next-line BlockStatement: ekvivalentní mutant, `undefined` místo požadavku dál nevyhoví ani kontrole tvaru. */ catch {
		return undefined;
	}
	if (typeof request !== 'object' || request === null || !('method' in request) || !('id' in request)) {
		return undefined;
	}
	return toolError(request.id, message);
}

// Řádek i s koncem jedním zápisem: kdyby spojení skončilo mezi nimi, druhá strana by neukončený řádek
// vzala za celou zprávu. Splní se, až data převezme systém.
export function writeLine(stream: Writable, line: string): Promise<void> {
	const written = Promise.withResolvers<void>();
	stream.write(`${line}\n`, (failure) => {
		if (failure) written.reject(failure);
		else written.resolve();
	});
	return written.promise;
}

// Řádky bez znaku konce; `null` místo řádku delšího než `limit` bajtů a po něm konec, protože zbytek
// by se musel dočíst bez limitu. Řádek useknutý koncem spojení je rozepsaná zpráva, ne celá.
export function readLines(stream: AsyncIterable<Buffer>): AsyncGenerator<Buffer, void>;
export function readLines(stream: AsyncIterable<Buffer>, limit: number): AsyncGenerator<Buffer | null, void>;
export async function* readLines(
	stream: AsyncIterable<Buffer>,
	limit = Number.POSITIVE_INFINITY,
): AsyncGenerator<Buffer | null, void> {
	let pending: Buffer[] = [];
	let length = 0;
	for await (const chunk of stream) {
		let start = 0;
		// Stryker disable next-line EqualityOperator,BlockStatement: mutant smyčku zacyklí, skončí jen timeoutem.
		for (let end = chunk.indexOf(NEWLINE); end >= 0; end = chunk.indexOf(NEWLINE, start)) {
			if (length + end - start >= limit) {
				yield null;
				return;
			}
			yield Buffer.concat([...pending, chunk.subarray(start, end)]);
			pending = [];
			length = 0;
			// Stryker disable next-line ArithmeticOperator: mutant smyčku zacyklí, skončí jen timeoutem.
			start = end + 1;
		}
		pending.push(chunk.subarray(start));
		length += chunk.length - start;
		if (length > limit) {
			yield null;
			return;
		}
	}
}

// Přepojuje spojení connectorů na okno. Most zná jen řádky a spojení, obsah zpráv čte okno.
export class Bridge {
	#emit: (message: WindowMessage) => void;
	// Načítané okno ještě neposlouchá, takže zprávy do `attach` čekají v `#backlog`.
	#attached = false;
	#backlog: WindowMessage[] = [];
	#sessions = new Map<number, Socket>();
	#lastSession = 0;

	constructor(emit: (message: WindowMessage) => void) {
		this.#emit = emit;
	}

	attach(): void {
		this.#attached = true;
		for (const message of this.#backlog.splice(0)) this.#emit(message);
	}

	// Stránka se začala načítat znovu a rozběhnutá volání zmizela s ní; connector na ně po zavření
	// spojení odpoví sám. Stránka, která se nepřipojila, nic nedostala, takže fronta počká na další.
	detach(): void {
		if (!this.#attached) return;
		this.#attached = false;
		for (const socket of this.#sessions.values()) socket.destroy();
		this.#sessions.clear();
	}

	open(socket: Socket): number {
		this.#lastSession += 1;
		this.#sessions.set(this.#lastSession, socket);
		return this.#lastSession;
	}

	async receive(session: number, line: string): Promise<void> {
		const delivered = this.#deliver({
			session,
			line,
		});
		if (delivered) return;
		const answer = rejection(line, WINDOW_BUSY);
		// Connector, který se mezitím odpojil, odpověď nepotřebuje.
		// Stryker disable next-line ConditionalExpression: ekvivalentní mutant, `send` bez řádku vyhodí a `allSettled` chybu spolkne.
		if (answer !== undefined) await Promise.allSettled([this.send(session, answer)]);
	}

	// Spojení vyřazené `detach` nová stránka nezná, takže jí zavření neposílá. Při plné frontě se
	// zavření zahodí; okno pak rozběhnutá volání nezruší a jejich odpověď skončí na `DISCONNECTED`.
	close(session: number): void {
		if (!this.#sessions.delete(session)) return;
		this.#deliver({ session });
	}

	// Zalomení uvnitř zprávy by ji connectoru rozdělilo na dvě nečitelné. Zápis přerušený v půlce řádku
	// by rozbil protokol, proto spojení končí a na rozběhnutá volání odpoví connector.
	async send(session: number, line: string): Promise<void> {
		if (line.includes('\n')) throw new Error('Zpráva pro connector musí být na jednom řádku.');
		const socket = this.#sessions.get(session);
		if (socket === undefined) throw new Error(DISCONNECTED);
		const stuck = setTimeout(() => socket.destroy(), WRITE_TIMEOUT);
		try {
			await writeLine(socket, line);
		} catch (error) {
			// Socket, do kterého zápis selhal, Node zavře sám.
			throw new Error(DISCONNECTED, { cause: error });
		} finally {
			clearTimeout(stuck);
		}
	}

	// `false`, když se zpráva nevešla do fronty. Řádek spojení, které vyřadil `detach`, se zahodí.
	#deliver(message: WindowMessage): boolean {
		// Stryker disable next-line BooleanLiteral: ekvivalentní mutant, odmítnutí vyřazenému spojení nemá kam dojít.
		if (message.line !== undefined && !this.#sessions.has(message.session)) return true;
		if (this.#attached) {
			this.#emit(message);
			return true;
		}
		if (this.#backlog.length >= MAX_BACKLOG) return false;
		this.#backlog.push(message);
		return true;
	}
}

async function serveClient(socket: Socket, bridge: Bridge, token: Buffer): Promise<void> {
	const lines = readLines(socket, MAX_LINE);
	const silent = setTimeout(() => socket.destroy(), HANDSHAKE_TIMEOUT);
	const first = await lines.next();
	clearTimeout(silent);
	// Connector, který odešel dřív, než se představil, by odmítnutí už nepřečetl.
	// Stryker disable next-line ConditionalExpression: ekvivalentní mutant, bez řádku hodí čtení klíče výjimku a `serve` ji spolkne.
	if (first.done) return;
	if (first.value === null) {
		await writeLine(socket, TOO_LONG);
		return;
	}
	// Klíč je šestnáctkový, nahrazený neplatný bajt se s ním proto nikdy neshoduje. Porovnání bez
	// předčasného konce: doba odpovědi neprozradí, kolik znaků klíče sedí.
	const given = Buffer.from(first.value.toString().trim());
	if (given.length !== token.length || !timingSafeEqual(given, token)) {
		await writeLine(socket, UNAUTHORIZED);
		return;
	}
	await writeLine(socket, READY);

	const session = bridge.open(socket);
	try {
		for await (const line of lines) {
			// `id` zůstal v nepřečtené části, proto `null`.
			if (line === null) {
				await Promise.allSettled([bridge.send(session, rpcError(null, SERVER_ERROR, TOO_LONG))]);
				return;
			}
			let text: string;
			try {
				text = UTF8.decode(line).trim();
			} catch {
				// Nahradit nečitelné bajty by do okna pustilo jinou zprávu, než connector poslal.
				await Promise.allSettled([bridge.send(session, rpcError(null, PARSE_ERROR, NOT_TEXT))]);
				continue;
			}
			if (text !== '') await bridge.receive(session, text);
		}
	} finally {
		bridge.close(session);
	}
}

// Connector, který mezitím odešel, odmítnutí nedostane.
async function refuse(client: Socket): Promise<void> {
	await Promise.allSettled([writeLine(client, TOO_MANY_CLIENTS)]);
	client.destroy();
}

// Naslouchá na lokálním socketu a každé spojení přepojí na okno. Osiřelý socket po pádu appky se
// smaže, živý ne: druhá instance by převzala socket té první a její connectory by čekaly marně.
export async function serveMcp(socket: string, bridge: Bridge): Promise<McpServer> {
	const parent = dirname(socket);
	if (parent === socket) throw new Error('MCP socket nemá rodičovskou složku.');
	await mkdir(parent, { recursive: true });
	await chmod(parent, 0o700);
	const probe = createConnection(socket);
	const [running] = await Promise.allSettled([once(probe, 'connect')]);
	// Stryker disable next-line CallExpression: ekvivalentní mutant, odmítnutá zkouška je zavřená sama a k živé instanci se pak most stejně nespustí.
	probe.destroy();
	if (running.status === 'fulfilled') throw new Error('MCP socket už obsluhuje jiná instance Fakturianu.');
	await Promise.allSettled([unlink(socket)]);

	const token = randomBytes(TOKEN_BYTES).toString('hex');
	const secret = Buffer.from(token);
	const clients = new Map<Socket, Promise<void>>();

	async function serve(client: Socket): Promise<void> {
		try {
			await serveClient(client, bridge, secret);
		} catch {
			// Connector odpojený uprostřed zprávy je běžný stav, ne chyba mostu.
		} finally {
			clients.delete(client);
			client.destroy();
		}
	}

	const server = createServer((client) => {
		// Chybu zápisu i čtení nese jejich `await`; bez posluchače by událost `error` shodila appku.
		client.on('error', () => undefined);
		if (clients.size >= MAX_CLIENTS) void refuse(client);
		else clients.set(client, serve(client));
	});
	server.listen(socket);
	await once(server, 'listening');
	// Došlé deskriptory: libuv spojení zahodí a naslouchá dál, Node to ohlásí jen touhle událostí.
	server.on('error', (error) => void log(`MCP most nepřijal spojení: ${errorText(error)}`));

	// Klíč do souboru až po `listen`: vydá ho jen instance, které socket patří, klíč druhé by odřízl
	// connectory té první. Práva 0600 od vzniku souboru a výměna přes rename, ať není čitelný ani chvíli.
	const temporary = join(parent, `.mcp.token-${randomBytes(8).toString('hex')}`);
	try {
		await writeFile(temporary, token, {
			flag: 'wx',
			mode: 0o600,
		});
		await rename(temporary, tokenPath(socket));
		await chmod(socket, 0o600);
	} catch (error) {
		await Promise.allSettled([unlink(temporary)]);
		server.close();
		throw error;
	}

	return {
		async close() {
			const closed = once(server, 'close');
			server.close();
			for (const client of clients.keys()) client.destroy();
			await Promise.all(clients.values());
			await closed;
		},
	};
}
