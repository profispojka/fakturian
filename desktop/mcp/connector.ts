import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createConnection, type Socket } from 'node:net';

import { mcpToolList } from '~/schemas/mcp';
import { errorText } from '~/utils/errors';
import { z } from '~/utils/zod';

import {
	MAX_LINE,
	NOT_TEXT,
	PARSE_ERROR,
	READY,
	readLines,
	rpcError,
	TOO_LONG,
	tokenPath,
	toolError,
	writeLine,
} from './mod.ts';

import { parseJson } from '../store.ts';
import { VERSION } from '../version.ts';

import type { Writable } from 'node:stream';

const PROTOCOL = '2024-11-05';

const INVALID_REQUEST = -32_600;

const METHOD_NOT_FOUND = -32_601;

// Nejčastější důvod, proč se most neozve, je vypnutá appka — z hlášky to musí být jasné.
const APP_NOT_RUNNING = 'Fakturian neběží. Spusť appku — agent pracuje proti ní, ne přímo se soubory.';

// Vystavení faktury mohlo doběhnout, takže agent nesmí volání naslepo zopakovat.
const INTERRUPTED =
	'Spojení s Fakturianem se během volání přerušilo (appka skončila nebo se okno znovu načetlo). ' +
	'Výsledek není známý — u create_invoice nejdřív ověř list_invoices, než to zkusíš znovu.';

// Stryker disable next-line StringLiteral: neplatné kódování hodí RangeError už při importu, takže se nespustí žádný test.
const UTF8 = new TextDecoder('utf-8', { fatal: true });

// Z obálky JSON-RPC stačí vyčíst, co connector rozhoduje sám; obsah volání ověří okno. Klíč `id`
// s `null` je pořád id, chybějící je notifikace.
const envelopeSchema = z.object({
	id: z.unknown().optional(),
	method: z.unknown().optional(),
	params: z.unknown().optional(),
});

const cancellationSchema = z.object({ requestId: z.unknown().optional() });

// Okno vrací `id` přes `JSON.parse` a zpět; jiné než řetězec a bezpečné celé číslo by se cestou
// změnilo a odpověď by k volání nesedla.
function keepsIntact(id: unknown): boolean {
	return typeof id === 'string' || (Number.isSafeInteger(id) && Number(id) >= 0);
}

function result(id: unknown, value: object): string {
	return JSON.stringify({
		jsonrpc: '2.0',
		id,
		result: value,
	});
}

// Spojení s appkou a volání, na která okno ještě neodpovědělo. Po konci spojení na zbylá odpoví
// connector sám, jinak by agent čekal donekonečna.
interface App {
	socket: Socket;
	waiting: Set<unknown>;
	ended: boolean;
}

