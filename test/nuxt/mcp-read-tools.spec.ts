import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentKind } from '~/constants/invoice';
import { newInvoice } from '~/schemas/invoices';

import { backend, wireInvoice } from '../setup/backend';
import { date } from '../setup/dates';
import { summary } from '../setup/fixtures';
import { connectAgent, replyTo, usageInVault, vaultWithContent } from '../setup/mcp-client';
import { documentInVault } from '../setup/vault';

function creditNoteInVault(number: string, original: string): void {
	const inv = newInvoice(null, number);
	inv.issueDate = date('2026-03-25');
	inv.documentType = DocumentKind.CreditNote;
	inv.originalInvoice = original;
	// Znaménko dobropisu otáčí až součet v `list_invoices` dvojníka.
	inv.lines = [
		{
			id: 'r1',
			description: 'Práce',
			quantity: 1,
			unit: 'ks',
			unitPriceCents: 121_000,
		},
	];
	backend.folder('/vault').invoices.set(number, wireInvoice(inv));
}

const PAID_IN_FULL = {
	'20260001': [
		{
			id: 'p1',
			date: date('2026-03-20'),
			amountCents: 121_000,
		},
	],
};

beforeEach(async () => {
	await vaultWithContent();
});

describe('čtecí nástroje', () => {
	it('list_invoices vrací částky v korunách a stav zaplacení', async () => {
		await vaultWithContent({ payments: PAID_IN_FULL });
		documentInVault(summary('20260001'));
		await connectAgent();
		const id = backend.mcp.call('list_invoices');

		const reply = await replyTo(id);
		expect(reply.result).toEqual([
			{
				number: '20260001',
				customer: 'Acme',
				issueDate: '2026-03-01',
				dueDate: '2026-03-15',
				total: 1210,
				paid: true,
				credited: false,
				paidAmount: 1210,
				paidDate: '2026-03-20',
			},
		]);
	});

	it('faktura bez záznamu o platbě je nezaplacená', async () => {
		documentInVault(summary('20260001'));
		await connectAgent();
		const id = backend.mcp.call('list_invoices');

		const reply = await replyTo(id);
		expect(reply.result).toEqual([
			expect.objectContaining({
				paid: false,
				paidAmount: 0,
			}),
		]);
	});

	it('zčásti uhrazenou fakturu nevydá za zaplacenou, ale řekne kolik přišlo', async () => {
		await vaultWithContent({
			payments: {
				'20260001': [
					{
						id: 'p2',
						date: date('2026-03-20'),
						amountCents: 50_000,
					},
				],
			},
		});
		documentInVault(summary('20260001'));
		await connectAgent();
		const id = backend.mcp.call('list_invoices');

		const reply = await replyTo(id);
		expect(reply.result).toEqual([
			expect.objectContaining({
				paid: false,
				paidAmount: 500,
			}),
		]);
	});

	it('dobropisovanou fakturu bez platby nevydá za zaplacenou', async () => {
		documentInVault(summary('20260001'));
		creditNoteInVault('20260002', '20260001');
		await connectAgent();
		const id = backend.mcp.call('list_invoices');

		const reply = await replyTo(id);
		expect(reply.result).toEqual([
			expect.objectContaining({
				number: '20260001',
				paid: false,
				credited: true,
				paidAmount: 0,
				total: 1210,
			}),
			expect.objectContaining({
				number: '20260002',
				originalInvoice: '20260001',
				total: -1210,
				paidAmount: 0,
			}),
		]);
	});

	it('zaplacená a pak dobropisovaná faktura zůstane zaplacená', async () => {
		await vaultWithContent({ payments: PAID_IN_FULL });
		documentInVault(summary('20260001'));
		creditNoteInVault('20260002', '20260001');
		await connectAgent();
		const id = backend.mcp.call('get_invoice', { number: '20260001' });

		const reply = await replyTo(id);
		expect(reply.result).toEqual(
			expect.objectContaining({
				paid: true,
				credited: true,
				paidAmount: 1210,
			}),
		);
	});

	it('get_invoice vrátí doklad i s částkou', async () => {
		documentInVault(summary('20260001'));
		await connectAgent();
		const id = backend.mcp.call('get_invoice', { number: '20260001' });

		const reply = await replyTo(id);
		// Celý doklad by opakoval výchozí hodnoty `newInvoice()`; tady jde o to, co nástroj přidá.
		expect(reply.result).toEqual(
			expect.objectContaining({
				number: '20260001',
				issueDate: '2026-03-01',
				dueDate: '2026-03-15',
				customer: expect.objectContaining({ name: 'Acme' }),
				lines: [
					{
						id: expect.any(String),
						description: 'Práce',
						quantity: 1,
						unit: 'ks',
						unitPriceCents: 121_000,
						itemId: '',
					},
				],
				paid: false,
				credited: false,
				paidAmount: 0,
				total: 1210,
			}),
		);
	});

	it('get_invoice hlásí i stav zaplacení', async () => {
		await vaultWithContent({ payments: PAID_IN_FULL });
		documentInVault(summary('20260001'));
		await connectAgent();
		const id = backend.mcp.call('get_invoice', { number: '20260001' });

		const reply = await replyTo(id);
		expect(reply.result).toEqual(
			expect.objectContaining({
				paid: true,
				paidAmount: 1210,
				paidDate: '2026-03-20',
			}),
		);
	});

	it('get_invoice na neexistující doklad to řekne', async () => {
		await connectAgent();
		const id = backend.mcp.call('get_invoice', { number: '20269999' });

		const reply = await replyTo(id);
		expect(reply.error).toBe('Faktura 20269999 neexistuje.');
	});

	it('get_invoice bez čísla vrátí čitelnou chybu', async () => {
		await connectAgent();
		const id = backend.mcp.call('get_invoice', {});

		const reply = await replyTo(id);
		expect(reply.error).toBe('Neplatné argumenty (number: Neplatný vstup: očekáváno řetězec, obdrženo undefined).');
	});

	it('list_contacts vrací jen přehledové údaje odběratele', async () => {
		await vaultWithContent({
			contacts: [
				{
					id: 'k1',
					name: 'Acme',
					ico: '25596641',
					address: {
						street: 'Dlouhá 1',
						city: 'Praha',
						zip: '11000',
					},
				},
			],
		});
		await connectAgent();
		const id = backend.mcp.call('list_contacts');

		const reply = await replyTo(id);
		expect(reply.result).toEqual([
			{
				name: 'Acme',
				ico: '25596641',
				email: undefined,
				city: 'Praha',
				note: undefined,
			},
		]);
	});

	it('list_expenses vrací zapsané výdaje s částkou v korunách', async () => {
		await vaultWithContent({
			expenses: [
				{
					id: 'v1',
					supplier: 'Server',
					description: 'Hosting',
					amountCents: 1200_00,
					date: date('2026-01-01'),
				},
			],
		});
		await connectAgent();
		const id = backend.mcp.call('list_expenses');

		const reply = await replyTo(id);
		expect(reply.result).toEqual([
			{
				supplier: 'Server',
				description: 'Hosting',
				amount: 1200,
				date: '2026-01-01',
			},
		]);
	});

	it('pricelist_status hlásí vykázání položek za rok', async () => {
		usageInVault('20260001', 16);
		await connectAgent();
		const id = backend.mcp.call('pricelist_status', { year: '2026' });

		const reply = await replyTo(id);
		expect(reply.result).toEqual({
			year: 2026,
			items: [
				expect.objectContaining({
					name: 'Konzultační činnost',
					note: 'dovolená',
					unit: 'hod',
					price: 1200,
					limit: 160,
					used: 16,
					remaining: 144,
					invoices: [
						{
							invoiceNumber: '20260001',
							quantity: 16,
						},
					],
				}),
			],
		});
		expect(backend.args('list_invoices')).toEqual([{ vaultPath: '/vault' }]);
	});

	it('bez ročníku vezme letošní rok', async () => {
		vi.useFakeTimers();
		vi.setSystemTime('2026-08-31T10:00');
		await connectAgent();
		const id = backend.mcp.call('pricelist_status', {});

		const reply = await replyTo(id);
		expect(reply.result).toEqual(expect.objectContaining({ year: 2026 }));
	});

	it('číselný ročník se vezme, ne zahodí', async () => {
		await connectAgent();
		const id = backend.mcp.call('pricelist_status', { year: 2025 });

		const reply = await replyTo(id);
		expect(reply.result).toEqual(expect.objectContaining({ year: 2025 }));
		expect(reply.error).toBeNull();
	});

	it.each([['loni'], ['202'], ['0999'], ['2026-03'], [' 2026 '], ['2e3'], [999], [2026.5]])(
		'ročník %j odmítne jako neplatný argument',
		async (year) => {
			await connectAgent();
			const id = backend.mcp.call('pricelist_status', { year });

			const reply = await replyTo(id);
			expect(reply).toEqual({
				result: null,
				error: 'Neplatné argumenty (year: Zadej rok jako RRRR.).',
			});
		},
	);

	it.each([
		[
			'pricelist_status',
			{
				year: 2026,
				rok: 2026,
			},
			'rok',
		],
		[
			'summary',
			{
				year: 2026,
				rok: 2026,
			},
			'rok',
		],
		[
			'get_invoice',
			{
				number: '20260001',
				cislo: '20260001',
			},
			'cislo',
		],
	])('%s s překlepnutým klíčem odmítne', async (tool, args, key) => {
		await connectAgent();
		const id = backend.mcp.call(tool, args);

		const reply = await replyTo(id);
		expect(reply.result).toBeNull();
		expect(reply.error).toBe(`Neplatné argumenty (Neznámé klíče: "${key}").`);
	});

	it.each([['pricelist_status'], ['summary']])('%s s argumenty mimo objekt vrátí čitelnou chybu', async (tool) => {
		await connectAgent();
		const id = backend.mcp.call(tool, 'loni');

		const reply = await replyTo(id);
		expect(reply.error).toBe('Neplatné argumenty (Neplatný vstup: očekáváno object, obdrženo řetězec).');
	});

	it('summary bez ročníku vezme letošní rok', async () => {
		vi.useFakeTimers();
		vi.setSystemTime('2026-08-31T10:00');
		await connectAgent();
		const id = backend.mcp.call('summary', {});

		const reply = await replyTo(id);
		expect(reply.result).toEqual(expect.objectContaining({ year: 2026 }));
	});

	it('summary hlásí plátcovství z loňského překročení limitu', async () => {
		vi.useFakeTimers();
		vi.setSystemTime('2026-02-03T10:00');
		documentInVault(
			summary('20250001', {
				totalCents: 2_100_000_00,
				issueDate: date('2025-11-01'),
				dueDate: date('2025-11-15'),
			}),
		);
		await connectAgent();
		const id = backend.mcp.call('summary', {});

		const reply = await replyTo(id);
		expect(reply.result).toEqual(
			expect.objectContaining({
				vatLimit: expect.objectContaining({
					turnover: 0,
					stage: 'below',
					previousYear: {
						year: 2025,
						turnover: 2_100_000,
						stage: 'next-year',
						payerFrom: '2026-01-01',
					},
				}),
			}),
		);
	});

	it('summary vrací skutečný obrat, náklady, marži i dlužníky', async () => {
		vi.useFakeTimers();
		vi.setSystemTime('2026-08-31T10:00');
		await vaultWithContent({
			expenses: [
				{
					id: 'v1',
					supplier: 'Grafik',
					description: 'Logo',
					amountCents: 200_000,
					date: date('2026-03-10'),
				},
			],
		});
		documentInVault(
			summary('20260001', {
				totalCents: 100_000_000,
				customer: 'Acme',
			}),
		);
		await connectAgent();
		const id = backend.mcp.call('summary', { year: '2026' });

		const reply = await replyTo(id);
		expect(reply.result).toEqual({
			year: 2026,
			turnover: 1_000_000,
			costs: 2_000,
			margin: 998_000,
			debtors: [
				{
					customer: 'Acme',
					amount: 1_000_000,
				},
			],
			vatLimit: {
				turnover: 1_000_000,
				limit: 2_000_000,
				immediateLimit: 2_536_500,
				ratio: 0.5,
				stage: 'below',
				payerFrom: undefined,
				year: 2026,
				from: '2026-01-01',
				to: '2026-12-31',
				previousYear: {
					year: 2025,
					turnover: 0,
					stage: 'below',
					payerFrom: undefined,
				},
			},
		});
	});
});
