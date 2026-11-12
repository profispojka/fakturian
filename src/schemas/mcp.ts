import { invoiceLineSchema } from '~/schemas/invoices';
import { MIN_YEAR, MAX_YEAR } from '~/utils/date';
import { z, type Zod } from '~/utils/zod';

// Agent si argumenty domýšlí z popisu nástroje, proto `strictObject`: překlep v klíči odmítne celé volání.
const noArgsSchema = z.strictObject({});
// Rok chodí jako číslo i řetězec, v obou případech jen celý RRRR.
const yearArgsSchema = z.strictObject({
	year: z
		.union(
			[
				z.int().min(MIN_YEAR, 'Zadej rok jako RRRR.').max(MAX_YEAR, 'Zadej rok jako RRRR.'),
				z
					.string()
					.regex(/^[1-9]\d{3}$/)
					.transform(Number),
			],
			'Zadej rok jako RRRR.',
		)
		.optional()
		.describe('Rok, výchozí letošní'),
});

// Pořadí je pořadí v `tools/list`. Connector seznam posílá i bez běžící appky, proto ho skládá
// z `mcpToolList()` sám.
export const MCP_TOOLS = {
	list_invoices: {
		description:
			'Seznam vystavených faktur a dobropisů: číslo, původní faktura u dobropisu, odběratel, data, částka, zaplaceno, dobropisováno, uhrazená část a datum poslední platby.',
		args: noArgsSchema,
	},
	get_invoice: {
		description: 'Detail jedné faktury včetně položek a stavu úhrady.',
		args: z.strictObject({ number: z.string().describe('Číslo faktury') }),
	},
	list_contacts: {
		description: 'Seznam odběratelů.',
		args: noArgsSchema,
	},
	list_expenses: {
		description: 'Výdaje: dodavatel, popis, částka, datum.',
		args: noArgsSchema,
	},
	pricelist_status: {
		description:
			'Ceník a jeho vykázání za rok: u každé položky kolik jí odešlo, kolik zbývá do ročního limitu (0 = položka se nehlídá) a na kterých fakturách je.',
		args: yearArgsSchema,
	},
	summary: {
		description: 'Souhrn: obrat, marže, kdo dluží a kolik, stav limitu plátcovství DPH.',
		args: yearArgsSchema,
	},
	create_invoice: {
		description:
			'Vystaví fakturu. Uživatel ji musí potvrdit v okně appky a do té doby volání čeká. Číslo přidělí appka z číselné řady; doklad se uloží jako PDF s vloženým ISDOC.',
		args: z.strictObject({
			customerName: z.string(),
			note: z.string().optional(),
			// Řádek měří schéma formuláře; počet řádků a součet hlídá `validate()` jako u formuláře.
			lines: z.array(
				z.strictObject({
					...invoiceLineSchema.shape,
					unitPriceCents: invoiceLineSchema.shape.unitPriceCents.describe('Cena za jednotku v haléřích.'),
					usageYear: invoiceLineSchema.shape.usageYear.describe(
						'Interní rok čerpání ročního limitu; výchozí je rok vystavení.',
					),
					itemId: z.string().optional(),
				}),
			),
		}),
	},
};

export type McpToolName = keyof typeof MCP_TOOLS;

export function isMcpToolName(name: string): name is McpToolName {
	return Object.hasOwn(MCP_TOOLS, name);
}

export function mcpToolList() {
	return Object.entries(MCP_TOOLS).map(([name, tool]) => ({
		name,
		description: tool.description,
		inputSchema: z.toJSONSchema(tool.args, { io: 'input' }),
	}));
}

// Musí sedět s `WindowMessage` v `desktop/mcp/mod.ts`. Bez `line` connector spojení zavřel.
export const windowMessageSchema = z.strictObject({
	session: z.number().int(),
	line: z.string().optional(),
});

const requestIdSchema = z.union([z.string(), z.number()]);
export type RequestId = Zod.infer<typeof requestIdSchema>;

// Z neplatné zprávy stačí vyčíst, na co odpovědět; bez `id` je to notifikace a ta odpověď nedostane.
export const requestWithIdSchema = z.object({
	jsonrpc: z.unknown(),
	id: requestIdSchema,
	method: z.string(),
});

// Connector oknu posílá jen tyhle dvě zprávy; zbytek protokolu obslouží sám.
// Stryker disable next-line StringLiteral: zod volbu bez diskriminátoru odmítne už při importu.
export const windowRequestSchema = z.discriminatedUnion('method', [
	// Stryker disable next-line ObjectLiteral: zod volbu bez diskriminátoru odmítne už při importu.
	z.strictObject({
		jsonrpc: z.literal('2.0'),
		id: requestIdSchema,
		method: z.literal('tools/call'),
		params: z.strictObject({
			name: z.string(),
			arguments: z.unknown().optional(),
			_meta: z.unknown().optional(),
		}),
	}),
	// Stryker disable next-line ObjectLiteral: zod volbu bez diskriminátoru odmítne už při importu.
	z.strictObject({
		jsonrpc: z.literal('2.0'),
		method: z.literal('notifications/cancelled'),
		params: z.strictObject({
			requestId: requestIdSchema,
			reason: z.string().optional(),
			_meta: z.unknown().optional(),
		}),
	}),
]);
