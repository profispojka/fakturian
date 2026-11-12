import { afterEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';

import { commands } from '~/bindings';
import { NOT_DESKTOP_MESSAGE, isDesktop } from '~/utils/desktop';

afterEach(() => {
	Reflect.deleteProperty(globalThis, 'fakturian');
	vi.unstubAllGlobals();
});

describe('rozpoznání prostředí', () => {
	it('bez mostu z preloadu vrátí false', () => {
		expect(isDesktop()).toBe(false);
	});

	it('s mostem, který vystaví preload, vrátí true', () => {
		Reflect.set(globalThis, 'fakturian', {});
		expect(isDesktop()).toBe(true);
	});

	it('hláška říká, čím appku spustit', () => {
		expect(NOT_DESKTOP_MESSAGE).toContain('bun run dev');
	});
});

describe('příkaz mimo desktopovou appku', () => {
	it('odmítne se větou, ne pádem na chybějícím mostu', async () => {
		vi.stubGlobal('fakturian', undefined);

		await expect(commands.homeDir()).rejects.toThrow(new Error('Příkaz běží jen v desktopové appce.'));
	});
});

describe('argumenty příkazu', () => {
	it('dojdou do mostu jako obyčejná data, i když je stránka drží reaktivně', async () => {
		// Jako `contextBridge`: argumenty zkopíruje a proxy Vue by neunesl.
		const invoke = vi.fn((_name: string, args: unknown) => Promise.resolve(structuredClone(args)));
		vi.stubGlobal('fakturian', { invoke });
		const invoice = reactive({
			supplier: {
				address: {
					city: 'Praha',
				},
			},
		});

		await commands.saveInvoice('/vault', { ...invoice } as never, true);

		expect(invoke.mock.calls).toEqual([
			[
				'save_invoice',
				{
					vaultPath: '/vault',
					invoice: {
						supplier: {
							address: {
								city: 'Praha',
							},
						},
					},
					isNew: true,
				},
			],
		]);
	});
});
