import { defineConfig } from 'vitest/config';

import { createNuxtProject, desktopProject, unitProject } from './vitest.projects.ts';

const nuxtProject = await createNuxtProject();

/** Dvě prostředí schválně, rozdělená na projekty. */
export default defineConfig({
	test: {
		allowOnly: false,
		passWithNoTests: false,
		retry: 0,
		reporters: ['default', './tools/testing/required-tests-reporter.ts'],
		// Pořadí projektů a jejich přípravných souborů musí zůstat stabilní.
		sequence: {
			setupFiles: 'list',
		},
		projects: [unitProject, nuxtProject, desktopProject],
		coverage: {
			provider: 'v8',
			include: ['src/**', 'desktop/**/*.ts'],
			exclude: [
				'src/**/*.json',
				'desktop/test/**',
				'desktop/examples/**',
				'desktop/**/*.d.ts',
				// Vstup Electronu jen skládá otestované moduly; bez skutečného `app` ho spouští až E2E.
				'desktop/main.ts',
				// Vstup podprocesu PDF běží v jiném procesu než test; jeho práci (`runPdfTask`) testy volají přímo.
				'desktop/process.ts',
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
