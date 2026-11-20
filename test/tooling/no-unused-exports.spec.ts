import { globSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// Kontrola exportů doplňuje kontrolu souborů: jeden živý export nesmí schovat ostatní nepoužité.
const CANDIDATES = [
	'src/components/**/*.vue',
	'src/composables/**/*.ts',
	'src/services/**/*.ts',
	'src/schemas/**/*.ts',
	'src/utils/**/*.ts',
	'src/constants/**/*.ts',
];

// Odkazy hledáme jen v aplikaci — export, který volá výhradně jeho vlastní spec, je taky mrtvý.
const REFERRERS = [
	'src/**/*.{ts,vue}',
	'desktop/**/*.ts',
	'tools/**/*.ts',
	'test/setup/**/*.ts',
	'showcase/harness/**/*.ts',
	'nuxt.config.ts',
];

// Vědomé výjimky. Klíč = `soubor#export`, hodnota = proč smí zůstat nenapojený.
const ALLOWED = new Map<string, string>([]);

const files = globSync(CANDIDATES, { exclude: ['**/*.d.ts'] }).toSorted();
const referrers = globSync(REFERRERS, { exclude: ['desktop/test/**'] }).toSorted();
const sources = new Map(referrers.map((file) => [file, readFileSync(file, 'utf8')]));

// Auto-importy (composables, utils, komponenty) se poznají jen podle jména, takže si držíme
// index identifikátor → soubor → počet výskytů. Počet rozliší pouhou deklaraci od skutečného použití.
const mentions = new Map<string, Map<string, number>>();

for (const [file, source] of sources) {
	for (const match of source.matchAll(/[A-Za-z_$][\w$]*/g)) {
		const perFile = mentions.get(match[0]) ?? new Map<string, number>();
		perFile.set(file, (perFile.get(file) ?? 0) + 1);
		mentions.set(match[0], perFile);
	}
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
	return [...new Set([...[...declared].map((match) => match[1]), ...listed])].filter(
		(value): value is string => typeof value === 'string' && value.length > 0,
	);
}

// Živý = zmíněný v jiném souboru, nebo ve vlastním použitý i mimo řádek deklarace.
function isUsed(name: string, file: string): boolean {
	const perFile = mentions.get(name);
	if (!perFile) return false;
	if ([...perFile.keys()].some((referrer) => referrer !== file)) return true;
	return (perFile.get(file) ?? 0) > 1;
}

const targets = files.flatMap((file) =>
	exportedNames(readFileSync(file, 'utf8')).map((name) => ({
		file,
		name,
		key: `${file}#${name}`,
	})),
);

describe('žádné nepoužité exporty', () => {
	it('každý export někdo používá', () => {
		const unused = targets
			.filter((target) => !ALLOWED.has(target.key) && !isUsed(target.name, target.file))
			.map((target) => target.key);

		expect(
			unused,
			`${unused.join('\n')}\nTyhle exporty nikdo nepoužívá — ani jiný soubor v src/, ani jejich vlastní. Zapoj je, smaž, nebo přidej do ALLOWED s důvodem.`,
		).toEqual([]);
	});

	it('ALLOWED nedrží výjimky, které už neplatí', () => {
		const stale = [...ALLOWED.keys()].filter((key) => {
			const target = targets.find((candidate) => candidate.key === key);
			return !target || isUsed(target.name, target.file);
		});

		expect(stale, `Tyhle výjimky jsou zbytečné (export zmizel nebo se používá): ${stale.join(', ')}`).toEqual([]);
	});
});
