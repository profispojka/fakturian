import { defineNuxtPlugin } from 'nuxt/app';

import { E2E_TODAY } from './constants.ts';

export default defineNuxtPlugin(() => {
	// Bez animací stojí modál i nabídka hned v konečném stavu a snímek nechytí rozpracovaný přechod.
	const style = document.createElement('style');
	style.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
	document.head.append(style);

	// Hodiny se jen posunou, ne zastaví: `useThrottleFn` a spol. měří uplynulý čas přes `Date.now()`.
	// Poledne místního času: den se nepřeklopí, ani kdyby běh trval hodiny nebo stroj měl jinou zónu.
	const realNow = Date.now.bind(Date);
	const offset = new Date(`${E2E_TODAY}T12:00:00`).getTime() - realNow();
	Date.now = () => realNow() + offset;
});
