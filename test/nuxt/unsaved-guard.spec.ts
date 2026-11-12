import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

import { canDiscardUnsaved, useUnsavedGuard } from '~/composables/useForm';

import { mountUi } from '../setup/mount';

function page(guard: () => Promise<boolean>) {
	return defineComponent({
		setup() {
			useUnsavedGuard(guard);
			return () => h('div');
		},
	});
}

function postponedAnswer() {
	let answer!: (v: boolean) => void;
	const promise = new Promise<boolean>((resolve) => {
		answer = resolve;
	});
	return {
		promise,
		answer,
	};
}

describe('hlídka zavření okna', () => {
	it('bez přihlášené stránky pustí zavření', async () => {
		expect(await canDiscardUnsaved()).toBe(true);
	});

	it('ptá se přihlášené stránky a vrací její verdikt', async () => {
		const guard = vi.fn(() => Promise.resolve(false));
		mountUi(page(guard));

		expect(await canDiscardUnsaved()).toBe(false);
		expect(guard).toHaveBeenCalledOnce();
	});

	it('po odchodu ze stránky se hlídka odhlásí', async () => {
		const guard = vi.fn(() => Promise.resolve(false));
		const c = mountUi(page(guard));
		c.unmount();

		expect(await canDiscardUnsaved()).toBe(true);
		expect(guard).not.toHaveBeenCalled();
	});

	it('odhlášení staré stránky nechá novou být', async () => {
		const old = vi.fn(() => Promise.resolve(true));
		const nova = vi.fn(() => Promise.resolve(false));
		const c = mountUi(page(old));
		mountUi(page(nova));
		c.unmount();

		expect(await canDiscardUnsaved()).toBe(false);
		expect(nova).toHaveBeenCalledOnce();
	});

	it('dokud dialog stojí, další dotaz odmítne bez dalšího dialogu', async () => {
		const { promise, answer } = postponedAnswer();
		const guard = vi.fn(() => promise);
		mountUi(page(guard));

		const first = canDiscardUnsaved();
		expect(await canDiscardUnsaved()).toBe(false);
		expect(guard).toHaveBeenCalledOnce();

		answer(true);
		expect(await first).toBe(true);
	});

	it('po zodpovězeném dialogu se ptá znovu', async () => {
		const guard = vi.fn(() => Promise.resolve(true));
		mountUi(page(guard));

		await canDiscardUnsaved();
		await canDiscardUnsaved();

		expect(guard).toHaveBeenCalledTimes(2);
	});
});
