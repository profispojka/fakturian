import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

import { componentPath } from '../tools/lint/oxlint-fakturian';

// `RuleTester` si `describe`/`it` bere ze statických vlastností, ne z globálů.
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({ cwd: '/repo' });

tester.run('component-path', componentPath, {
	valid: [
		{
			name: 'kořen komponent',
			code: 'const a = 1;',
			filename: '/repo/src/components/Money.vue',
		},
		{
			name: 'jedna složka',
			code: 'const a = 1;',
			filename: '/repo/src/components/invoice/PricePicker.vue',
		},
		{
			name: 'mimo komponenty',
			code: 'const a = 1;',
			filename: '/repo/src/pages/invoice/InvoiceList.vue',
		},
	],
	invalid: [
		{
			name: 'opakovaná předpona',
			code: 'const a = 1;',
			filename: '/repo/src/components/invoice/InvoicePricePicker.vue',
			errors: 1,
		},
		{
			name: 'předpona složky s pomlčkou',
			code: 'const a = 1;',
			filename: '/repo/src/components/price-list/PriceListItem.vue',
			errors: 1,
		},
		{
			name: 'dvě úrovně',
			code: 'const a = 1;',
			filename: '/repo/src/components/invoice/pdf/Preview.vue',
			errors: 1,
		},
	],
});
