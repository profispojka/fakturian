import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { createConnection, createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import { Writable } from 'node:stream';

// Cesta k unixovému socketu smí mít nejvýš 103 bajtů. Dočasná složka macOS (`/var/folders/…`) se
// s `Library/Application Support/…` do nich nevejde, `/tmp` ano.
export function socketDir(what: string): Promise<string> {
	return mkdtemp(`/tmp/fakturian-${what}-`);
}

// Spojená dvojice socketů: první dostane most, druhý drží test za connector.
export async function socketPair(dir: string): Promise<[Socket, Socket]> {
	const path = join(dir, `pair-${Math.random().toString(16).slice(2)}.sock`);
	const server = createServer();
	server.listen(path);
	await once(server, 'listening');
	const accepted = once(server, 'connection');
	const peer = createConnection(path);
	const [ours] = await accepted;
	await once(peer, 'connect');
	server.close();
	ours.on('error', () => undefined);
	peer.on('error', () => undefined);
	return [ours, peer];
}

// Řádky, které do socketu nebo výstupu došly; `next()` počká na další, `null` po zavření.
export class Lines {
	received: string[] = [];
	closed = false;
	#text = '';
	#read = 0;
	#wake: (() => void) | undefined;

	push(chunk: string): void {
		this.#text += chunk;
		const parts = this.#text.split('\n');
		this.#text = parts.pop() ?? '';
		this.received.push(...parts);
		this.#wake?.();
	}

	close(): void {
		this.closed = true;
		this.#wake?.();
	}

	async next(): Promise<string | null> {
		while (this.#read >= this.received.length && !this.closed) {
			await new Promise<void>((resolve) => {
				this.#wake = resolve;
			});
		}
		const line = this.received[this.#read];
		if (line === undefined) return null;
		this.#read += 1;
		return line;
	}

	// Prvních `count` řádků, jakmile dojdou.
	async first(count: number): Promise<string[]> {
		while (this.received.length < count && !this.closed) {
			await new Promise<void>((resolve) => {
				this.#wake = resolve;
			});
		}
		return this.received.slice(0, count);
	}
}

export function readSocket(socket: Socket): Lines {
	const lines = new Lines();
	socket.setEncoding('utf8');
	socket.on('data', (chunk: string) => lines.push(chunk));
	socket.on('close', () => lines.close());
	return lines;
}

// Výstup connectoru, do kterého zapisuje stdout.
export function output(): { stream: Writable; lines: Lines } {
	const lines = new Lines();
	const stream = new Writable({
		write(chunk: Buffer, _encoding, done) {
			lines.push(chunk.toString());
			done();
		},
	});
	return {
		stream,
		lines,
	};
}

export async function connect(path: string): Promise<Socket> {
	const socket = createConnection(path);
	socket.on('error', () => undefined);
	await once(socket, 'connect');
	return socket;
}
