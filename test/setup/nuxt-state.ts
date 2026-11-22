import { config, enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, vi } from 'vitest';

import { clearNuxtState } from '#app';

import { resetBackend } from './backend';

enableAutoUnmount(afterEach);

// Falešný čas z testu, jehož aserce spadla, by jinak přetekl do dalšího.
afterEach(() => {
	vi.useRealTimers();
});

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
	value(this: HTMLCanvasElement) {
		const noop = () => undefined;
		const gradient = { addColorStop: noop };
		// Metody, které volá kreslení ECharts (`zrender/lib/canvas`); chybějící test shodí.
		return {
			canvas: this,
			measureText: (text: string) => ({
				width: 6 * text.length,
				actualBoundingBoxAscent: 8,
				actualBoundingBoxDescent: 2,
			}),
			getLineDash: () => [],
			createLinearGradient: () => gradient,
			createRadialGradient: () => gradient,
			createPattern: () => null,
			arc: noop,
			beginPath: noop,
			bezierCurveTo: noop,
			clearRect: noop,
			clip: noop,
			closePath: noop,
			drawImage: noop,
			ellipse: noop,
			fill: noop,
			fillRect: noop,
			fillText: noop,
			lineTo: noop,
			moveTo: noop,
			quadraticCurveTo: noop,
			rect: noop,
			restore: noop,
			rotate: noop,
			save: noop,
			scale: noop,
			setLineDash: noop,
			setTransform: noop,
			stroke: noop,
			strokeText: noop,
			translate: noop,
		};
	},
	configurable: true,
});

/**
 * Graf si barvy bere z tokenů (`getPropertyValue('--chart-bar')`), jenže happy-dom vlastní proměnné
 * sbírá jen kvůli rozepsání `var()` a přes `getPropertyValue` je nevydá — vrátí prázdno.
 */
const originalComputedStyle = globalThis.getComputedStyle;

function customProperty(el: Element, name: string): string {
	for (let element: Element | null = el; element; element = element.parentElement) {
		const declaration = new RegExp(`${name}\\s*:\\s*([^;]+)`).exec(element.getAttribute('style') ?? '');
		if (declaration?.[1]) return declaration[1].trim();
	}
	return '';
}

globalThis.getComputedStyle = (el, pseudo) => {
	const style = originalComputedStyle(el, pseudo);
	const getPropertyValue = style.getPropertyValue.bind(style);
	style.getPropertyValue = (name) => (name.startsWith('--') ? customProperty(el, name) : getPropertyValue(name));
	return style;
};

beforeEach(async () => {
	config.global.plugins = [useNuxtApp().$router];
	await flushPromises();
	if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

	document.body.innerHTML = '';

	await useNuxtApp().$router.replace('/');

	clearNuxtState();
	sessionStorage.clear();
	// Přepnutí datové složky odjíždí ze stránky; happy-dom by odjel doopravdy a zahodil dokument sady.
	vi.spyOn(window.location, 'replace')
		.mockReset()
		.mockImplementation(() => undefined);
	// Nativní vrstva je jediná náhrada, kterou testy dostávají — a stav v ní (soubory, doklady, platby)
	// drží mezi testy stejně jako `useState`, takže se nuluje tady, ne v každém specu zvlášť.
	resetBackend();
});
