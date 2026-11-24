import { describe, expect, it } from 'vitest';

import { MENU } from '~/constants/palette';

const all = MENU.flat().filter((row) => row.type !== 'label');

describe('sekce appky', () => {
	it('má sedm sekcí ve dvou skupinách s popisky, dole integrace a nastavení', () => {
		expect(MENU.map((group) => group.map((row) => row.label))).toEqual([
			['Přehled', 'Doklady', 'Faktury', 'Výdaje', 'Evidence', 'Odběratelé', 'Ceník'],
			['Integrace', 'Nastavení'],
		]);
	});

	it('každá sekce má cestu, popisek i ikonu', () => {
		for (const s of all) {
			expect(s.to.startsWith('/')).toBe(true);
			expect(s.label.trim()).not.toBe('');
			expect(s.icon.startsWith('i-lucide-')).toBe(true);
		}
	});

	it('cesty se neopakují', () => {
		expect(new Set(all.map((s) => s.to)).size).toBe(all.length);
	});

	it('značka pro test odpovídá adrese', () => {
		for (const s of all) expect(s['data-testid']).toBe(`menu-section${s.to}`);
	});
});

describe('odznáčky sekcí', () => {
	it('nosí je jen faktury a výdaje', () => {
		expect(all.filter((s) => s.stat).map((s) => s.to)).toEqual(['/invoice', '/expense']);
	});
});
