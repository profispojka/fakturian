import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

import { submitByButton } from '../tools/lint/oxlint-fakturian';

// `RuleTester` si `describe`/`it` bere ze statických vlastností, ne z globálů.
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
	languageOptions: {
		parserOptions: {
			lang: 'ts',
		},
	},
});

tester.run('submit-by-button', submitByButton, {
	valid: [
		{
			name: 'klik na tlačítko',
			code: `await c.find('[data-testid="action-save"]').trigger('click');`,
		},
		{
			name: 'jiná událost',
			code: `await field.trigger('keydown', { key: 'Enter' });`,
		},
		{
			name: 'událost z proměnné',
			code: 'await field.trigger(event);',
		},
		{
			name: 'cizí metoda',
			code: `emit('submit');`,
		},
	],
	invalid: [
		{
			name: 'odeslání formuláře',
			code: `await c.find('[data-testid="price-form"]').trigger('submit');`,
			errors: 1,
		},
		{
			name: 'odeslání bez await',
			code: `void form.trigger('submit');`,
			errors: 1,
		},
	],
});
