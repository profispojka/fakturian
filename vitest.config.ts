import { defineConfig } from 'vitest/config';

/** Dvě prostředí schválně, rozdělená na projekty. */
export default defineConfig({
	test: {
		allowOnly: false,
		passWithNoTests: false,
		retry: 0,
		reporters: ['default', './tools/testing/required-tests-reporter.ts'],
		// Projekty pořadí přebírají odsud; proč na něm záleží, stojí ve `vitest.nuxt.config.ts`.
		sequence: {
			setupFiles: 'list',
		},
		projects: ['./vitest.unit.config.ts', './vitest.nuxt.config.ts', './vitest.desktop.config.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/**', 'desktop/**/*.ts'],
			exclude: [
				'src/**/*.json',
				'src/**/fixtures/**',
				'desktop/test/**',
				'desktop/examples/**',
				'desktop/**/*.d.ts',
				// Vstup Electronu jen skládá otestované moduly; bez skutečného `app` ho spouští až E2E.
				'desktop/main.ts',
			],
			reporter: ['text', 'json-summary', 'html'],
			reportsDirectory: 'coverage',
			thresholds: {
				100: true,
				perFile: true,
			},
		},
	},
});
