import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeServers, MockHttp, raw, redirect, reroute, route } from './http.ts';

import pkg from '../../package.json' with { type: 'json' };
import { aresSubject } from '../ares.ts';

const ICO = '12345679';
const PATH = `/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${ICO}`;
const SUBJECT = {
	ico: ICO,
	obchodniJmeno: 'Testovací firma s.r.o.',
	sidlo: {
		nazevObce: 'Praha',
		psc: 11000,
	},
};

beforeEach(() => {
	reroute('https://ares.gov.cz');
});

afterEach(closeServers);

describe('dotaz do ARES', () => {
	it('vrátí syrovou odpověď rejstříku pro IČO', async () => {
		const server = await MockHttp.routes([
			route(PATH, 200, { 'Content-Type': 'application/json' }, JSON.stringify(SUBJECT)),
		]);

		expect(await aresSubject({ ico: ICO })).toEqual(SUBJECT);
		expect(server.received.map(({ path, headers }) => [path, headers.get('user-agent')])).toEqual([
			[PATH, `Fakturian/${pkg.version}`],
		]);
	});

	it('neplatné IČO se odmítne dřív, než odejde dotaz', async () => {
		const server = await MockHttp.routes([]);

		for (const ico of ['', '12345678', '1234567', '123456790', '1234567a', '1234 5679', ` ${ICO}`, `${ICO}/../x`]) {
			await expect(aresSubject({ ico })).rejects.toThrow(new Error('Neplatné IČO (8 číslic).'));
		}
		expect(server.paths).toEqual([]);
	});

	it('nenalezená firma a chyba rejstříku mají vlastní hlášku', async () => {
		for (const [status, message] of [
			[404, 'Firma s tímto IČO nebyla v ARES nalezena.'],
			[500, 'ARES vrátil chybu 500.'],
			[503, 'ARES vrátil chybu 503.'],
		] as const) {
			await MockHttp.answering(status, '{"kod":"CHYBA"}');

			await expect(aresSubject({ ico: ICO })).rejects.toThrow(new Error(message));
		}
		// Odpověď 304 nemá tělo, `response.body` je `null`.
		await MockHttp.answering(304, '');

		await expect(aresSubject({ ico: ICO })).rejects.toThrow(new Error('ARES vrátil chybu 304.'));
	});

	it('přesměrování se nesleduje', async () => {
		const server = await MockHttp.routes([
			redirect(PATH, '/jinam'),
			route('/jinam', 200, { 'Content-Type': 'application/json' }, JSON.stringify(SUBJECT)),
		]);

		await expect(aresSubject({ ico: ICO })).rejects.toThrow(new Error('ARES vrátil chybu 301.'));
		expect(server.paths).toEqual([PATH]);
	});

	it('nečitelná, useknutá nebo nesmyslná odpověď se ohlásí', async () => {
		for (const answer of [
			route(PATH, 200, { 'Content-Type': 'text/html' }, '<html>Údržba</html>'),
			route(PATH, 200, { 'Content-Type': 'application/json' }, '{"ico":1e400}'),
			raw(PATH, 'HTTP/1.1 200 OK\r\nContent-Length: 5000\r\nConnection: close\r\n\r\n{"ico":'),
		]) {
			await MockHttp.routes([answer]);

			await expect(aresSubject({ ico: ICO })).rejects.toThrow(
				new Error('Odpověď z ARES se nepodařilo přečíst.', { cause: expect.any(Error) }),
			);
		}
	});

	it('odmítnuté spojení hlásí, že je appka offline', async () => {
		await MockHttp.closing();

		await expect(aresSubject({ ico: ICO })).rejects.toThrow(
			new Error('Nepodařilo se spojit s ARES (jste offline?).', { cause: new TypeError('fetch failed') }),
		);
	});

	it('server, který neodpoví, utne limit 15 s', async () => {
		const server = await MockHttp.silent();
		const expired = new AbortController();
		const limit = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => expired.signal);

		const subject = aresSubject({ ico: ICO });
		// Limit vyprší, až když dotaz na server dorazil; pevný čas by ho na vytíženém stroji předběhl.
		await vi.waitFor(() => expect(server.paths).toEqual([PATH]));
		expired.abort(new DOMException('Limit vypršel.', 'TimeoutError'));

		await expect(subject).rejects.toThrow(
			new Error('Nepodařilo se spojit s ARES (jste offline?).', {
				cause: expect.objectContaining({ name: 'TimeoutError' }),
			}),
		);

		expect(limit.mock.calls).toEqual([[15_000]]);
		expect(server.paths).toEqual([PATH]);
	});
});
