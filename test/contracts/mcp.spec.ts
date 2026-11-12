import { expect, it } from 'vitest';

import { windowMessageSchema, windowRequestSchema } from '~/schemas/mcp';
import { z } from '~/utils/zod';

import { backend } from '../setup/backend';
import { realBackend } from '../setup/bridge';
import { connectAgent, replyTo, vaultWithContent } from '../setup/mcp-client';

const windowSchema = z.object({
	event: z.string(),
	messages: z.array(z.unknown()),
	closed: z.unknown(),
});

/** Řádky agenta projdou skutečným connectorem a mostem; vrátí se, co most poslal oknu. */
function throughBridge(...lines: unknown[]) {
	return windowSchema.parse(
		realBackend({
			command: 'mcp_window',
			lines: lines.map((line) => JSON.stringify(line)),
		}),
	);
}

it('okno poslouchá na eventu, kterým backend zprávy agenta posílá', async () => {
	const { event } = throughBridge();
	await connectAgent();

	expect(backend.args('listen')).toEqual([{ channel: event }]);
});

it('connector oknu předá jen volání a zrušení a obojí projde schématem okna', () => {
	const { messages, closed } = throughBridge(
		{
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {},
		},
		{
			jsonrpc: '2.0',
			id: 2,
			method: 'tools/call',
			params: {
				name: 'list_invoices',
				arguments: {},
			},
		},
		{
			jsonrpc: '2.0',
			method: 'notifications/cancelled',
			params: {
				requestId: 2,
				reason: 'agent to vzdal',
			},
		},
	);

	const parsed = messages.map((message) => windowMessageSchema.parse(message));
	expect(parsed.map(({ line }) => windowRequestSchema.parse(JSON.parse(line ?? 'null')).method)).toEqual([
		'tools/call',
		'notifications/cancelled',
	]);
	expect(windowMessageSchema.parse(closed)).toEqual({ session: 1 });
});

it('volání nástroje z mostu okno vyřídí a odpoví do stejného spojení', async () => {
	await vaultWithContent();
	await connectAgent();
	const { messages } = throughBridge({
		jsonrpc: '2.0',
		id: 7,
		method: 'tools/call',
		params: {
			name: 'list_invoices',
			arguments: {},
		},
	});

	for (const message of messages) backend.mcp.deliver(message);
	const reply = await replyTo(7);

	expect(reply).toEqual({
		result: [],
		error: null,
	});
});
