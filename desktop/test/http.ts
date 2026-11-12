import { createServer, type Server, type Socket } from 'node:net';

import { type MockInstance, vi } from 'vitest';

const HEAD_END = Buffer.from('\r\n\r\n');

export interface Route {
	path: string;
	answer: Buffer;
}

export interface Received {
	path: string;
	headers: Headers;
}

// Odpověď na jednu cestu (i s dotazem za `?`); `Connection: close`, aby klient spojení nedržel.
export function route(path: string, status: number, headers: Record<string, string>, body: Uint8Array | string): Route {
	const content = Buffer.from(body);
	const named = Object.entries(headers)
		.map(([name, value]) => `${name}: ${value}\r\n`)
		.join('');
	const head = `HTTP/1.1 ${status} Test\r\n${named}Content-Length: ${content.byteLength}\r\nConnection: close\r\n\r\n`;
	return {
		path,
		answer: Buffer.concat([Buffer.from(head), content]),
	};
}

export function redirect(path: string, location: string): Route {
	return route(path, 301, { Location: location }, '');
}

// Odpověď přesně tak, jak je napsaná — i s hlavičkou, která o těle lže.
export function raw(path: string, answer: string): Route {
	return {
		path,
		answer: Buffer.from(answer),
	};
}

function readHead(socket: Socket): Promise<string> {
	const { promise, resolve } = Promise.withResolvers<string>();
	let head = Buffer.alloc(0);
	const done = () => resolve(head.toString());
	socket.on('data', (chunk: Buffer) => {
		head = Buffer.concat([head, chunk]);
		if (head.includes(HEAD_END)) done();
	});
	socket.on('end', done);
	return promise;
}

// Servery otevřené v rozběhnutém testu; `closeServers` v `afterEach` je zavře.
const open: MockHttp[] = [];
// Pevná adresa služby, jejíž dotazy jdou na naposledy spuštěný server, a `fetch`, který je tam posílá.
let service: string | undefined;
let rerouted: MockInstance<typeof fetch> | undefined;

export function reroute(origin: string): void {
	service = origin;
}

// Malý HTTP server nad holým TCP: odpověď se posílá bajt po bajtu, jak je zapsaná, takže umí i lež
// v `Content-Length`. `undefined` místo odpovědi spojení nechá viset až do zavření serveru.
export class MockHttp {
	readonly base: string;
	readonly received: Received[] = [];
	readonly #server: Server;
	readonly #sockets = new Set<Socket>();

	private constructor(server: Server, port: number, answer: (path: string) => Buffer | undefined) {
		this.#server = server;
		this.base = `http://127.0.0.1:${port}`;
		server.on('connection', (socket) => {
			this.#sockets.add(socket);
			socket.on('close', () => this.#sockets.delete(socket));
			void this.#answer(socket, answer);
		});
		open.push(this);
		if (service !== undefined) this.#takeOver(service);
	}

	static async #start(answer: (path: string) => Buffer | undefined): Promise<MockHttp> {
		const server = createServer();
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
		await promise;
		const address = server.address();
		if (address === null || typeof address === 'string') throw new Error('Server nemá port.');
		return new MockHttp(server, address.port, answer);
	}

	// Cesta, která mezi `routes` není, dostane 404.
	static routes(routes: Route[]): Promise<MockHttp> {
		const missing = route('', 404, {}, '').answer;
		return MockHttp.#start((path) => routes.find((candidate) => candidate.path === path)?.answer ?? missing);
	}

	static answering(status: number, body: string): Promise<MockHttp> {
		const { answer } = route('', status, { 'Content-Type': 'application/json' }, body);
		return MockHttp.#start(() => answer);
	}

	// Spojení přijme a bez odpovědi zavře, jako web, který na adrese neběží.
	static closing(): Promise<MockHttp> {
		return MockHttp.#start(() => Buffer.alloc(0));
	}

	// Spojení přijme a neodpoví, dokud se server nezavře.
	static silent(): Promise<MockHttp> {
		return MockHttp.#start(() => undefined);
	}

	#takeOver(origin: string): void {
		rerouted?.mockRestore();
		const network = globalThis.fetch;
		rerouted = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
			const url = new Request(input).url;
			return network(url.startsWith(origin) ? `${this.base}${url.slice(origin.length)}` : url, init);
		});
	}

	get paths(): string[] {
		return this.received.map(({ path }) => path);
	}

	async #answer(socket: Socket, answer: (path: string) => Buffer | undefined): Promise<void> {
		// Klient smí přestat číst uprostřed těla — přesně to dělá čtení jen začátku odpovědi.
		socket.on('error', (error: NodeJS.ErrnoException) => {
			if (error.code !== 'EPIPE' && error.code !== 'ECONNRESET') throw error;
		});
		const head = await readHead(socket);
		const [request = '', ...lines] = head.split('\r\n');
		const path = request.split(' ')[1] ?? '';
		this.received.push({
			path,
			headers: new Headers(
				lines
					.filter((line) => line !== '')
					.map((line): [string, string] => {
						const [name = '', value = ''] = line.split(/: (.*)/s, 2);
						return [name, value];
					}),
			),
		});
		const reply = answer(path);
		if (reply !== undefined) socket.end(reply);
	}

	async close(): Promise<void> {
		const { promise, resolve } = Promise.withResolvers<void>();
		this.#server.close(() => resolve());
		for (const socket of this.#sockets) socket.destroy();
		await promise;
	}
}

// Zavřít až po testu v `afterEach`, aby server nepřežil test, který spadl uprostřed.
export async function closeServers(): Promise<void> {
	rerouted?.mockRestore();
	rerouted = undefined;
	service = undefined;
	await Promise.all(open.splice(0).map((server) => server.close()));
}
