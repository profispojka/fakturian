import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

import { testIdSelector } from '../tools/lint/oxlint-fakturian';

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

tester.run('test-id-selector', testIdSelector, {
	valid: [
		{
			name: 'značka',
			code: `c.find('[data-testid="action-save"]');`,
		},
		{
			name: 'předpona značky',
			code: `c.findAll('[data-testid^="menu-section"]');`,
		},
		{
			name: 'složená značka',
			code: `c.find(\`[data-testid="menu-section\${to}"]\`);`,
		},
		{
			name: 'pole formuláře',
			code: `c.find('[name="address.zip"]');`,
		},
		{
			name: 'konstanta ze setupu',
			code: 'c.find(LISTBOX); c.findAll(CHECKBOX);',
		},
		{
			name: 'řádek nabídky',
			code: `layer().findAll('[role="option"]');`,
		},
		{
			name: 'skupina palety',
			code: `c.findAll('[role="group"]'); c.find('[data-slot="label"]');`,
		},
		{
			name: 'akce UError',
			code: `c.find('[data-slot="links"] button');`,
		},
		{
			name: 'křížek UModal',
			code: `layer().find('button[aria-label="Zavřít"]');`,
		},
		{
			name: 'find nad polem',
			code: 'items.find((i) => i.id === id);',
		},
		{
			name: 'celý seznam',
			code: `c.findAll('[data-testid="item"]').map((i) => i.text());`,
		},
		{
			name: 'index nad jiným polem',
			code: 'rows[0]; rows.at(-1);',
		},
	],
	invalid: [
		{
			name: 'třída ze stylu',
			code: `c.find('.page-header');`,
			errors: 1,
		},
		{
			name: 'element',
			code: `c.find('form').trigger('submit');`,
			errors: 1,
		},
		{
			name: 'ikona',
			code: `c.find('[class~="i-lucide:tag"]');`,
			errors: 1,
		},
		{
			name: 'šablona bez značky',
			code: `c.findAll(\`button.\${kind}\`);`,
			errors: 1,
		},
		{
			name: 'index v poli',
			code: `c.findAll('[data-testid="item"]')[1];`,
			errors: 1,
		},
		{
			name: 'index přes at',
			code: `c.findAll('[data-testid="item"]').at(-1);`,
			errors: 1,
		},
	],
});
