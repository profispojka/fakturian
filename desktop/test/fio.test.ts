import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';

import { AsyncEntry } from '@napi-rs/keyring';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeServers, MockHttp, raw, redirect, reroute, route } from './http.ts';

import { fioClearToken, fioFetch, fioHasToken, fioSetToken, parseFio } from '../fio.ts';
import { USER_AGENT } from '../util.ts';

// Hledání v klíčence přes `security`; výsledek určuje test, spouštění samo hlídá `keyring.test.ts`.
const security = vi.hoisted(() => ({
	search: vi.fn<(file: string, args: string[]) => { failure: Error | null; stderr: string }>(),
}));

vi.mock(import('node:child_process'), async (importOriginal) => {
	const original = await importOriginal();
	return {
		...original,
		execFile: (
			file: string,
			args: string[],
			done: (failed: Error | null, stdout: string, stderr: string) => void,
		) => {
			const answer = security.search(file, args);
			done(answer.failure, '', answer.stderr);
		},
	};
});

class ExecError extends Error {
	constructor(
		message: string,
		readonly code: number | string,
	) {
		super(message);
	}
}

const TOKEN = 'abcdefghij0123456789ABCDEFGHIJabcdefghij0123456789ABCDEFGHIJ0123';
const TOKEN_MESSAGE = 'Fio token má být 64 znaků A–Z, a–z, 0–9 (zkopíruj ho z internetového bankovnictví celý).';
const AMOUNT_MESSAGE =
	's nečitelnou nebo nesmyslně velkou částkou — Fakturian ji radši nezpracuje, než aby ji spolkl jako nulu.';
const PERIOD = {
	from: '2026-05-01',
	to: '2026-05-31',
};

// Klíčenka pro testy drží jeden záznam; skutečnou hlídá `keyring.test.ts`. Chybějící záznam vrací
// knihovna jako `null`.
let stored: string | null = null;
let refusal: Error | undefined;

function operation<T>(result: () => T): Promise<T> {
	const refused = refusal;
	refusal = undefined;
	if (refused) return Promise.reject(refused);
	return Promise.resolve(result());
}

const reads = vi.fn<() => Promise<string | undefined>>(() => operation(() => stored ?? undefined));

beforeEach(async () => {
	reroute('https://fioapi.fio.cz');
	refusal = undefined;
	vi.spyOn(AsyncEntry.prototype, 'getPassword').mockImplementation(reads);
	vi.spyOn(AsyncEntry.prototype, 'setPassword').mockImplementation((password: string) =>
		operation(() => {
			stored = password;
		}),
	);
	vi.spyOn(AsyncEntry.prototype, 'deleteCredential').mockImplementation(() =>
		operation(() => {
			const existed = stored !== null;
			stored = null;
			return existed;
		}),
	);
	security.search.mockImplementation(() =>
		stored === null
			? {
					failure: new ExecError('Command failed: /usr/bin/security find-generic-password', 44),
					stderr: 'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\n',
				}
			: {
					failure: null,
					stderr: '',
				},
	);
	// Token, který si appka pamatuje z minulého testu, zapomene jedině smazání.
	await fioClearToken();
	reads.mockClear();
	security.search.mockClear();
});

afterEach(async () => {
	await closeServers();
});

