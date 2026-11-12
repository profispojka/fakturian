import { CLOSE_REQUESTED_EVENT } from '~/bindings';
import { canDiscardUnsaved } from '~/composables/useForm';
import { systemServices } from '~/services/system';
import { isDesktop } from '~/utils/desktop';
import { errorText } from '~/utils/errors';

// Křížek, ⌘W i ⌘Q hlavní proces zadrží a pošle sem; okno zavře až `closeWindow`, když rozepsaná
// práce pustí.
export default defineNuxtPlugin(() => {
	if (!isDesktop()) return;

	const toast = useToast();

	async function closeIfAllowed() {
		const canClose = await canDiscardUnsaved();
		if (!canClose) return;
		try {
			await systemServices.closeWindow();
		} catch (e) {
			toast.add({
				title: 'Okno se nepodařilo zavřít',
				description: errorText(e),
				color: 'error',
			});
		}
	}

	systemServices.on(CLOSE_REQUESTED_EVENT, () => void closeIfAllowed());
});
