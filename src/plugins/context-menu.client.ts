import { useEventListener } from '@vueuse/core';

// Vlastní context menu appka nemá, takže se zakazuje všude kromě datových polí: v inputech a nad
// `.selectable` musí zůstat systémové kopírování a vkládání.
export default defineNuxtPlugin(() => {
	useEventListener(window, 'contextmenu', (e) => {
		// Cíl nemusí být prvek (nabídka nad dokumentem) a `closest` má jen `Element`.
		let t: Element | null = null;
		if (e.target instanceof Element) t = e.target;
		if (!t?.closest('input, textarea, [contenteditable], .selectable')) {
			e.preventDefault();
		}
	});
});
