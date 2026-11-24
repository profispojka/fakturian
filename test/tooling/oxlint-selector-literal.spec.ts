import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

import { selectorLiteral } from '../../tools/lint/rules/selector-literal.ts';

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

tester.run('selector-literal', selectorLiteral, {
	valid: [
		{
			name: 'řetězec',
			code: `c.find('[data-testid="action-save"]');`,
		},
		{
			name: 'hodnota uvnitř značky',
			code: `c.find(\`[data-testid="menu-section\${to}"]\`);`,
		},
		{
			name: 'dvě hodnoty v uvozovkách',
			code: `c.find(\`[data-testid="row-\${id}"] [data-segment="\${s}"]\`);`,
		},
		{
			name: 'find nad polem',
			code: 'items.find((i) => i.id === id);',
		},
		{
			name: 'jiná metoda',
			code: 'map.get(KEY);',
		},
	],
	invalid: [
		{
			name: 'konstanta',
			code: 'c.find(LISTBOX); c.findAll(CHECKBOX);',
			errors: 2,
		},
		{
			name: 'vlastnost objektu',
			code: 'c.find(selectors.prevYear);',
			errors: 1,
		},
		{
			name: 'kus selektoru za značkou',
			code: `c.find(\`[data-testid="customer-remember"]\${CHECKBOX}\`);`,
			errors: 1,
		},
		{
			name: 'značka poskládaná mimo uvozovky',
			code: `c.findAll(\`[data-testid=\${testId}]\`);`,
			errors: 1,
		},
	],
});
