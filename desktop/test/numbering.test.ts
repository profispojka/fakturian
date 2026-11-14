import { describe, expect, it } from 'vitest';

import { asciiLower } from '../numbering.ts';

describe('porovnání názvů dokladů', () => {
	it('převádí na malá jen písmena ASCII', () => {
		expect(asciiLower('FAKTURA-2026 Řř')).toBe('faktura-2026 Řř');
	});
});
