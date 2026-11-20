import { globSync, readFileSync } from 'node:fs';

import lucide from '@iconify-json/lucide/icons.json';
import { describe, expect, it } from 'vitest';

const known = new Set([...Object.keys(lucide.icons), ...Object.keys(lucide.aliases)]);

function missingIcons(source: string): string[] {
	return [...source.matchAll(/\bi-lucide-([a-z0-9]+(?:-[a-z0-9]+)*)(?![\w-])/g)]
		.map((match) => match[1]!)
		.filter((name) => !known.has(name));
}

describe('statické ikony existují v kolekci Lucide', () => {
	it('kontroluje šablony, konfiguraci i seznamy ikon v TypeScriptu', () => {
		const violations = globSync('src/**/*.{ts,vue}')
			.toSorted()
			.flatMap((file) => missingIcons(readFileSync(file, 'utf8')).map((name) => `${file}: i-lucide-${name}`));
		expect(violations).toEqual([]);
	});

	it('odmítne neexistující ikonu ve skriptu i v šabloně', () => {
		expect(missingIcons('const icon = "i-lucide-nonexistent-fakturian-icon";')).toEqual([
			'nonexistent-fakturian-icon',
		]);
		expect(missingIcons('<UIcon name="i-lucide-nonexistent-fakturian-icon" />')).toEqual([
			'nonexistent-fakturian-icon',
		]);
	});

	it('povolí známé ikony a nehodnotí jména sestavená za běhu', () => {
		expect(missingIcons('<UIcon name="i-lucide-check" />')).toEqual([]);
		expect(missingIcons(`\`i-lucide-\${name}\`; \`i-lucide-fakturian-\${name}\``)).toEqual([]);
	});
});
