import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useAdopt } from '~/composables/useAdopt';
import { useExpenses } from '~/composables/useExpenses';
import { useImport } from '~/composables/useImport';
import { useInvoices } from '~/composables/useInvoices';
import { creditNoteFrom, invoiceTotalCents } from '~/utils/invoice';
import { z } from '~/utils/zod';

import { backend } from '../setup/backend';
import { foreignPdf, realBackend, sample } from '../setup/bridge';
import { prepareVault } from '../setup/vault';

const schema = resolve('desktop/isdoc/isdoc-invoice-6.0.2.xsd');
let directory: string;

function validate(xml: string) {
	const result = spawnSync('xmllint', ['--nonet', '--noout', '--schema', schema, '-'], {
		input: xml,
		encoding: 'utf8',
		timeout: 10_000,
	});
	if (result.error) throw result.error;
	return result;
}

function parsed(xml: string) {
	return z
		.object({
			invoice: z.unknown(),
			summary: z.unknown(),
		})
		.parse(
			realBackend({
				command: 'parse',
				xml,
			}),
		);
}

beforeEach(async () => {
	directory = mkdtempSync(join(tmpdir(), 'fakturian-contract-'));
	await prepareVault({}, directory);
});
afterEach(() =>
	rmSync(directory, {
		recursive: true,
		force: true,
	}),
);

describe('XSD → backend → frontend', () => {
	it('přestupný den zachová i s časovým posunem', async () => {
		const xml = sample('bez-mnozstvi.isdoc').replace('2026-03-10</IssueDate>', '2024-02-29-05:30</IssueDate>');
		expect(validate(xml).status).toBe(0);
		backend.returns('load_invoice', parsed(xml).invoice);
		const document = await useInvoices().load('2026-0043');
		expect(String(document.issueDate)).toBe('2024-02-29');
	});

	it('zaokrouhlení zachová přesnou částku dokladu', async () => {
		const xml = sample('zaokrouhleni.isdoc');
		expect(validate(xml).status).toBe(0);
		backend.returns('load_invoice', parsed(xml).invoice);
		const document = await useInvoices().load('2026-0043');
		expect(document.lines[0]).toMatchObject({
			quantity: 3,
			unitPriceCents: 33_321,
		});
		expect(document.lines[1]).toMatchObject({
			description: 'Zaokrouhlení',
			unitPriceCents: 37,
		});
		expect(invoiceTotalCents(document)).toBe(100_000);
	});

	it('platná zálohová faktura dostane při importu vysvětlení nepodporovaného druhu', async () => {
		const xml = sample('zalohova.isdoc');
		expect(validate(xml).status).toBe(0);
		const source = foreignPdf(join(directory, 'zalohova.pdf'), xml);
		backend.returns(
			'import_documents',
			realBackend({
				command: 'import',
				vault: directory,
				paths: [source],
			}),
		);
		const result = await useImport().importFiles([source]);
		expect(result.report.imported).toEqual([]);
		expect(result.report.skipped).toHaveLength(1);
		expect(result.report.skipped[0]?.reason).toBe(
			'doklad typu 4 (zálohová faktura (nedaňový zálohový list)) appka neumí — do vydaných faktur nepatří',
		);
	});

	it.each(['', 'Z', '+02:00', '-05:30', '+14:00', '-14:00'])(
		'ISDOC datum s posunem „%s“ zachová den a částku',
		async (offset) => {
			const xml = sample('bez-mnozstvi.isdoc')
				.replace('<IssueDate>2026-03-10</IssueDate>', `<IssueDate>2026-03-10${offset}</IssueDate>`)
				.replace(
					'<PaymentDueDate>2026-03-24</PaymentDueDate>',
					`<PaymentDueDate>2026-03-24${offset}</PaymentDueDate>`,
				);
			const validation = validate(xml);
			expect(validation.status, validation.stderr).toBe(0);
			const answer = parsed(xml);
			backend.returns('load_invoice', answer.invoice);
			backend.returns('list_invoices', {
				items: [answer.summary],
				broken: [],
			});
			const document = await useInvoices().load('2026-0043');
			expect(document.number).toBe('2026-0043');
			expect(String(document.issueDate)).toBe('2026-03-10');
			expect(String(document.dueDate)).toBe('2026-03-24');
			expect(document.lines[0]).toMatchObject({
				description: 'Roční licence',
				quantity: 1,
				unitPriceCents: 480_000,
			});
			expect(invoiceTotalCents(document)).toBe(480_000);
			const invoices = await useInvoices().list();
			expect(invoices).toHaveLength(1);
			expect(invoices[0]?.totalCents).toBe(480_000);
			expect(String(invoices[0]?.issueDate)).toBe('2026-03-10');
			expect(String(invoices[0]?.dueDate)).toBe('2026-03-24');
		},
	);

	it.each(['example1.isdoc', 'example2.isdoc'])(
		'oficiální vzorek %s projde do frontendového modelu',
		async (name) => {
			const xml = sample(name);
			const validation = validate(xml);
			expect(validation.status, validation.stderr).toBe(0);
			backend.returns('load_invoice', parsed(xml).invoice);
			const document = await useInvoices().load('2026-0043');
			expect(document.number).toBe('FV-111999/2011');
			expect(String(document.issueDate)).toBe('2013-02-28');
			expect(document.lines).toHaveLength(4);
			expect(document.lines[3]).toMatchObject({
				description: 'Zaokrouhlení',
				unitPriceCents: -251,
			});
		},
	);

	it('nepovinná splatnost může chybět', async () => {
		const xml = sample('bez-mnozstvi.isdoc').replace(/<PaymentMeans>[\s\S]*?<\/PaymentMeans>/, '');
		const validation = validate(xml);
		expect(validation.status, validation.stderr).toBe(0);
		backend.returns('load_invoice', parsed(xml).invoice);
		const document = await useInvoices().load('2026-0043');
		expect(document.dueDate).toBeUndefined();
	});

	it('bankovní účet a splatnost pocházejí z převodu, nikoli z první platby', async () => {
		const xml = sample('two-payments.isdoc');
		expect(validate(xml).status).toBe(0);
		backend.returns('load_invoice', parsed(xml).invoice);
		const document = await useInvoices().load('2026-0043');
		expect(document.bankAccount).toBe('2000145399');
		expect(document.bankCode).toBe('0800');
		expect(document.variableSymbol).toBe('202600047');
		expect(String(document.dueDate)).toBe('2026-03-24');
	});

	it.each(['2026-02-30Z', '2026-03-10+14:01'])('vadné datum %s odmítne XSD i backend', (value) => {
		const xml = sample('bez-mnozstvi.isdoc').replace(
			'<IssueDate>2026-03-10</IssueDate>',
			`<IssueDate>${value}</IssueDate>`,
		);
		const validation = validate(xml);
		expect(validation.status).toBe(3);
		expect(validation.stderr).toContain('IssueDate');
		expect(() => parsed(xml)).toThrow(
			new Error(`ISDOC nejde přečíst: řádek 6: prvek IssueDate neodpovídá standardu ISDOC`),
		);
	});

	it('chybějící částku odmítne skutečný backend parser', () => {
		const xml = sample('bez-castky.isdoc');
		const validation = validate(xml);
		expect(validation.status).toBe(3);
		expect(validation.stderr).toContain('LineExtensionAmount');
		expect(() =>
			realBackend({
				command: 'parse',
				xml,
			}),
		).toThrow(
			new Error(
				'ISDOC nejde přečíst: řádek 43: prvek LineExtensionAmountTaxInclusive neodpovídá standardu ISDOC',
			),
		);
	});
});

