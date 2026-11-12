import { defineConfig } from '@playwright/test';

// Desktopová E2E sada nad Electronem: každý test pouští vlastní appku s vlastním domovem a vaultem,
// takže testy běží souběžně. Okna se ukazují bez aktivace a fokus nekradou (`e2e/app.ts`).
export default defineConfig({
	testDir: './e2e/specs',
	globalSetup: './e2e/global-setup.ts',
	outputDir: './.output-e2e/results',
	snapshotPathTemplate: '{testDir}/../visual-baselines/macos/{arg}{ext}',
	fullyParallel: true,
	forbidOnly: true,
	retries: 0,
	timeout: 120_000,
	expect: {
		timeout: 20_000,
	},
	reporter: [
		['list'],
		[
			'html',
			{
				open: 'never',
				outputFolder: './.output-e2e/report',
			},
		],
	],
});
