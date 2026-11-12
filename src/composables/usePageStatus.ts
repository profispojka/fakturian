import { errorText } from '~/utils/errors';

type PageStatusTone = 'info' | 'success';

export interface PageStatus {
	tone: PageStatusTone;
	text: string;
}

export function usePageStatus() {
	const message = ref<PageStatus | null>(null);
	const toast = useToast();

	function show(tone: PageStatusTone, text: string) {
		message.value = {
			tone,
			text,
		};
	}

	// Chyba jde do toastu, ne do lišty: tam by visela, dokud ji nepřebije další akce. Starší „Uloženo"
	// zmizí, aby lišta vedle chyby netvrdila, že je hotovo.
	function error(title: string, cause?: unknown) {
		message.value = null;
		if (cause === undefined) {
			toast.add({
				title,
				color: 'error',
			});
			return;
		}
		toast.add({
			title,
			description: errorText(cause),
			color: 'error',
		});
	}

	function clear() {
		message.value = null;
	}

	return {
		message,
		show,
		error,
		clear,
	};
}
