import { afterEach, describe, expect, it, vi } from 'vitest';

import { systemServices } from '~/services/system';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('most hlavního procesu', () => {
	it('posluchače předá mostu a vrátí jeho odhlášení', () => {
		const off = vi.fn();
		const on = vi.fn().mockReturnValue(off);
		vi.stubGlobal('fakturian', {
			on,
		});
		const listener = vi.fn();

		expect(systemServices.on('focus-changed', listener)).toBe(off);
		expect(on).toHaveBeenCalledExactlyOnceWith('focus-changed', listener);
	});

	it('cestu přetaženého souboru vezme od mostu', () => {
		const file = new File([''], 'faktura.pdf');
		const pathForFile = vi.fn().mockReturnValue('/Users/jan/faktura.pdf');
		vi.stubGlobal('fakturian', {
			pathForFile,
		});

		expect(systemServices.pathForFile(file)).toBe('/Users/jan/faktura.pdf');
		expect(pathForFile).toHaveBeenCalledExactlyOnceWith(file);
	});

	it('bez mostu řekne, že okno běží mimo desktopovou appku', () => {
		vi.stubGlobal('fakturian', undefined);

		expect(() => systemServices.on('focus-changed', vi.fn())).toThrow(
			new Error('Okno běží jen v desktopové appce.'),
		);
		expect(() => systemServices.pathForFile(new File([''], 'x.pdf'))).toThrow(
			new Error('Okno běží jen v desktopové appce.'),
		);
	});
});
