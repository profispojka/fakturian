import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { useFio } from '~/composables/useFio';

import { backend } from '../setup/backend';
import { realBackend, backendSession } from '../setup/bridge';
import { date } from '../setup/dates';

const FROM = date('2026-05-01');
const TO = date('2026-05-31');

function statement(transactions: unknown[], currency = 'CZK'): unknown {
	return {
		accountStatement: {
			info: {
				currency,
			},
			transactionList: {
				transaction: transactions,
			},
		},
	};
}

function parsed(transactions: unknown[]): unknown {
	return realBackend({
		command: 'fio',
		statement: statement(transactions),
	});
}

// Fio z lokálního serveru: skutečné HTTP volání `fioFetch`, jen jiná adresa. `realBackend()` čeká
// synchronně a server v témže procesu by nestihl odpovědět; relace mostu běží vedle.
const session = backendSession();
let answer = {
	status: 200,
	body: readFileSync('test/contracts/fixtures/fio-transactions.json', 'utf8'),
};
const requested: string[] = [];
const fio = createServer((request, response) => {
	requested.push(request.url ?? '');
	response.writeHead(answer.status, { 'content-type': 'application/json' });
	response.end(answer.body);
});

beforeAll(async () => {
	const { promise, resolve } = Promise.withResolvers<void>();
	fio.listen(0, '127.0.0.1', resolve);
	await promise;
});
afterAll(() => {
	fio.close();
	session.close();
});

beforeEach(() => {
	backend.fio.token = 'abcdefghij0123456789ABCDEFGHIJabcdefghij0123456789ABCDEFGHIJ0123';
	answer = {
		status: 200,
		body: readFileSync('test/contracts/fixtures/fio-transactions.json', 'utf8'),
	};
	requested.length = 0;
	const address = fio.address();
	if (!address || typeof address === 'string') throw new Error('Lokální Fio server neposlouchá.');
	backend.forwards('fio_fetch', (args) =>
		session.call({
			command: 'fio_fetch',
			base: `http://127.0.0.1:${address.port}`,
			token: backend.fio.token,
			from: args.from,
			to: args.to,
		}),
	);
});

it('výpis přes HTTP projde skutečným backendem až do plateb v appce', async () => {
	const payments = await useFio().fetchPayments(FROM, TO);

	expect(requested).toEqual([`/periods/${backend.fio.token}/2026-05-01/2026-05-31/transactions.json`]);
	expect(payments).toEqual([
		{
			id: '26001',
			amountCents: 1_210_000,
			vs: '20260001',
			date: date('2026-05-20'),
			message: 'Faktura 20260001',
		},
		{
			id: '26003',
			amountCents: 1_000_000,
			vs: '20260002',
			date: date('2026-05-22'),
			message: '',
		},
	]);
});

it.each([
	[409, '{}', 'Fio: příliš mnoho dotazů (limit 1 za 30 s). Zkus to za chvíli.'],
	[422, '{}', 'Fio: neplatný token nebo požadavek.'],
	[500, '{}', 'Fio vrátil chybu 500 Internal Server Error.'],
	[200, '<html>údržba</html>', 'Fio vrátilo odpověď, které Fakturian nerozumí.'],
])('odpověď %i s tělem %s appka ohlásí hláškou z backendu', async (status, body, message) => {
	answer = {
		status,
		body,
	};

	await expect(useFio().fetchPayments(FROM, TO)).rejects.toBe(message);
});

it('výpis z Fia projde skutečným backendem do modelu plateb', async () => {
	backend.returns(
		'fio_fetch',
		parsed([
			{
				column0: {
					value: '2026-05-20+0200',
				},
				column1: {
					value: 1000.0,
				},
				column2: {
					value: '12345/0100',
				},
				column5: {
					value: '20260001',
				},
				column16: {
					value: 'Platba faktury',
				},
				column22: {
					value: 26_001,
				},
			},
			{
				column0: {
					value: '2026-05-21+0200',
				},
				column1: {
					value: -500.0,
				},
				column5: {
					value: '999',
				},
			},
			// Fio posílá variabilní symbol podle transakce jednou jako řetězec, jednou jako číslo.
			{
				column0: {
					value: '2026-05-22+0200',
				},
				column1: {
					value: 2500.0,
				},
				column5: {
					value: 20_260_002,
				},
			},
		]),
	);

	const payments = await useFio().fetchPayments(FROM, TO);

	expect(payments).toHaveLength(2);
	expect(payments[0]).toEqual({
		id: '26001',
		amountCents: 100_000,
		vs: '20260001',
		date: date('2026-05-20'),
		message: 'Platba faktury',
	});
	expect(payments[1]?.vs).toBe('20260002');
	expect(payments[1]?.id).toBe('');
	expect(String(payments[1]?.date)).toBe('2026-05-22');
});

it('platbu bez data z Fia odmítne už hlavní proces, místo aby dostala dnešek', () => {
	expect(() =>
		parsed([
			{
				column1: {
					value: 10.0,
				},
				column5: {
					value: '1',
				},
			},
		]),
	).toThrow(new Error('Fio poslalo transakci (č. 1 v pořadí) bez čitelného data — Fakturian ji radši nezpracuje.'));
});

it('nečitelnou částku odmítne backend, místo aby z ní udělal nulu', () => {
	expect(() =>
		parsed([
			{
				column1: {
					value: 'tisíc',
				},
				column22: {
					value: '77',
				},
			},
		]),
	).toThrow(
		new Error(
			'Fio poslalo transakci (id 77) s nečitelnou nebo nesmyslně velkou částkou — Fakturian ji radši nezpracuje, než aby ji spolkl jako nulu.',
		),
	);
});

it('výpis bez transakcí je prázdný seznam, ne chyba', async () => {
	backend.returns(
		'fio_fetch',
		realBackend({
			command: 'fio',
			statement: {
				accountStatement: {
					info: {
						currency: 'CZK',
					},
				},
			},
		}),
	);

	await expect(useFio().fetchPayments(FROM, TO)).resolves.toEqual([]);
});

it('účet v eurech odmítne backend, místo aby 1 000 EUR zapsal jako 1 000 Kč', () => {
	const incoming = {
		column0: {
			value: '2026-05-20+0200',
		},
		column1: {
			value: 1000.0,
		},
		column5: {
			value: '20260001',
		},
	};

	expect(() =>
		realBackend({
			command: 'fio',
			statement: statement([incoming], 'EUR'),
		}),
	).toThrow(
		new Error('Fio účet je vedený v EUR. Fakturian páruje jen platby na korunový účet — ulož token k účtu v CZK.'),
	);
});
