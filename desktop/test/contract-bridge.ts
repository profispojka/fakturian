import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable, Writable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';

import { MCP_MESSAGE_EVENT } from '~/bindings';
import { errorText, issuesText } from '~/utils/errors';
import { z, type Zod } from '~/utils/zod';

import { pdfWithIsdoc } from './pdfs.ts';

import { adoptDocuments, scanVault } from '../adopt.ts';
import { fioFetch, fioSetToken, parseFio } from '../fio.ts';
import { deleteInvoice } from '../invoice/delete.ts';
import { importDocuments } from '../invoice/import.ts';
import { listInvoices, summarize } from '../invoice/index.ts';
import { buildIsdoc, parseIsdoc } from '../invoice/isdoc.ts';
import { loadInvoice } from '../invoice/mod.ts';
import { invoiceArgument } from '../invoice/model.ts';
import { markInvoiceSent } from '../invoice/status.ts';
import { runConnector } from '../mcp/connector.ts';
import { Bridge, serveMcp, type WindowMessage } from '../mcp/mod.ts';
import { importReceived } from '../received.ts';
import { readDataFile, writeDataFile } from '../store.ts';
import { ensureVault } from '../vault.ts';

const vaultCommand = z.strictObject({
	command: z.enum(['load', 'mark_sent', 'delete']),
	vault: z.string(),
	number: z.string(),
});

const requestSchema = z.discriminatedUnion('command', [
	z.strictObject({
		command: z.literal('parse'),
		xml: z.string(),
	}),
	z.strictObject({
		command: z.literal('build'),
		invoice: z.unknown(),
	}),
	z.strictObject({
		command: z.literal('import'),
		vault: z.string(),
		paths: z.array(z.string()),
	}),
	z.strictObject({
		command: z.literal('wrap'),
		xml: z.string(),
		path: z.string(),
	}),
	z.strictObject({
		command: z.literal('adopt'),
		vault: z.string(),
		paths: z.array(z.string()),
		ico: z.string().nullable(),
	}),
	vaultCommand,
	z.strictObject({
		command: z.literal('list'),
		vault: z.string(),
	}),
	z.strictObject({
		command: z.literal('scan'),
		vault: z.string(),
		ico: z.string().nullable().default(null),
	}),
	z.strictObject({
		command: z.literal('received'),
		vault: z.string(),
		path: z.string(),
	}),
	z.strictObject({
		command: z.literal('fio'),
		statement: z.unknown(),
	}),
	z.strictObject({
		command: z.literal('fio_fetch'),
		base: z.string(),
		token: z.string(),
		from: z.string(),
		to: z.string(),
	}),
	z.strictObject({
		command: z.literal('read_data'),
		vault: z.string(),
		name: z.string(),
	}),
	z.strictObject({
		command: z.literal('write_data'),
		vault: z.string(),
		name: z.string(),
		json: z.string(),
	}),
	z.strictObject({
		command: z.literal('mcp_window'),
		lines: z.array(z.string()),
	}),
]);

const FIO_BASE = 'https://fioapi.fio.cz/v1/rest';

// Fio jde na server testu místo na fioapi.fio.cz; jinak je to skutečné HTTP volání `fioFetch`.
let fioServer = FIO_BASE;
const networkFetch = globalThis.fetch;
globalThis.fetch = (input, init) => networkFetch(String(input).replace(FIO_BASE, fioServer), init);

// Zprávy chodí z mostu asynchronně; po vteřině ticha už nic dalšího neposílá.
async function mcpWindow(lines: string[]): Promise<unknown> {
	const dir = await mkdtemp(join(tmpdir(), 'fakturian-contract-'));
	const messages: WindowMessage[] = [];
	const bridge = new Bridge((message) => messages.push(message));
	bridge.attach();
	const server = await serveMcp(join(dir, 'mcp.sock'), bridge);
	try {
		const sink = new Writable({ write: (_chunk, _encoding, done) => done() });
		const input = Readable.from(lines.map((line) => Buffer.from(`${line}\n`)));
		await runConnector(input, sink, join(dir, 'mcp.sock'));
		let seen = -1;
		while (seen !== messages.length) {
			seen = messages.length;
			await sleep(1000);
		}
	} finally {
		await server.close();
		await rm(dir, {
			recursive: true,
			force: true,
		});
	}
	// Bez řádku se connector k mostu nepřipojí, takže ani nic nezavírá.
	const closed = messages.find((message) => message.line === undefined) ?? null;
	return {
		event: MCP_MESSAGE_EVENT,
		messages: messages.filter((message) => message.line !== undefined),
		closed,
	};
}

