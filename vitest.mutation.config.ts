import { defineConfig } from 'vitest/config';

// Stryker umí jen `configFile`, ne výběr projektu. Kořenová `vitest.config.ts` by ke každému mutantovi
// tahala i Nuxt projekt — celý Nuxt runtime a sdílené `.nuxt`.
export default defineConfig({
	test: {
		projects: ['./vitest.unit.config.ts', './vitest.desktop.config.ts'],
	},
});
