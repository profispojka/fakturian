import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_ORIGIN, appHandler, contentSecurityPolicy, developmentPolicy } from '../protocol.ts';

const BASE_POLICY =
	"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'";

const IMPORT_MAP = '{"imports":{"#entry":"/assets/entry.js"}}';
const CONFIG = 'window.__NUXT__ = {};\n';
const PAGE = `<!DOCTYPE html><html><head><script type="importmap">${IMPORT_MAP}</script><script type="module" src="/assets/entry.js"></script></head><body><script>${CONFIG}</script></body></html>`;

function hash(body: string): string {
	return `'sha256-${createHash('sha256').update(body).digest('base64')}'`;
}

let root = '';
let handle: (request: Request) => Promise<Response>;

const page = (path: string) =>
	handle(
		new Request(`${APP_ORIGIN}${path}`, {
			headers: {
				accept: 'text/html,*/*',
			},
		}),
	);
const asset = (path: string) => handle(new Request(`${APP_ORIGIN}${path}`));

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'fakturian-protocol-'));
	await mkdir(join(root, 'assets'));
	await mkdir(join(root, 'invoice'));
	await writeFile(join(root, 'index.html'), PAGE);
	await writeFile(join(root, 'assets', 'entry.js'), 'export {};');
	await writeFile(join(root, 'assets', 'typst.wasm'), new Uint8Array([0, 97, 115, 109]));
	await writeFile(join(root, 'assets', 'data.bin'), 'x');
	handle = appHandler(root);
});

afterEach(async () => {
	await chmod(join(root, 'assets', 'entry.js'), 0o644);
	await rm(root, { recursive: true });
});

describe('stránka a assety z buildu', () => {
	it('asset dostane svůj typ a obsah', async () => {
		const script = await asset('/assets/entry.js');
		const wasm = await asset('/assets/typst.wasm');
		const unknown = await asset('/assets/data.bin');

		expect([script.status, script.headers.get('content-type'), await script.text()]).toEqual([
			200,
			'text/javascript; charset=utf-8',
			'export {};',
		]);
		expect(wasm.headers.get('content-type')).toBe('application/wasm');
		expect([...new Uint8Array(await wasm.arrayBuffer())]).toEqual([0, 97, 115, 109]);
		expect(unknown.headers.get('content-type')).toBe('application/octet-stream');
		expect(script.headers.get('content-security-policy')).toBe(null);
	});

	it('každá přípona z buildu má svůj typ', async () => {
		const types = {
			'.mjs': 'text/javascript; charset=utf-8',
			'.css': 'text/css; charset=utf-8',
			'.json': 'application/json; charset=utf-8',
			'.map': 'application/json; charset=utf-8',
			'.txt': 'text/plain; charset=utf-8',
			'.svg': 'image/svg+xml',
			'.png': 'image/png',
			'.jpg': 'image/jpeg',
			'.webp': 'image/webp',
			'.ico': 'image/x-icon',
			'.woff': 'font/woff',
			'.woff2': 'font/woff2',
			'.ttf': 'font/ttf',
		};
		for (const extension of Object.keys(types)) {
			await writeFile(join(root, 'assets', `soubor${extension}`), 'x');
		}

		const served: Record<string, string | null> = {};
		for (const extension of Object.keys(types)) {
			const response = await asset(`/assets/soubor${extension}`);
			served[extension] = response.headers.get('content-type');
		}

		expect(served).toEqual(types);
	});

	it('HTML nese CSP s hashi svých inline skriptů', async () => {
		const response = await page('/index.html');

		expect(await response.text()).toBe(PAGE);
		expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
		expect(response.headers.get('content-security-policy')).toBe(
			`${BASE_POLICY}; script-src 'self' ${hash(IMPORT_MAP)} ${hash(CONFIG)}`,
		);
	});

	it('navigace na adresu routeru i na složku dostane stránku appky', async () => {
		for (const path of [
			'/',
			'/invoice',
			'/invoice/FV.2026.007',
			'/customers/new',
			'/assets/entry.js/x',
			'/a%2F..',
		]) {
			const response = await page(path);
			expect([path, response.status, await response.text()]).toEqual([path, 200, PAGE]);
		}
	});

	it('chybějící asset zůstává 404, stránku nedostane', async () => {
		for (const path of ['/assets/chybi.js', '/invoice/FV.2026.007', '/', '/assets/entry.js/x']) {
			const response = await asset(path);
			expect([path, response.status, await response.text()]).toEqual([path, 404, 'Soubor v buildu appky není.']);
		}
		const fetched = await handle(
			new Request(`${APP_ORIGIN}/assets/chybi.json`, {
				headers: {
					accept: '*/*',
				},
			}),
		);
		expect(fetched.status).toBe(404);
	});

	it('mimo build ani na cizí hostitel se nedostane', async () => {
		await writeFile(join(root, '..', 'tajne.txt'), 'heslo');
		try {
			for (const url of [
				`${APP_ORIGIN}/..%2Ftajne.txt`,
				`${APP_ORIGIN}/assets/..%2F..%2Ftajne.txt`,
				`${APP_ORIGIN}/%E0%A4%A`,
				'app://jiny/index.html',
				'https://fakturian/index.html',
			]) {
				const response = await handle(
					new Request(url, {
						headers: {
							accept: 'text/html',
						},
					}),
				);
				expect([url, response.status]).toEqual([url, 404]);
			}
		} finally {
			await rm(join(root, '..', 'tajne.txt'));
		}
	});

	it('build bez index.html odpoví na navigaci 404', async () => {
		await rm(join(root, 'index.html'));

		const response = await page('/invoice/new');

		expect(response.status).toBe(404);
	});

	it('nečitelný soubor je chyba, ne chybějící soubor', async () => {
		await chmod(join(root, 'assets', 'entry.js'), 0o000);

		await expect(asset('/assets/entry.js')).rejects.toThrow(/EACCES: permission denied/);
	});
});

describe('Content Security Policy', () => {
	it('skript se `src` hash nedostane', () => {
		expect(contentSecurityPolicy('<script src="/a.js"></script><script defer src="/b.js"></script>')).toBe(
			`${BASE_POLICY}; script-src 'self'`,
		);
	});

	it('dev server dostane eval, inline skripty a websocket svého původu', () => {
		expect(developmentPolicy('http://127.0.0.1:1420')).toBe(
			"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; connect-src 'self' ws://127.0.0.1:1420; script-src 'self' 'unsafe-inline' 'unsafe-eval'",
		);
	});
});
