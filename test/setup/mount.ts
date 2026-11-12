import UApp from '@nuxt/ui/components/App.vue';
import UButton from '@nuxt/ui/components/Button.vue';
import { cs } from '@nuxt/ui/locale';
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { expect, vi } from 'vitest';
import { defineComponent, h, provide } from 'vue';

import { PageRouteSymbol } from '#app/components/injections';
import { NuxtPage } from '#components';
import { monthsBetween, monthOf, parseDate, periodOf, toCalendarDate, today, yearOf } from '~/utils/date';

import type { VueWrapper } from '@vue/test-utils';
import type { Component, VNodeChild } from 'vue';
import type { DateString } from '~/utils/date';

interface MountOptions {
	props?: Record<string, unknown>;
	attrs?: Record<string, unknown>;
	slots?: Record<string, () => VNodeChild>;
	global?: { provide?: Record<string | symbol, unknown>; [key: string]: unknown };
}

const KNOWN_OPTIONS = new Set(['props', 'attrs', 'slots', 'global']);

// Dialog z `useOverlay()` vykresluje `UApp` obalu, ne testovaná komponenta.
const hosts = new WeakMap<VueWrapper, VueWrapper>();

export function mountUi(component: Component, options: MountOptions = {}): VueWrapper {
	const unknown = Object.keys(options).filter((k) => !KNOWN_OPTIONS.has(k));
	if (unknown.length) {
		throw new Error(`mountUi() neumí volbu ${unknown.join(', ')} — přenáší jen ${[...KNOWN_OPTIONS].join(', ')}.`);
	}

	const { props = {}, attrs = {}, slots, global = {} } = options;

	const Host = defineComponent({
		name: 'UiHost',
		setup: () => {
			// V appce routu mimo stránky poskytuje `nuxt-root`; bez ní `NuxtLayout` varuje a čte `undefined`.
			provide(PageRouteSymbol, useRoute());
			return () =>
				h(
					UApp,
					{ locale: cs },
					{
						default: () =>
							h(
								component,
								{
									...props,
									...attrs,
								},
								slots,
							),
					},
				);
		},
	});

	/**
	 * `attachTo` je podmínka, ne kosmetika: modály a nabídky se teleportují do `document.body` a mimo
	 * dokument by se nevykreslily vůbec.
	 */
	const root = mount(Host, {
		attachTo: document.body,
		global,
	});

	// Wrapper testované komponenty, ne obalu — jinak by `emitted()` viselo na `UApp`.
	const c: VueWrapper = root.findComponent(component);

	c.unmount = () => root.unmount();
	hosts.set(c, root);
	return c;
}

/**
 * Stránka se vykreslí přes `NuxtPage` jako v appce: rodič sekce, hlídky odchodu zapsané do záznamu
 * routy i nové namontování stránky, když se změní adresa.
 */
export async function mountPage(path: string, options: Pick<MountOptions, 'attrs'> = {}): Promise<VueWrapper> {
	await goto(path);
	const c = mountUi(NuxtPage, options);
	await flushPromises();
	return c;
}

export function currentPath(): string {
	return useNuxtApp().$router.currentRoute.value.fullPath;
}

/** Přejde na adresu — tak, jak by to udělal uživatel klikem v panelu. */
export async function goto(path: string): Promise<void> {
	await useNuxtApp().$router.push(path);
	await flushPromises();
}

/** Fokus na ikoně: `document.activeElement` pak není `HTMLElement` a nemá `blur()`. */
export function focusSvgIcon(): Element {
	const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	icon.setAttribute('tabindex', '0');
	document.body.append(icon);
	icon.focus();
	return icon;
}

export async function shortcut(key: string): Promise<KeyboardEvent> {
	const e = new KeyboardEvent('keydown', {
		metaKey: true,
		key,
		cancelable: true,
	});
	window.dispatchEvent(e);
	await flushPromises();
	return e;
}

