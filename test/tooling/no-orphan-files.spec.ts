import { globSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path/posix';

import { describe, expect, it } from 'vitest';

// Osiřelý soubor nikdo needituje ani nemaže, ale pořád ho drží coverage prahy, kontrola typů a code review.
// Tenhle guardrail hledá soubory, na které nevede odkaz z aplikace — ani importem, ani auto-importem.

// Vstupní body Nuxtu (routy, layouty, pluginy, middleware) nikdo neimportuje, ty tu proto nehledáme —
// zajímají nás jen soubory, které se dostanou do buildu jedině přes odkaz odjinud.
const CANDIDATES = [
	'src/components/**/*.vue',
	'src/composables/**/*.ts',
	'src/services/**/*.ts',
	'src/schemas/**/*.ts',
	'src/utils/**/*.ts',
	'src/constants/**/*.ts',
];

// Odkazy hledáme jen v aplikaci — soubor, který používá výhradně jeho vlastní spec, je taky mrtvý.
const REFERRERS = [
	'src/**/*.{ts,vue}',
	'desktop/**/*.ts',
	'tools/**/*.ts',
	'test/setup/**/*.ts',
	'showcase/harness/**/*.ts',
	'nuxt.config.ts',
];

const ALIASES: [string, string][] = [
	['~~/', ''],
	['@@/', ''],
	['~/', 'src/'],
	['@/', 'src/'],
];

const files = globSync(CANDIDATES, { exclude: ['**/*.d.ts'] }).toSorted();
const referrers = globSync(REFERRERS, { exclude: ['desktop/test/**'] }).toSorted();
const sources = new Map(referrers.map((file) => [file, readFileSync(file, 'utf8')]));
const known = new Set([...files, ...referrers]);

// Specifikátor → cesta v repu; npm balíčky a neexistující cesty vrací null.
function resolveImport(spec: string, from: string): string | null {
	const alias = ALIASES.find(([prefix]) => spec.startsWith(prefix));
	if (!alias && !spec.startsWith('.')) return null;
	const base = alias ? spec.replace(alias[0], alias[1]) : join(dirname(from), spec);
	return [base, `${base}.ts`, `${base}.vue`, `${base}/index.ts`].find((path) => known.has(path)) ?? null;
}

const imported = new Set<string>();

for (const [file, source] of sources) {
	for (const match of source.matchAll(/(?:from|import|vi\.mock)\s*\(?\s*['"]([^'"]+)['"]/g)) {
		const resolved = resolveImport(match[1]!, file);
		if (resolved && resolved !== file) imported.add(resolved);
	}
}

// Auto-importy (komponenty, composables, utils) se poznají jen podle jména v cizím souboru,
// takže si držíme index identifikátor → soubory, které ho zmiňují.
const mentions = new Map<string, Set<string>>();

for (const [file, source] of sources) {
	for (const match of source.matchAll(/[A-Za-z_$][\w$]*/g)) {
		const bucket = mentions.get(match[0]) ?? new Set<string>();
		bucket.add(file);
		mentions.set(match[0], bucket);
	}
}

const pascal = (segment: string) => segment.replace(/(^|-)(\w)/g, (_, __, char: string) => char.toUpperCase());

// Nuxt skládá jméno z cesty pod `src/components/` a vynechává segment shodný s předchozím
// (`layout/layout-header.vue` = `LayoutHeader`).
function componentName(file: string): string {
	const segments = file
		.replace('src/components/', '')
		.replace(/\.vue$/, '')
		.split('/')
		.map(pascal);
	return segments.filter((segment, index) => segment !== segments[index - 1]).join('');
}

function exportedNames(source: string): string[] {
	const declared = source.matchAll(/export\s+(?:async\s+)?(?:const|let|function|class|interface|type|enum)\s+(\w+)/g);
	const listed = [...source.matchAll(/export\s*\{([^}]*)\}/g)].flatMap((match) =>
		match[1]!.split(',').map((part) =>
			part
				.trim()
				.split(/\s+as\s+/)
				.pop()!,
		),
	);
	return [...[...declared].map((match) => match[1]), ...listed].filter(
		(value): value is string => typeof value === 'string',
	);
}

// Jméno, které zná i jiný soubor než ten zkoumaný, bereme jako použití — auto-import se v kódu jinak nepozná.
const isMentionedElsewhere = (name: string, file: string) =>
	[...(mentions.get(name) ?? [])].some((referrer) => referrer !== file);

const orphans = files.flatMap((file) => {
	const names = file.endsWith('.vue') ? [componentName(file)] : exportedNames(readFileSync(file, 'utf8'));
	const used = imported.has(file) || names.some((name) => isMentionedElsewhere(name, file));
	return used ? [] : [`${file} (${names.join(' / ') || '—'})`];
});

describe('žádné osiřelé soubory', () => {
	it('na každý soubor vede odkaz z aplikace', () => {
		expect(
			orphans,
			`${orphans.join('\n')}\nNa tyhle soubory nevede odkaz z aplikace (import ani auto-import jména v závorce). Zapoj je, nebo smaž.`,
		).toEqual([]);
	});
});
