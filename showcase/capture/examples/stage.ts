import type { Page } from 'playwright';

/**
 * Sdílené nastavení scény — jeden zdroj pravdy pro screenshoty i videa.
 * Zkopíruj do `showcase/stage.ts` a uprav podle své aplikace.
 */
export default {
	// Kde běží appka. Pro screenshoty používej **produkční build**
	// (`nuxt generate && npx serve`, `vite preview`, …) — dev overlay, HMR
	// bublina a pomalé chunky se jinak propíšou do obrázků.
	baseUrl: 'http://localhost:3902',

	viewport: {
		width: 1440,
		height: 900,
	},
	deviceScaleFactor: 2,
	locale: 'cs-CZ',
	timezoneId: 'Europe/Prague',

	// Stálé datum = stálé obrázky. Bez toho se ti při každém běhu mění
	// „splatnost za 3 dny" a diff v gitu je plný šumu.
	fixedTime: '2026-03-17T09:24:00+01:00',

	// Skripty injektované do každého dokumentu: mock nativní vrstvy, demo data,
	// vypnutí telemetrie. Viz harness.example.ts.
	initScripts: ['showcase/harness/demo-data.ts'],

	// Kdy je appka nafocení schopná. Nejspolehlivější je vlastní atribut,
	// který si do appky přidáš (`data-ready` na kořenu po načtení dat).
	ready: '[data-app-ready]',

	// Barva ripplu a akcentů v overlayi (ať video ladí s produktem).
	accent: '#4f7cff',

	// Vypne vlastní animace appky — pohyb ve videu obstarává kamera.
	freezeMotion: true,

	// Volitelně: co udělat po každém načtení stránky (zavřít cookie lištu,
	// odrolovat, schovat prvky, které do prezentace nepatří).
	prepare: async (page: Page) => {
		await page.addStyleTag({
			content: `
				[data-dev-only], .debug-panel { display: none !important; }
			`,
		});
	},

	// Motiv: appky s vlastním přepínačem si ho musí nastavit samy —
	// `emulateMedia` na `prefers-color-scheme` samo o sobě nestačí.
	applyTheme: async (page: Page, scheme: 'light' | 'dark') => {
		await page.evaluate((s: 'light' | 'dark') => {
			document.documentElement.classList.toggle('dark', s === 'dark');
			localStorage.setItem('theme', s);
		}, scheme);
	},
};
