import pluginVue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';
import vueParser from 'vue-eslint-parser';

// Oxlint pouští type-aware pravidla jen nad `.ts`, `<script>` komponent kontroluje až tady.
export default [
	{
		linterOptions: {
			noInlineConfig: true,
			reportUnusedDisableDirectives: 'error',
		},
	},
	{
		files: ['src/**/*.vue'],
		languageOptions: {
			parser: vueParser,
			parserOptions: {
				extraFileExtensions: ['.vue'],
				parser: tseslint.parser,
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
				sourceType: 'module',
			},
		},
		plugins: {
			vue: pluginVue,
			'@typescript-eslint': tseslint.plugin,
		},
		rules: {
			'vue/attributes-order': 'error',
			'vue/enforce-style-attribute': ['error', { allow: ['plain'] }],
			'vue/no-v-html': 'error',
			'vue/no-restricted-v-bind': [
				'error',
				{
					argument: 'overlay',
					element: 'UModal',
					message: 'Plachta je signál pro zkratky, že je stránka zakrytá — `UModal` ji má vždycky.',
				},
			],
			'vue/no-restricted-static-attribute': [
				'error',
				{
					key: 'data-testid',
					value: '/^(?!field-).*[^a-z0-9-]|[^a-zA-Z0-9-]/',
					message: 'Značka je kebab-case anglicky; jen za `field-` stojí jméno pole ze schématu.',
				},
			],
			'@typescript-eslint/no-floating-promises': 'error',
			'@typescript-eslint/no-misused-promises': 'error',
			'@typescript-eslint/switch-exhaustiveness-check': 'error',
			'@typescript-eslint/require-await': 'error',
			'@typescript-eslint/only-throw-error': 'error',
			'@typescript-eslint/restrict-template-expressions': 'error',
			'@typescript-eslint/restrict-plus-operands': 'error',
			'@typescript-eslint/no-deprecated': 'error',
			'@typescript-eslint/unbound-method': 'error',
			'@typescript-eslint/prefer-nullish-coalescing': [
				'error',
				{
					ignorePrimitives: {
						string: true,
					},
				},
			],
		},
	},
	{
		files: ['src/**/*.vue'],
		rules: {
			'@typescript-eslint/no-unsafe-argument': 'error',
			'@typescript-eslint/no-unsafe-assignment': 'error',
			'@typescript-eslint/no-unsafe-call': 'error',
			'@typescript-eslint/no-unsafe-member-access': 'error',
			'@typescript-eslint/no-unsafe-return': 'error',
		},
	},
];
