import { describe, expect, it } from 'vitest';

import {
	MCP_TOOLS,
	isMcpToolName,
	mcpToolList,
	requestWithIdSchema,
	windowMessageSchema,
	windowRequestSchema,
} from '~/schemas/mcp';

import type { McpToolName } from '~/schemas/mcp';

function inputSchema(name: McpToolName) {
	return mcpToolList().find((t) => t.name === name)?.inputSchema;
}

describe('seznam nástrojů pro connector', () => {
	it('vypíše nástroje v tomto pořadí', () => {
		expect(mcpToolList().map((t) => t.name)).toEqual([
			'list_invoices',
			'get_invoice',
			'list_contacts',
			'list_expenses',
			'pricelist_status',
			'summary',
			'create_invoice',
		]);
	});

	it('každý nástroj agentovi řekne, co dělá', () => {
		expect(mcpToolList().map((t) => t.description)).toEqual([
			'Seznam vystavených faktur a dobropisů: číslo, původní faktura u dobropisu, odběratel, data, částka, zaplaceno, dobropisováno, uhrazená část a datum poslední platby.',
			'Detail jedné faktury včetně položek a stavu úhrady.',
			'Seznam odběratelů.',
			'Výdaje: dodavatel, popis, částka, datum.',
			'Ceník a jeho vykázání za rok: u každé položky kolik jí odešlo, kolik zbývá do ročního limitu (0 = položka se nehlídá) a na kterých fakturách je.',
			'Souhrn: obrat, marže, kdo dluží a kolik, stav limitu plátcovství DPH.',
			'Vystaví fakturu. Uživatel ji musí potvrdit v okně appky a do té doby volání čeká. Číslo přidělí appka z číselné řady; doklad se uloží jako PDF s vloženým ISDOC.',
		]);
	});

	it('řádek nové faktury popíše pole dokladu, cenu v haléřích a rok čerpání', () => {
		const line = inputSchema('create_invoice')?.properties.lines.items;

		expect(Object.keys(line.properties).toSorted()).toEqual([
			'description',
			'itemId',
			'quantity',
			'unit',
			'unitPriceCents',
			'usageYear',
		]);
		expect(line.properties.unitPriceCents.description).toBe('Cena za jednotku v haléřích.');
		expect(line.properties.usageYear.description).toBe(
			'Interní rok čerpání ročního limitu; výchozí je rok vystavení.',
		);
	});

	it('schéma argumentů řekne agentovi, co je povinné a že jiné klíče nebere', () => {
		expect(inputSchema('get_invoice')).toEqual({
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			type: 'object',
			properties: {
				number: {
					type: 'string',
					description: 'Číslo faktury',
				},
			},
			required: ['number'],
			additionalProperties: false,
		});
		expect(inputSchema('list_contacts')).toEqual({
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			type: 'object',
			properties: {},
			additionalProperties: false,
		});
		expect(inputSchema('create_invoice')?.required).toEqual(['customerName', 'lines']);
	});

	it('ročník popíše jako celé číslo nebo čtyři číslice, ne jako cokoli', () => {
		expect(inputSchema('summary')?.properties).toEqual({
			year: {
				description: 'Rok, výchozí letošní',
				anyOf: [
					{
						type: 'integer',
						minimum: 1000,
						maximum: 9999,
					},
					{
						type: 'string',
						pattern: '^[1-9]\\d{3}$',
					},
				],
			},
		});
	});
});

describe('jméno nástroje', () => {
	it('pozná nástroj ze seznamu', () => {
		expect(isMcpToolName('summary')).toBe(true);
	});

	it('neznámé jméno odmítne', () => {
		expect(isMcpToolName('neznamy')).toBe(false);
	});

	it('klíč z prototypu objektu za nástroj nepovažuje', () => {
		expect(isMcpToolName('toString')).toBe(false);
	});
});

describe('rok v argumentech', () => {
	it.each([[999], [10_000], ['loni']])('%j odmítne hláškou pro uživatele', (year) => {
		const parsed = MCP_TOOLS.summary.args.safeParse({ year });

		expect(parsed.error?.issues.map((i) => i.message)).toEqual(['Zadej rok jako RRRR.']);
	});

	it('čtyři číslice v řetězci převede na číslo', () => {
		expect(MCP_TOOLS.summary.args.safeParse({ year: '2026' }).data).toEqual({ year: 2026 });
	});
});

describe('zpráva od mostu', () => {
	it('řádek od connectoru přečte i se spojením', () => {
		const message = {
			session: 2,
			line: '{}',
		};

		expect(windowMessageSchema.safeParse(message).data).toEqual(message);
	});

	it('zavřené spojení je zpráva bez řádku', () => {
		expect(windowMessageSchema.safeParse({ session: 2 }).data).toEqual({ session: 2 });
	});
});

describe('odpověď na neplatnou zprávu', () => {
	it('z neplatné zprávy vyčte verzi, id a metodu', () => {
		const message = {
			jsonrpc: '1.0',
			id: 5,
			method: 'tools/call',
			params: 'rozbité',
		};

		expect(requestWithIdSchema.safeParse(message).data).toEqual({
			jsonrpc: '1.0',
			id: 5,
			method: 'tools/call',
		});
	});
});

describe('zpráva pro okno', () => {
	it('volání nástroje s metadaty klienta projde', () => {
		const message = {
			jsonrpc: '2.0',
			id: 3,
			method: 'tools/call',
			params: {
				name: 'summary',
				arguments: {},
				_meta: {
					progressToken: 1,
				},
			},
		};

		expect(windowRequestSchema.safeParse(message).data).toEqual(message);
	});

	it('zrušení volání projde i s důvodem', () => {
		const message = {
			jsonrpc: '2.0',
			method: 'notifications/cancelled',
			params: {
				requestId: 'a',
				reason: 'Uživatel přerušil',
			},
		};

		expect(windowRequestSchema.safeParse(message).data).toEqual(message);
	});

	it('zrušení jiné verze protokolu odmítne', () => {
		const message = {
			jsonrpc: '1.0',
			method: 'notifications/cancelled',
			params: {
				requestId: 1,
			},
		};

		expect(windowRequestSchema.safeParse(message).success).toBe(false);
	});

	it('jinou metodu okno nebere, tu obslouží connector', () => {
		const message = {
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/list',
		};

		expect(windowRequestSchema.safeParse(message).success).toBe(false);
	});
});
