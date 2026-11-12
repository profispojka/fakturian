import { FOCUS_CHANGED_EVENT } from '~/bindings';
import { systemServices } from '~/services/system';
import { isDesktop } from '~/utils/desktop';
import { errorText } from '~/utils/errors';

// Soubor puštěný mimo místo, které ho bere (Výdaje), by Chromium otevřel v okně místo appky.
function keepDroppedFile(event: DragEvent): void {
	if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
}

// Pod průhledným oknem leží vibrancy macOS, takže třída `native` vypne plochu html/body. Vzhled okna
// jde za přepínačem motivu v Nastavení, jinak by tmavý panel měl pod sebou světlé sklo.
export default defineNuxtPlugin((nuxtApp) => {
	if (!isDesktop()) return;

	document.documentElement.classList.add('native');
	window.addEventListener('dragover', keepDroppedFile);
	window.addEventListener('drop', keepDroppedFile);

	const colorMode = useColorMode();
	const toast = useToast();

	nuxtApp.hook('app:mounted', () => {
		watch(
			() => colorMode.value,
			async (mode) => {
				try {
					let theme: 'dark' | 'light' = 'light';
					if (mode === 'dark') theme = 'dark';
					await systemServices.setWindowTheme(theme);
				} catch (e) {
					toast.add({
						title: 'Nastavení vzhledu okna selhalo',
						description: errorText(e),
						color: 'error',
					});
				}
			},
			{ immediate: true },
		);

		// Okno na pozadí tlumí zvýraznění řádku (`.window-inactive` v main.css), jak to dělá macOS.
		systemServices.on(FOCUS_CHANGED_EVENT, (focused) => {
			document.documentElement.classList.toggle('window-inactive', focused === false);
		});
	});
});