function statement(transactions: unknown, currency: unknown = 'CZK'): unknown {
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

async function failure(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error('Volání mělo selhat.');
}

describe('Fio token v klíčence', () => {
	it('platný token se uloží bez okrajových mezer, najde a smaže', async () => {
		expect(await fioSetToken({ token: `  ${TOKEN}  ` })).toBe(null);
		expect(stored).toBe(TOKEN);
		expect(await fioHasToken()).toBe(true);

		expect(await fioClearToken()).toBe(null);
		expect(await fioHasToken()).toBe(false);
		expect(await fioClearToken()).toBe(null);
	});

	it('token musí mít 64 znaků A–Z, a–z, 0–9 a neplatný se do klíčenky nedostane', async () => {
		const head = TOKEN.slice(0, 62);
		for (const wrong of [
			'',
			'kratky',
			'not a fio token',
			TOKEN.slice(0, 63),
			`${TOKEN}4`,
			`${head} 3`,
			`${head}/3`,
			`${head}?3`,
			`${head}#3`,
			`${head}č3`,
		]) {
			await expect(fioSetToken({ token: wrong })).rejects.toThrow(new Error(TOKEN_MESSAGE));
		}
		expect(stored).toBe(null);
	});

	it('chybu úložiště předá každá operace dál', async () => {
		const refused = new Error('úložiště odmítlo operaci');
		for (const call of [() => fioSetToken({ token: TOKEN }), () => fioClearToken(), () => fioFetch(PERIOD)]) {
			refusal = refused;
			await expect(call()).rejects.toBe(refused);
		}
	});

	it('existenci tokenu ověří hledáním bez čtení hesla', async () => {
		stored = TOKEN;

		expect(await fioHasToken()).toBe(true);
		stored = null;
		expect(await fioHasToken()).toBe(false);
		expect(reads).not.toHaveBeenCalled();
		expect(security.search.mock.calls).toEqual([
			['/usr/bin/security', ['find-generic-password', '-s', 'com.fakturian.desktop', '-a', 'fio-token']],
			['/usr/bin/security', ['find-generic-password', '-s', 'com.fakturian.desktop', '-a', 'fio-token']],
		]);
	});

	it('nepovedené hledání v klíčence se ohlásí větou', async () => {
		security.search.mockReturnValueOnce({
			failure: new ExecError('Command failed: /usr/bin/security find-generic-password', 51),
			stderr: 'security: SecKeychainSearchCopyNext: Klíčenka je zamčená.\n',
		});
		await expect(fioHasToken()).rejects.toThrow(
			new Error(
				'Fio token v klíčence nejde vyhledat: security: SecKeychainSearchCopyNext: Klíčenka je zamčená.',
				{
					cause: expect.objectContaining({ code: 51 }),
				},
			),
		);

		security.search.mockReturnValueOnce({
			failure: new ExecError('spawn /usr/bin/security ENOENT', 'ENOENT'),
			stderr: '',
		});
		await expect(fioHasToken()).rejects.toThrow(
			new Error('Fio token v klíčence nejde vyhledat: spawn /usr/bin/security ENOENT'),
		);
	});

	it('token se z klíčenky čte nejvýš jednou a zapomene ho jen smazání', async () => {
		stored = TOKEN;
		const server = await MockHttp.answering(200, JSON.stringify(statement([])));

		expect(await fioFetch(PERIOD)).toEqual([]);
		expect(await fioFetch(PERIOD)).toEqual([]);
		expect(await fioHasToken()).toBe(true);
		expect(security.search).not.toHaveBeenCalled();
		expect(reads).toHaveBeenCalledTimes(1);
		// Odmítnutí by zasáhlo příští čtení klíčenky; další stažení si token bere z paměti.
		refusal = new Error('úložiště odmítlo operaci');
		await expect(
			fioFetch({
				from: 'neplatné datum',
				to: '2026-05-31',
			}),
		).rejects.toThrow(new Error('Neplatné datum „od" (čekám RRRR-MM-DD).'));
		refusal = undefined;

		expect(await fioClearToken()).toBe(null);
		expect(await fioHasToken()).toBe(false);
		await expect(fioFetch(PERIOD)).rejects.toThrow(new Error('Není uložený Fio token.'));
		expect(reads).toHaveBeenCalledTimes(2);
		expect(server.paths).toEqual([
			`/v1/rest/periods/${TOKEN}/2026-05-01/2026-05-31/transactions.json`,
			`/v1/rest/periods/${TOKEN}/2026-05-01/2026-05-31/transactions.json`,
		]);
	});

	it('uložený token se zpátky nečte a neuložený se nezapamatuje', async () => {
		const refused = new Error('úložiště odmítlo operaci');
		refusal = refused;
		await expect(fioSetToken({ token: TOKEN })).rejects.toBe(refused);
		expect(await fioHasToken()).toBe(false);

		await fioSetToken({ token: TOKEN });
		expect(await fioHasToken()).toBe(true);
		expect(security.search).toHaveBeenCalledTimes(1);
		expect(reads).not.toHaveBeenCalled();
	});

	it('nepovedené smazání token nezapomene', async () => {
		await fioSetToken({ token: TOKEN });
		const refused = new Error('úložiště odmítlo operaci');
		refusal = refused;

		await expect(fioClearToken()).rejects.toBe(refused);
		expect(await fioHasToken()).toBe(true);
		expect(security.search).not.toHaveBeenCalled();
		expect(reads).not.toHaveBeenCalled();
	});

	it('bez uloženého tokenu se banka nekontaktuje', async () => {
		const server = await MockHttp.answering(200, '{}');

		await expect(fioFetch(PERIOD)).rejects.toThrow(new Error('Není uložený Fio token.'));
		expect(server.paths).toEqual([]);
	});

	it('token v klíčence v cizím tvaru se na síť nepošle', async () => {
		const server = await MockHttp.answering(200, '{}');
		stored = `${TOKEN.slice(0, 62)}/x`;

		await expect(fioFetch(PERIOD)).rejects.toThrow(new Error(TOKEN_MESSAGE));
		expect(server.paths).toEqual([]);
	});
});

describe('období stažení', () => {
	it('datum musí být skutečný den ve tvaru RRRR-MM-DD, jinak se na síť nejde', async () => {
		const server = await MockHttp.answering(200, JSON.stringify(statement([])));
		stored = TOKEN;

		expect(
			await fioFetch({
				from: '2024-02-29',
				to: '2024-03-01',
			}),
		).toEqual([]);
		for (const wrong of [
			'',
			'2026-5-1',
			'01.05.2026',
			'1.5.2026',
			'2026-13-01',
			'2026-05-32',
			'2026-05-0a',
			'../../etc',
			'2026-05-01?x=1',
			'2026-02-31',
			'2026-02-29',
			'+2026-05-01',
			'neplatné datum',
		]) {
			await expect(
				fioFetch({
					from: wrong,
					to: '2026-05-31',
				}),
			).rejects.toThrow(new Error('Neplatné datum „od" (čekám RRRR-MM-DD).'));
			await expect(
				fioFetch({
					from: '2026-05-01',
					to: wrong,
				}),
			).rejects.toThrow(new Error('Neplatné datum „do" (čekám RRRR-MM-DD).'));
		}
		expect(server.paths).toEqual([`/v1/rest/periods/${TOKEN}/2024-02-29/2024-03-01/transactions.json`]);
	});

	it('argumenty z webview v jiném tvaru pojmenují vadné pole a na síť nejdou', async () => {
		const server = await MockHttp.answering(200, '{}');
		stored = TOKEN;

		await expect(fioFetch(JSON.parse('{"from":20260501,"to":"2026-05-31"}'))).rejects.toThrow(
			new Error('Neplatné datum „od" (čekám RRRR-MM-DD).'),
		);
		await expect(fioFetch(JSON.parse('{"from":"2026-05-01"}'))).rejects.toThrow(
			new Error('Neplatné datum „do" (čekám RRRR-MM-DD).'),
		);
		expect(server.paths).toEqual([]);
	});
});

describe('rozbor výpisu z Fio', () => {
	it('bere jen příchozí platby a sjednotí text i čísla na řetězce', () => {
		const payments = parseFio(
			statement([
				{
					column0: {
						value: '2026-05-20+0200',
					},
					column1: {
						value: 1000.0,
					},
					column5: {
						value: '20260001',
					},
					column2: {
						value: '12345/0100',
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
					column16: {
						value: null,
					},
					column2: 'bez hodnoty',
				},
			]),
		);

		expect(payments).toEqual([
			{
				id: '26001',
				amountCents: 100_000,
				vs: '20260001',
				date: '2026-05-20',
				message: 'Platba faktury',
			},
			{
				id: '',
				amountCents: 250_000,
				vs: '20260002',
				date: '2026-05-22',
				message: '',
			},
		]);
	});

	it('výpis v plném tvaru Fio API dá jen příchozí platby', async () => {
		const body = await readFile(new URL('fixtures/fio-transactions.json', import.meta.url), 'utf8');

		expect(parseFio(JSON.parse(body))).toEqual([
			{
				id: '26001',
				amountCents: 1_210_000,
				vs: '20260001',
				date: '2026-05-20',
				message: 'Faktura 20260001',
			},
			{
				id: '26003',
				amountCents: 1_000_000,
				vs: '20260002',
				date: '2026-05-22',
				message: '',
			},
		]);
	});

	it('částky přijdou v celých haléřích a pod haléř nejsou platbou', () => {
		const payments = parseFio(
			statement([
				{
					column0: {
						value: '2026-05-20',
					},
					column1: {
						value: 1250.7,
					},
				},
				{
					column0: {
						value: '2026-05-21',
					},
					column1: {
						value: 0.004,
					},
				},
				{
					column0: {
						value: '2026-05-22',
					},
					column1: {
						value: 0.005,
					},
				},
			]),
		);

		expect(payments.map(({ amountCents }) => amountCents)).toEqual([125_070, 1]);
	});

	it('výpis bez pohybů je prázdný, ne chyba', () => {
		expect(parseFio(statement(null))).toEqual([]);
		expect(
			parseFio({
				accountStatement: {
					info: {
						currency: 'CZK',
					},
				},
			}),
		).toEqual([]);
		expect(parseFio(statement({ '0': {} }))).toEqual([]);
	});

	it('účet v jiné měně se odmítne i bez pohybů', () => {
		const message =
			'Fio účet je vedený v EUR. Fakturian páruje jen platby na korunový účet — ulož token k účtu v CZK.';
		const payment = {
			column0: {
				value: '2026-05-20+0200',
			},
			column1: {
				value: 1000.0,
			},
			column22: {
				value: 26_001,
			},
		};

		expect(() => parseFio(statement([payment], 'EUR'))).toThrow(new Error(message));
		expect(() => parseFio(statement(null, 'EUR'))).toThrow(new Error(message));
	});

	it('výpis bez měny se odmítne', () => {
		for (const json of [
			{},
			[],
			null,
			'CZK',
			{
				accountStatement: {
					transactionList: {
						transaction: [],
					},
				},
			},
			{
				accountStatement: {
					info: {
						currency: 203,
					},
				},
			},
			{
				accountStatement: {
					info: 'CZK',
				},
			},
		]) {
			expect(() => parseFio(json)).toThrow(new Error('Fio neposlalo měnu účtu, platby proto nejde spárovat.'));
		}
	});

	it('částka jako text je chyba s ID pohybu, ne nula', () => {
		const json = statement([
			{
				column0: {
					value: '2026-05-20+0200',
				},
				column1: {
					value: '1000,00',
				},
				column22: {
					value: '9911223344',
				},
			},
		]);

		expect(() => parseFio(json)).toThrow(new Error(`Fio poslalo transakci (id 9911223344) ${AMOUNT_MESSAGE}`));
	});

	it('chybějící nebo přehnaná částka je chyba s pořadím pohybu bez ID', () => {
		const missing = statement([
			{
				column0: {
					value: '2026-05-20',
				},
				column1: {
					value: 100.0,
				},
			},
			{
				column0: {
					value: '2026-05-21',
				},
				column5: {
					value: '1',
				},
			},
		]);
		const huge = statement([
			{
				column1: {
					value: 90_000_000_000.01,
				},
			},
		]);

		expect(() => parseFio(missing)).toThrow(new Error(`Fio poslalo transakci (č. 2 v pořadí) ${AMOUNT_MESSAGE}`));
		expect(() => parseFio(huge)).toThrow(new Error(`Fio poslalo transakci (č. 1 v pořadí) ${AMOUNT_MESSAGE}`));
		expect(
			parseFio(
				statement([
					{
						column0: {
							value: '2026-05-20+0200',
						},
						column1: {
							value: 90_000_000_000,
						},
					},
				]),
			),
		).toEqual([
			{
				id: '',
				amountCents: 9_000_000_000_000,
				vs: '',
				date: '2026-05-20',
				message: '',
			},
		]);
	});

	it('příchozí platba bez čitelného data je chyba, odchozí se přeskočí i bez něj', () => {
		const payment = (date: unknown, amount: number) => ({
			column0: {
				value: date,
			},
			column1: {
				value: amount,
			},
			column22: {
				value: '9911223344',
			},
		});
		const unreadable = new Error(
			'Fio poslalo transakci (id 9911223344) bez čitelného data — Fakturian ji radši nezpracuje.',
		);

		expect(() => parseFio(statement([payment('20.5.2026', 100)]))).toThrow(unreadable);
		expect(() => parseFio(statement([payment('2026-02-30+0100', 100)]))).toThrow(unreadable);
		expect(() => parseFio(statement([payment(undefined, 100)]))).toThrow(unreadable);
		expect(parseFio(statement([payment(undefined, -100)]))).toEqual([]);
	});
});

describe('stažení z Fio', () => {
	beforeEach(() => {
		stored = TOKEN;
	});

	it('stáhne a rozebere platby z pevné adresy s tokenem a obdobím a představí se jako Fakturian', async () => {
		const server = await MockHttp.answering(
			200,
			JSON.stringify(
				statement([
					{
						column0: {
							value: '2026-05-20+0200',
						},
						column1: {
							value: 1500.0,
						},
						column5: {
							value: '20260007',
						},
					},
				]),
			),
		);

		expect(await fioFetch(PERIOD)).toEqual([
			{
				id: '',
				amountCents: 150_000,
				vs: '20260007',
				date: '2026-05-20',
				message: '',
			},
		]);
		expect(server.received.map(({ path, headers }) => [path, headers.get('user-agent')])).toEqual([
			[`/v1/rest/periods/${TOKEN}/2026-05-01/2026-05-31/transactions.json`, USER_AGENT],
		]);
	});

	it('účet v jiné měně ze serveru dorazí jako chyba', async () => {
		await MockHttp.answering(200, JSON.stringify(statement([], 'EUR')));

		await expect(fioFetch(PERIOD)).rejects.toThrow(
			new Error(
				'Fio účet je vedený v EUR. Fakturian páruje jen platby na korunový účet — ulož token k účtu v CZK.',
			),
		);
	});

	it('stav odpovědi dá srozumitelnou hlášku', async () => {
		for (const [status, message] of [
			[409, 'Fio: příliš mnoho dotazů (limit 1 za 30 s). Zkus to za chvíli.'],
			[422, 'Fio: neplatný token nebo požadavek.'],
			[404, 'Fio: neplatný token nebo požadavek.'],
			[500, 'Fio vrátil chybu 500 Internal Server Error.'],
			[503, 'Fio vrátil chybu 503 Service Unavailable.'],
			[599, 'Fio vrátil chybu 599.'],
		] as const) {
			await MockHttp.answering(status, '{"chyba":"server"}');

			await expect(fioFetch(PERIOD)).rejects.toThrow(new Error(message));
		}
		// Odpověď 304 nemá tělo, `response.body` je `null`.
		await MockHttp.answering(304, '');

		await expect(fioFetch(PERIOD)).rejects.toThrow(new Error('Fio vrátil chybu 304 Not Modified.'));
	});

	it('přesměrování se nesleduje, token nesmí na jiný server', async () => {
		const server = await MockHttp.routes([
			redirect(`/v1/rest/periods/${TOKEN}/2026-05-01/2026-05-31/transactions.json`, '/jinam'),
			route('/jinam', 200, {}, JSON.stringify(statement([]))),
		]);

		await expect(fioFetch(PERIOD)).rejects.toThrow(new Error('Fio vrátil chybu 301 Moved Permanently.'));
		expect(server.paths).toEqual([`/v1/rest/periods/${TOKEN}/2026-05-01/2026-05-31/transactions.json`]);
	});

	it('odpověď, která není JSON nebo nese číslo mimo rozsah, dá jasnou chybu', async () => {
		for (const body of ['<html>Fio je v údržbě</html>', JSON.stringify(statement([])).replace('[]', '[1e400]')]) {
			await MockHttp.answering(200, body);

			await expect(fioFetch(PERIOD)).rejects.toThrow(new Error('Fio vrátilo odpověď, které Fakturian nerozumí.'));
		}
	});

	it('useknuté tělo odpovědi se ohlásí jako nečitelné', async () => {
		await MockHttp.routes([
			raw(
				`/v1/rest/periods/${TOKEN}/2026-05-01/2026-05-31/transactions.json`,
				'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 5000\r\nConnection: close\r\n\r\n{"acc',
			),
		]);

		await expect(fioFetch(PERIOD)).rejects.toThrow(new Error('Odpověď z Fio se nepodařilo přečíst.'));
	});

	it('nečitelná částka ze serveru dorazí jako chyba', async () => {
		await MockHttp.answering(
			200,
			JSON.stringify(
				statement([
					{
						column1: {
							value: 'tisíc',
						},
						column22: {
							value: '77',
						},
					},
				]),
			),
		);

		await expect(fioFetch(PERIOD)).rejects.toThrow(new Error(`Fio poslalo transakci (id 77) ${AMOUNT_MESSAGE}`));
	});

	it('odmítnuté spojení hlásí, že je appka offline', async () => {
		await MockHttp.closing();

		await expect(fioFetch(PERIOD)).rejects.toThrow(new Error('Nepodařilo se spojit s Fio (jste offline?).'));
	});

	it('server, který neodpoví, utne limit 15 s', async () => {
		const server = await MockHttp.silent();
		const expired = new AbortController();
		const limit = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => expired.signal);

		const fetched = fioFetch(PERIOD);
		// Limit vyprší, až když dotaz na server dorazil; pevný čas by ho na vytíženém stroji předběhl.
		await vi.waitFor(() =>
			expect(server.paths).toEqual([`/v1/rest/periods/${TOKEN}/2026-05-01/2026-05-31/transactions.json`]),
		);
		expired.abort(new DOMException('Limit vypršel.', 'TimeoutError'));

		await expect(fetched).rejects.toThrow(new Error('Fio neodpovědělo do 15 sekund. Zkus to za chvíli.'));

		expect(limit.mock.calls).toEqual([[15_000]]);
	});

	it('žádná chyba nenese token ani jeho kus, ani v příčině', async () => {
		const errors: unknown[] = [];
		{
			await MockHttp.closing();
			errors.push(await failure(fioFetch(PERIOD)));
			errors.push(
				await failure(
					fioFetch({
						from: 'kdovíco',
						to: '2026-05-31',
					}),
				),
			);
		}
		for (const [status, body] of [
			[409, ''],
			[422, ''],
			[404, ''],
			[500, ''],
			[503, ''],
			[301, ''],
			[200, '<html>nic</html>'],
			[
				200,
				JSON.stringify(
					statement([
						{
							column1: {
								value: 'x',
							},
						},
					]),
				),
			],
		] as const) {
			await MockHttp.answering(status, body);
			errors.push(await failure(fioFetch(PERIOD)));
		}
		{
			await MockHttp.routes([
				raw(
					`/v1/rest/periods/${TOKEN}/2026-05-01/2026-05-31/transactions.json`,
					'HTTP/1.1 200 OK\r\nContent-Length: 50\r\nConnection: close\r\n\r\n{',
				),
			]);
			errors.push(await failure(fioFetch(PERIOD)));
		}

		expect(errors.length).toBe(11);
		for (const error of errors) {
			expect(inspect(error, { depth: null })).not.toContain(TOKEN.slice(0, 16));
			expect(inspect(error, { depth: null })).not.toContain(TOKEN.slice(-16));
		}
	});
});
