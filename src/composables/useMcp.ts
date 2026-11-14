import { onScopeDispose } from 'vue';

import { commands, MCP_MESSAGE_EVENT } from '~/bindings';
import { requestWithIdSchema, windowMessageSchema, windowRequestSchema } from '~/schemas/mcp';
import { systemServices } from '~/services/system';
import { isDesktop } from '~/utils/desktop';
import { errorText, issuesText } from '~/utils/errors';

import type { McpConnector } from '~/bindings';
import type { RequestId } from '~/schemas/mcp';

const PARSE_ERROR = -32_700;
const INVALID_REQUEST = -32_600;
const METHOD_NOT_FOUND = -32_601;
const INVALID_PARAMS = -32_602;

function protocolError(id: RequestId | null, code: number, message: string) {
	return {
		jsonrpc: '2.0',
		id,
		error: {
			code,
			message,
		},
	};
}

// Volá se ze `setup()`, aby posluchač visel na jeho scope.
export function useMcp() {
	const { callTool } = useMcpTools();
	const toast = useToast();
	// Mimo desktopovou appku žádný most není a každý příkaz by padal hned při startu.
	if (!isDesktop()) return;

	// Rozběhnutá volání podle spojení a `id`, aby je `notifications/cancelled` i zavřené spojení zrušily.
	const running = new Map<number, Map<RequestId, AbortController>>();

	// Selhané doručení se jen ohlásí: agent se odpověď stejně nedozví a doklad už může být uložený.
	async function send(session: number, message: object) {
		try {
			await commands.mcpSend(session, JSON.stringify(message));
		} catch (e) {
			toast.add({
				title: 'Odpověď agentovi se nepodařilo doručit',
				description: errorText(e),
				color: 'warning',
			});
		}
	}

	function close(session: number) {
		for (const call of running.get(session)?.values() ?? []) call.abort();
		running.delete(session);
	}

	async function receive(payload: unknown) {
		const message = windowMessageSchema.safeParse(payload);
		if (!message.success) {
			toast.add({
				title: 'MCP most poslal nečitelnou zprávu',
				description: errorText(message.error),
				color: 'error',
			});
			return;
		}
		const { session, line } = message.data;
		if (line === undefined) {
			close(session);
			return;
		}

		let body: unknown;
		try {
			body = JSON.parse(line);
		} catch {
			await send(session, protocolError(null, PARSE_ERROR, 'Zpráva není JSON.'));
			return;
		}
		const request = windowRequestSchema.safeParse(body);
		if (!request.success) {
			const problem = issuesText(request.error);
			const withId = requestWithIdSchema.safeParse(body);
			// Na notifikaci se v JSON-RPC neodpovídá, takže se o ní dozví jen uživatel.
			if (!withId.success) {
				toast.add({
					title: 'Agent poslal zprávu, které appka nerozumí',
					description: problem,
					color: 'warning',
				});
				return;
			}
			const { jsonrpc, id, method } = withId.data;
			let error;
			if (jsonrpc !== '2.0') error = protocolError(id, INVALID_REQUEST, 'Zpráva není JSON-RPC 2.0.');
			else if (method === 'tools/call')
				error = protocolError(id, INVALID_PARAMS, `Neplatné volání nástroje (${problem}).`);
			else error = protocolError(id, METHOD_NOT_FOUND, `Neznámá metoda: ${method}`);
			await send(session, error);
			return;
		}

		const calls = running.get(session) ?? new Map<RequestId, AbortController>();
		running.set(session, calls);
		const { data } = request;
		if (data.method === 'notifications/cancelled') {
			calls.get(data.params.requestId)?.abort();
			return;
		}

		const controller = new AbortController();
		calls.set(data.id, controller);
		const result = await callTool(data.params.name, data.params.arguments, controller.signal);
		calls.delete(data.id);
		// Na zrušené volání se podle protokolu neodpovídá.
		if (controller.signal.aborted) return;
		await send(session, {
			jsonrpc: '2.0',
			id: data.id,
			result,
		});
	}

	// Nejdřív poslech, pak připojení: zprávy, které most drží pro načítané okno, pošle hned.
	const stop = systemServices.on(MCP_MESSAGE_EVENT, (payload) => void receive(payload));
	onScopeDispose(() => {
		stop();
		for (const session of running.keys()) close(session);
	});

	async function attach() {
		try {
			await commands.mcpAttach();
		} catch (e) {
			toast.add({
				title: 'MCP most selhal',
				description: errorText(e),
				color: 'error',
			});
		}
	}
	void attach();
}

// Obojí zná jen hlavní proces: connector je spustitelný soubor této instalace a cestu k socketu vydá
// jen most, který naslouchá.
export function useMcpPaths() {
	const socket = useLazyAsyncData('mcp-socket', () => commands.mcpSocketPath(), { default: () => '' });
	const connector = useLazyAsyncData('mcp-connector', () => commands.mcpConnector(), {
		default: (): McpConnector | null => null,
	});
	const error = computed(() => {
		const cause = socket.error.value ?? connector.error.value;
		if (!cause) return '';
		return errorText(cause);
	});
	return {
		socketPath: socket.data,
		connector: connector.data,
		error,
	};
}
