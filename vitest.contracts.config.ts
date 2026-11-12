import { defineVitestProject } from '@nuxt/test-utils/config';
import { defineConfig } from 'vitest/config';

// Proč `nuxt-state.ts` stojí až za setupem `@nuxt/test-utils`, stojí ve `vitest.nuxt.config.ts`.
const contractsProject = await defineVitestProject({
	test: {
		name: 'contracts',
		environment: 'nuxt',
		environmentOptions: {
			nuxt: {
				domEnvironment: 'happy-dom',
				// Proč jsou providery fontů vypnuté, stojí ve `vitest.nuxt.config.ts`.
				overrides: {
					fonts: {
						providers: {
							adobe: false,
							bunny: false,
							fontshare: false,
							fontsource: false,
							google: false,
							googleicons: false,
						},
					},
				},
			},
		},
		include: ['test/contracts/*.spec.ts'],
		globalSetup: ['./test/setup/timezone.ts'],
		hookTimeout: 30_000,
		testTimeout: 60_000,
	},
});

export default defineConfig({
	test: {
		allowOnly: false,
		retry: 0,
		reporters: ['default', './tools/testing/required-tests-reporter.ts'],
		passWithNoTests: false,
		sequence: {
			setupFiles: 'list',
		},
		projects: [
			{
				...contractsProject,
				test: {
					...contractsProject.test,
					setupFiles: [contractsProject.test?.setupFiles ?? [], 'test/setup/nuxt-state.ts'].flat(),
				},
			},
		],
	},
});
