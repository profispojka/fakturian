import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

import { noDoubleAssertion } from '../../tools/lint/rules/no-double-assertion.ts';

RuleTester.describe = describe;
RuleTester.it = it;

new RuleTester().run('no-double-assertion', noDoubleAssertion as Parameters<RuleTester['run']>[1], {
	valid: [
		{
			name: 'jedna aserce',
			code: 'const win = fake as BaseWindow;',
			filename: 'test.ts',
		},
		{
			name: 'as const',
			code: 'const roles = ["a", "b"] as const;',
			filename: 'test.ts',
		},
		{
			name: 'aserce na unknown bez další',
			code: 'const raw = value as unknown;',
			filename: 'test.ts',
		},
	],
	invalid: [
		{
			name: 'aserce přes unknown',
			code: 'const win = { id: 1 } as unknown as BaseWindow;',
			filename: 'test.ts',
			errors: [{ messageId: 'double' }],
		},
		{
			name: 'aserce přes unknown v argumentu',
			code: 'startShell(win as unknown as BrowserWindow);',
			filename: 'test.ts',
			errors: [{ messageId: 'double' }],
		},
	],
});