async function run(request: Zod.infer<typeof requestSchema>): Promise<unknown> {
	switch (request.command) {
		case 'parse': {
			const invoice = await parseIsdoc(request.xml);
			return {
				invoice,
				summary: summarize(invoice, 'contract.pdf'),
			};
		}
		case 'build':
			return buildIsdoc(invoiceArgument(request.invoice));
		case 'import':
			await ensureVault({ vaultPath: request.vault });
			return importDocuments({
				vaultPath: request.vault,
				paths: request.paths,
				ourIco: null,
			});
		case 'wrap': {
			const pdf = await pdfWithIsdoc(request.xml);
			await writeFile(request.path, pdf);
			return request.path;
		}
		case 'adopt':
			return adoptDocuments({
				vaultPath: request.vault,
				paths: request.paths,
				ourIco: request.ico,
			});
		case 'load':
			return loadInvoice({
				vaultPath: request.vault,
				number: request.number,
			});
		case 'list':
			return listInvoices({ vaultPath: request.vault });
		case 'scan':
			return scanVault({
				vaultPath: request.vault,
				ourIco: request.ico,
			});
		case 'received':
			await ensureVault({ vaultPath: request.vault });
			return importReceived({
				vaultPath: request.vault,
				sourcePath: request.path,
			});
		case 'mark_sent':
			return markInvoiceSent({
				vaultPath: request.vault,
				number: request.number,
			});
		// Koš by testům zaplnil systémový Koš; kontrakt se týká výpisu, ne místa, kam soubor odejde.
		case 'delete':
			return deleteInvoice(
				{
					vaultPath: request.vault,
					number: request.number,
				},
				(path) => rm(path),
			);
		case 'fio':
			return parseFio(request.statement);
		case 'fio_fetch':
			fioServer = request.base;
			await fioSetToken({ token: request.token });
			return fioFetch({
				from: request.from,
				to: request.to,
			});
		case 'read_data':
			return readDataFile({
				vaultPath: request.vault,
				name: request.name,
			});
		case 'write_data':
			return writeDataFile({
				vaultPath: request.vault,
				name: request.name,
				json: request.json,
			});
		case 'mcp_window':
			return mcpWindow(request.lines);
	}
	// Nový příkaz bez větve shodí typecheck: `request` tu přestane být `never`.
	const unhandled: never = request;
	throw new Error(`Most kontraktů neumí příkaz ${JSON.stringify(unhandled)}.`);
}

async function answer(input: string): Promise<unknown> {
	const request = requestSchema.safeParse(JSON.parse(input));
	if (!request.success) throw new Error(`Most kontraktů nezná požadavek (${issuesText(request.error)}).`);
	const result = await run(request.data);
	return result;
}

// `--serve` drží jeden proces pro celý test: `store` si mezi čtením a zápisem pamatuje otisk souboru.
if (process.argv.includes('--serve')) {
	for await (const line of createInterface({ input: process.stdin })) {
		try {
			const ok = await answer(line);
			process.stdout.write(`${JSON.stringify({ ok })}\n`);
		} catch (error) {
			process.stdout.write(`${JSON.stringify({ error: errorText(error) })}\n`);
		}
	}
	// Validátor ISDOC běží ve workeru, který by proces nechal žít.
	process.exit(0);
} else {
	// Holá hláška bez `Error: ` a zásobníku: test ji porovnává s tím, co uvidí uživatel.
	try {
		const chunks: Buffer[] = [];
		for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
		const result = await answer(Buffer.concat(chunks).toString('utf8'));
		// Výstup do roury doteče až po návratu `write`; `exit` hned by ho na macOS uřízl.
		process.stdout.write(`${JSON.stringify(result)}\n`, () => process.exit(0));
	} catch (error) {
		process.stderr.write(`${errorText(error)}\n`, () => process.exit(1));
	}
}
