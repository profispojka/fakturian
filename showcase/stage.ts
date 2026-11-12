import type { Page } from 'playwright';

/**
 * Sdílené nastavení focení a natáčení Fakturiana.
 *
 * Všechny cesty jsou relativní k adresáři `showcase/` — capture skripty se
 * pouštějí odsud, aby appka zůstala bez dalších závislostí.
 *
 * Předpoklad: appka je sestavená (`bun run generate` v kořeni repa) a běží
 * statický server:
 *
 *   bun run serve:app     # = node capture/serve.ts --dir ../.output/public
 */
export default {
	baseUrl: 'http://127.0.0.1:3902',

	// Okno desktopové appky. 1440×900 je poměr, ve kterém appka reálně běží
	// na MacBooku a ve kterém vypadá plná, ne roztažená.
	viewport: {
		width: 1440,
		height: 900,
	},
	deviceScaleFactor: 2,
	locale: 'cs-CZ',
	timezoneId: 'Europe/Prague',

	// Demo data končí dobropisem z 12. a vrácenou platbou ze 14. srpna 2026; „dnes" je pár dní po
	// nich, aby byly vidět faktury po splatnosti i faktura ještě v termínu.
	fixedTime: '2026-08-18T10:24:00+02:00',

	// Náhradní nativní vrstva — bez ní appka v prohlížeči nemá odkud vzít data.
	initScripts: ['harness/demo-data.ts'],

	// Avatar dodavatele panel vykreslí, až když je načtený dodavatel z vaultu —
	// tedy až když appka opravdu má data, ne jen vykreslený skelet.
	ready: '[data-testid="menu-avatar"]',

	accent: '#3d5afe',
	freezeMotion: true,

	prepare: async (page: Page) => {
		await page.addStyleTag({
			content: `
				/* Appka počítá s vibrancy oknem macOS; v prohlížeči by pod panelem
				   prosvítalo prázdno. Na screenshotu chceme plnou plochu. */
				html.native { background: var(--bg-solid, #f4f4f4) !important; }
				/* Pruh „tohle je desktopová appka" se v demu neobjeví (harness
				   nativní vrstvu dodá), ale kdyby ano, do obrázku nepatří. */
				[data-testid="start-note"], [data-testid="start-error"] { display: none !important; }
			`,
		});
	},

	// Motiv drží @nuxtjs/color-mode: třída na <html> a klíč v localStorage.
	applyTheme: async (page: Page, scheme: 'light' | 'dark') => {
		await page.evaluate((s: 'light' | 'dark') => {
			localStorage.setItem('nuxt-color-mode', s);
			document.documentElement.classList.toggle('dark', s === 'dark');
			document.documentElement.classList.toggle('light', s !== 'dark');
			document.documentElement.style.colorScheme = s;
		}, scheme);
	},
};