it('naimportované PDF lze načíst, převzít a použít jako přijatý doklad', async () => {
	const xml = sample('bez-mnozstvi.isdoc').replace('2026-03-10</IssueDate>', '2026-03-10+02:00</IssueDate>');
	expect(validate(xml).status).toBe(0);
	const source = foreignPdf(join(directory, 'source.pdf'), xml);
	const report = realBackend({
		command: 'import',
		vault: directory,
		paths: [source],
	});
	backend.returns('import_documents', report);
	const imported = await useImport().importFiles([source]);
	expect(imported.report.imported).toHaveLength(1);
	expect(imported.report.skipped).toEqual([]);
	expect(String(imported.report.imported[0]?.issueDate)).toBe('2026-03-10');
	const pdf = join(directory, 'faktury', '2026-0043.pdf');
	backend.returns(
		'load_invoice',
		realBackend({
			command: 'load',
			vault: directory,
			number: '2026-0043',
		}),
	);
	backend.returns(
		'list_invoices',
		realBackend({
			command: 'list',
			vault: directory,
		}),
	);
	const loaded = await useInvoices().load('2026-0043');
	expect(invoiceTotalCents(loaded)).toBe(480_000);
	const listed = await useInvoices().list();
	expect(listed[0]?.number).toBe('2026-0043');
	const adoptedVault = join(directory, 'adopted');
	mkdirSync(adoptedVault);
	copyFileSync(pdf, join(adoptedVault, 'cizi.pdf'));
	backend.returns(
		'scan_vault',
		realBackend({
			command: 'scan',
			vault: adoptedVault,
		}),
	);
	const scan = await useAdopt().refresh();
	expect(scan?.candidates[0]?.number).toBe('2026-0043');
	expect(String(scan?.candidates[0]?.issueDate)).toBe('2026-03-10');
	backend.returns(
		'import_received',
		realBackend({
			command: 'received',
			vault: directory,
			path: pdf,
		}),
	);
	const received = await useExpenses().importDocument(pdf);
	expect(received.expense.amountCents).toBe(480_000);
	expect(String(received.expense.date)).toBe('2026-03-10');
});

