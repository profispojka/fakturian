#!/usr/bin/env node
/**
 * Kontrola vygenerovaného webu — to, co se na statickém HTML dá ověřit
 * strojově, ať se na to nemusí koukat člověk.
 *
 *   node capture/audit.ts --dist showcase/.output/public [--base https://priklad.cz]
 *
 * Hlídá věci, které nejčastěji rozbijí SEO a přístupnost: chybějící nebo
 * useknuté title/description, víc než jedno H1, obrázky bez alt, rozbité
 * vnitřní odkazy, chybějící canonical/OG, neplatný JSON-LD, těžké obrázky.
 * Není to Lighthouse — výkon a kontrast si změř v prohlížeči.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { logger, parseArgs } from './lib/util.ts';

const log = logger('audit');

const LIMITS = {
	title: [15, 65],
	description: [70, 165],
	imageBytes: 500_000,
};

async function walk(dir: string, filter: (file: string) => boolean, acc: string[] = []): Promise<string[]> {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) await walk(full, filter, acc);
		else if (filter(full)) acc.push(full);
	}
	return acc;
}

const pick = (html: string, re: RegExp): string | undefined => html.match(re)?.[1]?.trim();

function checkPage(html: string, file: string, allFiles: Set<string>, dist: string) {
	const bad: string[] = [];
	const title = pick(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
	const desc = pick(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
	const canonical = pick(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i);
	const lang = pick(html, /<html[^>]+lang=["']([^"']*)["']/i);
	const h1 = html.match(/<h1[\s>]/gi)?.length ?? 0;

	if (!title) bad.push('chybí <title>');
	else if (title.length < LIMITS.title[0] || title.length > LIMITS.title[1]) {
		bad.push(`title má ${title.length} znaků (chtěj ${LIMITS.title.join('–')})`);
	}
	if (!desc) bad.push('chybí meta description');
	else if (desc.length < LIMITS.description[0] || desc.length > LIMITS.description[1]) {
		bad.push(`description má ${desc.length} znaků (chtěj ${LIMITS.description.join('–')})`);
	}
	if (!canonical) bad.push('chybí canonical');
	if (!lang) bad.push('chybí lang na <html>');
	if (h1 === 0) bad.push('chybí H1');
	if (h1 > 1) bad.push(`${h1}× H1 (má být jedno)`);

	for (const tag of ['og:title', 'og:description', 'og:image', 'twitter:card']) {
		const re = new RegExp(`(property|name)=["']${tag}["']`, 'i');
		if (!re.test(html)) bad.push(`chybí ${tag}`);
	}

	const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
	const noAlt = imgs.filter((t) => !/\salt=/i.test(t)).length;
	if (noAlt) bad.push(`${noAlt}× <img> bez alt`);

	// Obrázek, který na disku není, se v HTML pozná jen podle cesty — v prohlížeči
	// se pak ukáže alt text a nikdo si toho nemusí všimnout.
	for (const tag of imgs) {
		const src = tag.match(/\ssrc=["'](\/[^"']+)["']/i)?.[1];
		if (src && !allFiles.has(path.normalize(path.join(dist, src.split('?')[0])))) {
			bad.push(`obrázek chybí: ${src}`);
		}
	}
	for (const m of html.matchAll(/<(?:video|source|track)\b[^>]*\s(?:src|poster)=["'](\/[^"']+)["']/gi)) {
		if (!allFiles.has(path.normalize(path.join(dist, m[1].split('?')[0])))) {
			bad.push(`soubor videa chybí: ${m[1]}`);
		}
	}
	const noDims = imgs.filter((t) => !/\swidth=/i.test(t) || !/\sheight=/i.test(t)).length;
	// Bez rozměrů poskočí layout, jakmile se obrázek načte (CLS).
	if (noDims) bad.push(`${noDims}× <img> bez width/height`);

	for (const block of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
		try {
			JSON.parse(block[1]);
		} catch {
			bad.push('neplatný JSON-LD');
		}
	}

	// vnitřní odkazy → existuje pro ně soubor?
	const rel = path.relative(dist, file);
	for (const m of html.matchAll(/href=["'](\/[^"'#?]*)["']/g)) {
		const href = m[1];
		if (/\.(png|jpe?g|svg|webp|css|js|xml|txt|ico|mp4|webm|pdf|vtt)$/i.test(href)) continue;
		const candidates = [
			path.join(dist, href),
			path.join(dist, href, 'index.html'),
			path.join(dist, `${href}.html`),
		];
		if (!candidates.some((c) => allFiles.has(path.normalize(c)))) {
			bad.push(`odkaz nikam nevede: ${href}`);
		}
	}

	return {
		page: rel,
		problems: [...new Set(bad)],
	};
}

async function main() {
	const args = parseArgs();
	const dist = path.resolve(process.cwd(), args.dist ?? 'showcase/.output/public');

	const files = await walk(dist, () => true);
	const set = new Set(files.map((f) => path.normalize(f)));
	// `200.html` a `404.html` v kořeni jsou u statických buildů prázdné skořápky
	// pro hosting (SPA fallback), ne stránky — kontrolovat je nemá smysl.
	const fallbacks = new Set([path.join(dist, '200.html'), path.join(dist, '404.html')]);
	const pages = files.filter((f) => f.endsWith('.html') && !fallbacks.has(f));
	if (!pages.length) throw new Error(`V ${dist} nejsou žádné .html — je web sestavený?`);

	let problems = 0;
	for (const file of pages) {
		const html = await readFile(file, 'utf8');
		const res = checkPage(html, file, set, dist);
		if (res.problems.length) {
			problems += res.problems.length;
			log.warn(`${res.page}\n   - ${res.problems.join('\n   - ')}`);
		}
	}

	for (const must of ['sitemap.xml', 'robots.txt']) {
		if (!set.has(path.normalize(path.join(dist, must)))) {
			problems++;
			log.warn(`chybí ${must}`);
		}
	}

	const heavy = [];
	for (const file of files.filter((candidate) => /\.(png|jpe?g|webp|gif)$/i.test(candidate))) {
		const { size } = await stat(file);
		if (size > LIMITS.imageBytes) heavy.push(`${path.relative(dist, file)} (${Math.round(size / 1024)} kB)`);
	}
	if (heavy.length) {
		problems += heavy.length;
		log.warn(`těžké obrázky:\n   - ${heavy.join('\n   - ')}`);
	}

	log.info(`${pages.length} stránek, ${problems} nálezů`);
	process.exit(problems ? 1 : 0);
}

try {
	await main();
} catch (e) {
	console.error(e);
	process.exit(1);
}
