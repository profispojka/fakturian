import { defineConfig } from 'vitest/config';

import { desktopProject, unitProject } from './vitest.projects.ts';

// Stryker umí jen `configFile`, ne výběr projektu. Kořenová `vitest.config.ts` by ke každému mutantovi
// tahala i Nuxt projekt — celý Nuxt runtime a sdílené `.nuxt`.
export default defineConfig({
	test: {
		projects: [unitProject, desktopProject],
	},
});