export async function answerDialog(value: boolean): Promise<void> {
	await expect
		.poll(() => layer().find('[data-testid="dialog-confirm"]').exists(), {
			message: 'Potvrzovací dialog se neotevřel.',
		})
		.toBe(true);

	const button = layer().find(`[data-testid="dialog-${value ? 'confirm' : 'cancel'}"]`);
	if (!button.exists()) throw new Error('Žádný potvrzovací dialog není otevřený.');

	await button.trigger('click');
	await flushPromises();
	await expect
		.poll(() => layer().find('[data-testid="dialog-confirm"]').exists(), {
			message: 'Potvrzovací dialog se nezavřel.',
		})
		.toBe(false);
}

export function dialogDestructive(c: VueWrapper): boolean {
	const button = hosts
		.get(c)
		?.findAllComponents(UButton)
		.find((b) => b.attributes('data-testid') === 'dialog-confirm');
	if (!button) throw new Error('Žádný potvrzovací dialog není otevřený.');
	return button.props('color') === 'error';
}

export const CHART_TOKENS = {
	style: '--chart-bar:#2e8b57; --danger:#c4483f; --line:#101010; --line-soft:#303030; --ink:#252525; --ink-3:#6f6f6f; --card:#ffffff',
};

export const CHECKBOX = '[role="checkbox"]';

export const LISTBOX = '[role="combobox"],[aria-haspopup="listbox"]';

export function layer(): DOMWrapper<HTMLElement> {
	return new DOMWrapper(document.body);
}

export async function check(element: DOMWrapper<Element>, value = true): Promise<void> {
	if ((element.attributes('aria-checked') === 'true') !== value) await element.trigger('click');
	await flushPromises();
}

export async function pick(launcher: DOMWrapper<Element>, label: string): Promise<void> {
	await launcher.trigger('click');
	await flushPromises();

	let option: DOMWrapper<Element> | undefined;
	await vi.waitFor(
		() => {
			option = layer()
				.findAll('[role="option"]')
				.find((o) => o.text() === label);
			if (!option) throw new Error(`Nabídka zatím nemá položku „${label}".`);
		},
		{ timeout: 5_000 },
	);
	if (!option) throw new Error(`Nabídka nemá položku „${label}".`);

	await option.trigger('click');
	await option.trigger('keydown', { key: 'Enter' });
	await flushPromises();
}

export async function pickDate(launcher: DOMWrapper<Element>, target: DateString): Promise<void> {
	const from = parseDate(launcher.attributes('data-value')) ?? today();
	await launcher.trigger('click');
	await flushPromises();

	const offset = monthsBetween(periodOf(from), periodOf(target));
	const arrow = layer().find(`[data-testid="date-month-${offset < 0 ? 'prev' : 'next'}"]`);
	for (let i = 0; i < Math.abs(offset); i++) await arrow.trigger('click');

	const day = layer().find(`[data-testid="date-day-${target}"]`);
	await day.trigger('click');
	await flushPromises();
}

export async function enterDate(field: DOMWrapper<Element>, target: DateString | undefined): Promise<void> {
	if (target === undefined) {
		await field.find('[data-segment="day"]').trigger('keydown', { key: 'Backspace' });
		await field.find('[data-segment="day"]').trigger('keydown', { key: 'Backspace' });
	} else {
		const year = field.find('[data-segment="year"]');
		await year.trigger('keydown', { key: 'Backspace' });
		for (const key of String(yearOf(target))) await year.trigger('keydown', { key });
		const month = field.find('[data-segment="month"]');
		await month.trigger('keydown', { key: 'Backspace' });
		for (const key of String(monthOf(target))) await month.trigger('keydown', { key });
		const day = field.find('[data-segment="day"]');
		await day.trigger('keydown', { key: 'Backspace' });
		for (const key of String(toCalendarDate(target)!.day)) await day.trigger('keydown', { key });
	}
	await flushPromises();
}