// `initialize` a seznam nástrojů zvládne connector sám, takže je agent vidí i se zavřenou appkou.
// Spojení s oknem se otevře až prvním voláním nástroje a po restartu appky znovu.
async function serve(input: AsyncIterable<Buffer>, output: Writable, socket: string): Promise<void> {
	// Chybu nese callback zápisu; bez posluchače by událost `error` shodila proces.
	output.on('error', () => undefined);
	let app: App | undefined;

	// Okno odpovídá v pořadí, v jakém volání doběhnou, a jeho řádky jdou agentovi beze změny.
	async function relay(connected: App, lines: AsyncGenerator<Buffer, void>): Promise<void> {
		try {
			for await (const line of lines) {
				const text = UTF8.decode(line).replace(/\r$/, '');
				try {
					const answer = envelopeSchema.safeParse(parseJson(text));
					// Stryker disable next-line ConditionalExpression: ekvivalentní mutant, `data` neúspěšného rozboru hodí výjimku a tu `catch` přejde stejně.
					if (answer.success) connected.waiting.delete(answer.data.id);
				} catch {
					// Řádek okna, který není JSON, nic nevyřizuje.
				}
				output.write(`${text}\n`);
			}
		} catch {
			// Nečitelný řádek i chyba čtení končí spojení stejně jako jeho zavření.
		}
		connected.ended = true;
		for (const id of connected.waiting) output.write(`${toolError(id, INTERRUPTED)}\n`);
	}

	// Ověření klíčem; chyba kdekoli po cestě znamená, že appka neběží. Klíč se čte u každého spojení:
	// appka ho při startu mění a connector běží přes její restarty.
	async function connect(id: unknown, line: string): Promise<App> {
		let stream: Socket | undefined;
		let lines: AsyncGenerator<Buffer, void>;
		let greeting: IteratorResult<Buffer, void>;
		try {
			const token = await readFile(tokenPath(socket), 'utf8');
			stream = createConnection(socket);
			// Stryker disable next-line StringLiteral,CallExpression: ekvivalentní mutant, chybu spojení do `connect` zachytí `once` a potom čtení řádků.
			stream.on('error', () => undefined);
			lines = readLines(stream);
			await once(stream, 'connect');
			await writeLine(stream, token.trim());
			greeting = await lines.next();
		} catch (error) {
			stream?.destroy();
			// Stryker disable next-line ObjectLiteral: ekvivalentní mutant, agent dostane jen text chyby, příčinu nikdo nečte.
			throw new Error(APP_NOT_RUNNING, { cause: error });
		}
		const reply = greeting.done ? '' : greeting.value.toString().trim();
		if (reply !== READY) {
			stream.destroy();
			// Spojení navázané a hned zavřené: appka končí. Vypadá to jinak než vypnutá appka, tak to
			// má i jinak znít.
			throw new Error(reply === '' ? 'Fakturian spojení zavřel bez odpovědi.' : reply);
		}
		// Volání je v evidenci dřív, než ji může uzavřít konec spojení.
		const connected: App = {
			socket: stream,
			waiting: new Set([id]),
			ended: false,
		};
		void relay(connected, lines);
		stream.write(`${line}\n`);
		return connected;
	}

	// Zápis do zavřené appky selže potichu; na volání pak odpoví `relay` jako na přerušené, protože
	// opakování by mohlo vystavit fakturu dvakrát.
	async function call(id: unknown, line: string): Promise<void> {
		if (app !== undefined && !app.ended) {
			app.waiting.add(id);
			app.socket.write(`${line}\n`);
			return;
		}
		app = await connect(id, line);
	}

	// Zrušené volání odpověď nečeká. Bez spojení není co rušit: nová appka o volání neví.
	function cancel(params: unknown, line: string): void {
		if (app === undefined) return;
		const cancellation = cancellationSchema.safeParse(params);
		if (cancellation.success) app.waiting.delete(cancellation.data.requestId);
		app.socket.write(`${line}\n`);
	}

	// `undefined`, když odpoví okno, nebo když jde o notifikaci či odpověď MCP klienta — na ty se
	// v JSON-RPC neodpovídá.
	async function respond(message: unknown, line: string): Promise<string | undefined> {
		const envelope = envelopeSchema.safeParse(message);
		if (!envelope.success) return undefined;
		const { id, method, params } = envelope.data;
		const isCall = method === 'tools/call' && id !== undefined;
		if (isCall && !keepsIntact(id)) {
			return rpcError(
				id,
				INVALID_REQUEST,
				'Id volání musí být řetězec nebo celé nezáporné číslo menší než 2^53.',
			);
		}
		// Most by delší řádek odmítl bez `id` a agent by nevěděl, ke kterému volání chyba patří.
		if (isCall && Buffer.byteLength(line) >= MAX_LINE) return toolError(id, TOO_LONG);
		if (isCall) {
			try {
				await call(id, line);
			} catch (error) {
				return toolError(id, errorText(error));
			}
			return undefined;
		}
		// Přes strop by most spojení zavřel i s ostatními rozběhnutými voláními.
		if (method === 'notifications/cancelled' && id === undefined && Buffer.byteLength(line) < MAX_LINE) {
			cancel(params, line);
			return undefined;
		}
		if (id === undefined || typeof method !== 'string') return undefined;
		if (method === 'initialize') {
			return result(id, {
				protocolVersion: PROTOCOL,
				capabilities: {
					tools: {},
				},
				serverInfo: {
					name: 'fakturian',
					version: VERSION,
				},
			});
		}
		if (method === 'ping') return result(id, {});
		if (method === 'tools/list') return result(id, { tools: mcpToolList() });
		return rpcError(id, METHOD_NOT_FOUND, `Neznámá metoda: ${method}`);
	}

	for await (const bytes of readLines(input)) {
		let text: string;
		try {
			text = UTF8.decode(bytes);
		} catch {
			// Nečitelný řádek dostane chybu a protokol jede dál; jeden bajt nesmí agentovi vzít server.
			await writeLine(output, rpcError(null, PARSE_ERROR, NOT_TEXT));
			continue;
		}
		if (text.trim() === '') continue;
		// Konec řádku `\r` z Windows nevadí: `JSON.parse` ho přejde jako mezeru a most řádek ořízne.
		let message: unknown;
		try {
			message = parseJson(text);
		} catch {
			await writeLine(output, rpcError(null, PARSE_ERROR, 'Zpráva není JSON.'));
			continue;
		}
		const reply = await respond(message, text);
		if (reply !== undefined) await writeLine(output, reply);
	}
}

// Konec vstupu je 0, chyba čtení vstupu nebo zápisu výstupu 1. Stdout nese jen řádky JSON-RPC,
// přísní klienti by jinak protokol rozbili, takže důvod jde na stderr do logu MCP klienta.
export async function runConnector(input: AsyncIterable<Buffer>, output: Writable, socket: string): Promise<number> {
	try {
		await serve(input, output, socket);
	} catch (error) {
		// Zavřený stderr už nemá kdo číst.
		await Promise.allSettled([writeLine(process.stderr, errorText(error))]);
		return 1;
	}
	return 0;
}
