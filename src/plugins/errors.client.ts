import { useEventListener } from '@vueuse/core';

import { errorText } from '~/utils/errors';

// Chyba, kterou nikdo nechytil, by skončila jen v konzoli — tu uživatel nevidí a akce by prostě
// potichu nic neudělala.
export default defineNuxtPlugin((nuxtApp) => {
	const toast = useToast();

	function report(cause: unknown) {
		toast.add({
			title: 'Něco se nepovedlo',
			description: errorText(cause),
			color: 'error',
		});
	}

	nuxtApp.hook('vue:error', (cause) => {
		report(cause);
	});

	useEventListener(window, 'unhandledrejection', (event) => {
		report(event.reason);
	});
});