it('frontendový zápis projde backendem a XSD a zachová obsah', async () => {
	backend.returns('load_invoice', parsed(sample('bez-mnozstvi.isdoc')).invoice);
	const document = await useInvoices().load('2026-0043');
	document.number = '20260099';
	document.note = 'Žluťoučký & <ověřený> doklad';
	document.customer = {
		...document.customer,
		ico: '27082440',
	};
	document.lines = document.lines.map((line) => ({
		...line,
		unit: 'ks',
	}));
	await useInvoices().save(document, true);
	const call = backend.calls.find((entry) => entry.command === 'save_invoice');
	if (!call) throw new Error('Frontend nezavolal save_invoice.');
	const xml = z.string().parse(
		realBackend({
			command: 'build',
			invoice: call.args.invoice,
		}),
	);
	const validation = validate(xml);
	expect(validation.status, validation.stderr).toBe(0);
	const amount = execFileSync('xmllint', ['--xpath', 'string(//*[local-name()="PayableAmount"])', '-'], {
		input: xml,
		encoding: 'utf8',
	});
	expect(amount.trim()).toBe('4800.00');
	expect(xml).toContain('Žluťoučký &amp; &lt;ověřený&gt; doklad');
});

it('dobropis s vazbou na fakturu a položku ceníku projde backendem, XSD a zpět do appky', async () => {
	await prepareVault(
		{
			'nastaveni.json': {
				supplier: null,
				contacts: [],
				pricelist: [
					{
						id: 'p1',
						name: 'Licence',
						priceCents: 480_000,
						unit: 'ks',
					},
				],
			},
		},
		directory,
	);
	backend.returns('load_invoice', parsed(sample('bez-mnozstvi.isdoc')).invoice);
	const original = await useInvoices().load('2026-0043');
	original.number = '20260099';
	original.uuid = 'a8438851-4b4e-5ece-96ac-c34ae2f4a74c';
	original.customer = {
		...original.customer,
		ico: '27082440',
	};
	original.lines = original.lines.map((line) => ({
		...line,
		unit: 'ks',
		itemId: 'p1',
		usageYear: 2025,
	}));
	await useInvoices().save(original, true);

	// Dobropis bez důvodu formulář neuloží.
	await useInvoices().save(
		{
			...creditNoteFrom(original, '20260100'),
			note: 'Vrácení licence',
		},
		true,
	);
	const [, credit] = backend.args('save_invoice');
	const xml = z.string().parse(
		realBackend({
			command: 'build',
			invoice: credit?.invoice,
		}),
	);
	const validation = validate(xml);
	expect(validation.status, validation.stderr).toBe(0);

	const back = parsed(xml);
	backend.returns('load_invoice', back.invoice);
	const loaded = await useInvoices().load('20260100');
	expect({
		documentType: loaded.documentType,
		originalInvoice: loaded.originalInvoice,
		originalIssueDate: loaded.originalIssueDate,
		originalUuid: loaded.originalUuid,
		lines: loaded.lines.map((line) => [line.itemId, line.usageYear, line.unitPriceCents]),
	}).toEqual({
		documentType: 2,
		originalInvoice: '20260099',
		originalIssueDate: original.issueDate,
		originalUuid: 'a8438851-4b4e-5ece-96ac-c34ae2f4a74c',
		lines: original.lines.map((line) => ['p1', 2025, -line.unitPriceCents]),
	});

	backend.returns('list_invoices', {
		items: [back.summary],
		broken: [],
	});
	const [listed] = await useInvoices().list();
	expect(listed?.usageLines).toEqual(
		original.lines.map((line) => ({
			itemId: 'p1',
			quantity: line.quantity,
			usageYear: 2025,
		})),
	);
	expect(listed?.totalCents).toBe(-invoiceTotalCents(original));
});
