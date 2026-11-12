import tailwindcss from '@tailwindcss/vite';

// Prezentační web Fakturiana. Staticky generovaný (`bun run generate`), nasazuje
// se na Vercel.
export default defineNuxtConfig({
	compatibilityDate: '2025-08-01',
	modules: ['@nuxt/content', '@nuxtjs/seo', '@nuxtjs/color-mode'],
	css: ['~/assets/css/main.css'],
	devtools: {
		enabled: false,
	},

	// Doména zatím není. Až bude, mění se **jen tahle jedna hodnota** —
	// canonical, sitemapa, OG obrázky i strukturovaná data ji berou odsud.
	site: {
		url: 'https://fakturian.cz',
		name: 'Fakturian',
		description:
			'Desktopová fakturace pro živnostníky bez cloudu. Faktury, náklady a vykázané dny na jednom místě — data zůstávají ve tvé složce.',
		defaultLocale: 'cs',
		indexable: true,
	},

	app: {
		head: {
			htmlAttrs: {
				lang: 'cs',
			},
			link: [
				{
					rel: 'icon',
					href: '/favicon.svg',
					type: 'image/svg+xml',
				},
			],
			meta: [
				{
					name: 'viewport',
					content: 'width=device-width, initial-scale=1, viewport-fit=cover',
				},
				{
					name: 'theme-color',
					content: '#2b7f4f',
				},
			],
		},
	},

	// Statický web: všechno se předrenderuje při buildu, na Vercelu pak leží
	// hotové HTML. Odkazy se procházejí, takže nová stránka se přidá sama.
	nitro: {
		prerender: {
			crawlLinks: true,
			routes: ['/', '/404.html', '/sitemap.xml', '/robots.txt', '/llms.txt'],
			failOnError: true,
		},
	},

	// Tailwind v4 běží jako Vite plugin, ne přes Nuxt modul — web nemá `@nuxt/ui`,
	// který ho v appce přináší s sebou. Tokeny a slovník tříd jsou v `main.css`.
	vite: {
		plugins: [tailwindcss()],
	},

	content: {
		build: {
			markdown: {
				toc: {
					depth: 3,
					searchDepth: 3,
				},
			},
		},
	},

	// OG obrázky kreslí Vue šablona (`app/components/OgImage/Default.satori.vue`),
	// ne ruční export.
	ogImage: {
		defaults: {
			width: 1200,
			height: 630,
		},
	},

	// Motiv vloží skript v `<head>` ještě před vykreslením, takže předrenderovaná stránka
	// tmavým režimem neprobliká. CSS čte `data-theme`.
	colorMode: {
		dataValue: 'theme',
		storageKey: 'theme',
	},

	sitemap: {
		autoLastmod: true,
	},

	robots: {
		disallow: [],
	},

	features: {
		// Web nepotřebuje inline styly v HTML — CDN cachuje CSS soubor zvlášť.
		inlineStyles: false,
	},
});
