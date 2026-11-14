import UButton from '@nuxt/ui/components/Button.vue';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';

import ConfirmDialog from '~/components/ConfirmDialog.vue';
import { getUserConfirmation } from '~/composables/getUserConfirmation';

import { mountUi, layer } from '../setup/mount';

const base = {
	title: 'Smazat položku?',
	message: 'Položka zmizí z ceníku.',
};

/** `open` v appce předává overlay, který dialog otevírá; bez něj se `UModal` nevykreslí. */
async function open(props: Record<string, unknown> = {}) {
	const c = mountUi(ConfirmDialog, {
		props: {
			...base,
			...props,
		},
		attrs: {
			open: true,
		},
	});
	await flushPromises();
	return c;
}

/** Vykresluje se do teleportu, takže se hledá ve vrstvě, ne ve wrapperu. */
function confirm() {
	return layer().find('[data-testid="dialog-confirm"]');
}

/** Tentýž `UButton` jako komponenta — kvůli `props('color')`, které se z DOM přečíst nedá. */
function confirmComponent(c: ReturnType<typeof mountUi>) {
	return c.findAllComponents(UButton).find((b) => b.attributes('data-testid') === 'dialog-confirm');
}

describe('ConfirmDialog', () => {
	it('ukáže nadpis i otázku', async () => {
		await open();

		expect(layer().find('[data-testid="dialog-heading"]').text()).toBe('Smazat položku?');
		expect(layer().find('[data-testid="dialog-message"]').text()).toBe('Položka zmizí z ceníku.');
	});

	it('potvrzením vrátí true, zrušením false', async () => {
		const c = await open();
		await confirm().trigger('click');
		await layer().find('[data-testid="dialog-cancel"]').trigger('click');

		expect(c.emitted('close')).toEqual([[true], [false]]);
	});

	it('výchozí popisek potvrzení je „Smazat"', async () => {
		await open();

		expect(confirm().text()).toBe('Smazat');
	});

	it('vlastní popisek potvrzení se použije', async () => {
		await open({ confirmLabel: 'Přesunout' });

		expect(confirm().text()).toBe('Přesunout');
	});

	it('destruktivní akce je červená, nedestruktivní ne', async () => {
		const destructive = await open();
		const harmless = await open({ destructive: false });

		expect(confirmComponent(destructive)!.props('color')).toBe('error');
		expect(confirmComponent(harmless)!.props('color')).toBe('primary');
	});

	it('křížkem v hlavičce se dialog zavře jako zrušený', async () => {
		const c = await open();
		const cross = layer().find('button[aria-label="Zavřít"]');

		expect(cross.exists()).toBe(true);
		await cross.trigger('click');

		expect(c.emitted('close')).toEqual([[false]]);
	});

	it('neuvedené `destructive` se chová jako destruktivní', async () => {
		const c = await open({ destructive: undefined });

		expect(confirmComponent(c)!.props('color')).toBe('error');
	});

	it('Escape zavře dialog a odpověď se překlopí na false', async () => {
		mountUi(defineComponent({ template: '<div />' }));
		const answer = getUserConfirmation('Položka zmizí z ceníku.', { title: 'Smazat položku?' });
		await flushPromises();
		expect(layer().find('[data-testid="dialog-heading"]').exists()).toBe(true);

		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'Escape',
				bubbles: true,
				cancelable: true,
			}),
		);

		expect(await answer).toBe(false);
	});

	it('zrušení otevřenou otázku zavře a odpověď se překlopí na false', async () => {
		mountUi(defineComponent({ template: '<div />' }));
		const cancel = new AbortController();
		const answer = getUserConfirmation('Položka zmizí z ceníku.', {
			title: 'Smazat položku?',
			signal: cancel.signal,
		});
		await flushPromises();
		expect(layer().find('[data-testid="dialog-heading"]').exists()).toBe(true);

		cancel.abort();

		expect(await answer).toBe(false);
		await flushPromises();
		expect(layer().find('[data-testid="dialog-heading"]').exists()).toBe(false);
	});

	it('na už zrušenou otázku se neptá vůbec', async () => {
		mountUi(defineComponent({ template: '<div />' }));
		const cancel = new AbortController();
		cancel.abort();

		const answer = await getUserConfirmation('Položka zmizí z ceníku.', {
			title: 'Smazat položku?',
			signal: cancel.signal,
		});

		expect(answer).toBe(false);
		expect(layer().find('[data-testid="dialog-heading"]').exists()).toBe(false);
	});
});
