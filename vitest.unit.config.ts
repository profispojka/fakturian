import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			'~': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	test: {
		name: 'unit',
		environment: 'node',
		include: ['test/*.spec.ts'],
		globalSetup: ['./test/setup/timezone.ts'],
		setupFiles: ['./test/setup/properties.ts'],
		restoreMocks: true,
		allowOnly: false,
		passWithNoTests: false,
	},
});
