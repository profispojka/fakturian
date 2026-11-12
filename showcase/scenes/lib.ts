import type { Page } from 'playwright';

/**
 * Sdílené drobnosti pro scénáře.
 *
 * Kroky míří na `data-testid` z appky. Podle textu se prvek značí jen tam, kde
 * značka nerozliší konkrétní záznam — třeba řádek výběrníku.
 */
export const mark = (selector: string, text: string, name: string) => async (page: Page) => {
	await page.evaluate(
		(marker: { selector: string; text: string; name: string }) => {
			const el = [...document.querySelectorAll(marker.selector)].find((element) =>
				element.textContent?.trim().includes(marker.text),
			);
			if (!el) throw new Error(`Nenašel jsem "${marker.text}" (${marker.selector})`);
			el.setAttribute('data-shot', marker.name);
		},
		{
			selector,
			text,
			name,
		},
	);
};

/** Závěrečná karta, stejná ve všech klipech. */
export const conclusion = {
	card: {
		title: 'Tvoje data. Tvoje složka.',
		subtitle: 'Fakturian — macOS, bez cloudu.',
	},
	duration: 2,
};
