import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';

import { errorCode } from './util.ts';

// Vlastní schéma místo `file://`: stránka má svůj původ, takže `'self'` v CSP i `fetch` platí jen
// pro build appky, ne pro celý disk.
export const APP_SCHEME = 'app';
export const APP_ORIGIN = `${APP_SCHEME}://fakturian`;

const POLICY = [
	"default-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"font-src 'self' data:",
	// Odchozí provoz webview: ARES i Fio jdou přes hlavní proces.
	"connect-src 'self'",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'none'",
	"frame-ancestors 'none'",
];

const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
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
	'.wasm': 'application/wasm',
};

const INLINE_SCRIPT = /(?<=<script(?![^>]*\ssrc=)[^>]*>)[\s\S]*?(?=<\/script>)/g;

// `nuxt generate` vkládá do HTML import mapu a konfiguraci jako inline skripty. Povolí se jen
// jejich přesný obsah (hash), ne `'unsafe-inline'` — cizí vložený skript dál neprojde.
export function contentSecurityPolicy(html: string): string {
	const hashes = (html.match(INLINE_SCRIPT) ?? []).map(
		(body) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`,
	);
	return [...POLICY, ["script-src 'self'", ...hashes].join(' ')].join('; ');
}

// Dev server Nuxtu vkládá skripty bez hashe, `eval` potřebuje HMR a websocket jeho původ.
export function developmentPolicy(devUrl: string): string {
	const { host } = new URL(devUrl);
	return [
		...POLICY.filter((directive) => !directive.startsWith('connect-src')),
		`connect-src 'self' ws://${host}`,
		"script-src 'self' 'unsafe-inline' 'unsafe-eval'",
	].join('; ');
}

function notFound(): Response {
	return new Response('Soubor v buildu appky není.', { status: 404 });
}

async function serve(file: string): Promise<Response | undefined> {
	let body: Buffer;
	try {
		body = await readFile(file);
	} catch (error) {
		const code = errorCode(error);
		// Adresář (`/` nebo `/invoice`) se chová jako chybějící soubor a dostane stránku appky.
		if (code === 'ENOENT' || code === 'EISDIR' || code === 'ENOTDIR') return undefined;
		throw error;
	}
	const type = MIME[extname(file)] ?? 'application/octet-stream';
	const headers = new Headers({ 'content-type': type });
	if (type.startsWith('text/html')) headers.set('content-security-policy', contentSecurityPolicy(body.toString()));
	return new Response(new Uint8Array(body), { headers });
}

// Navigace, kterou soubor z buildu neobslouží (`/invoice/FV.2026.007` po `location.reload()`),
// dostane `index.html` a cestu vyřeší router. Chybějící asset zůstává 404.
export function appHandler(root: string): (request: Request) => Promise<Response> {
	return async (request) => {
		const url = new URL(request.url);
		// `origin` je u schématu, které WHATWG nezná, vždycky `"null"`.
		if (`${url.protocol}//${url.host}` !== APP_ORIGIN) return notFound();
		let path: string;
		try {
			path = join(root, decodeURIComponent(url.pathname));
		} catch {
			return notFound();
		}
		if (path !== root && !path.startsWith(`${root}${sep}`)) return notFound();
		const found = await serve(path);
		if (found !== undefined) return found;
		if (request.headers.get('accept')?.includes('text/html') !== true) return notFound();
		const page = await serve(join(root, 'index.html'));
		return page ?? notFound();
	};
}
