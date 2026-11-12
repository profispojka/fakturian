import ConfirmDialog from '~/components/ConfirmDialog.vue';

export interface ConfirmOptions {
	title: string;
	confirmLabel?: string;
	destructive?: boolean;
	/** Otázka, na jejíž odpověď už nikdo nečeká, se zavře sama a vrátí `false`. */
	signal?: AbortSignal;
}

/**
 * `destroyOnClose` je povinné: `useOverlay()` je sdílený singleton a bez něj by po každém potvrzení
 * zůstal v paměti mrtvý dialog.
 */
export async function getUserConfirmation(message: string, options: ConfirmOptions): Promise<boolean> {
	if (options.signal?.aborted) return false;
	const dialog = useOverlay().create(ConfirmDialog, { destroyOnClose: true });
	const opened = dialog.open({
		message,
		...options,
	});
	const answer: unknown = await opened.result;
	return answer === true;
}
