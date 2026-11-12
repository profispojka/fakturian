import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

import { errorTextRule } from '../tools/lint/oxlint-fakturian';

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

tester.run('error-text', errorTextRule, {
	valid: [
		{
			name: 'převod přes errorText',
			code: 'try { f(); } catch (e) { g(errorText(e)); }',
		},
		{
			name: 'předání chyby dál',
			code: "try { f(); } catch (e) { status.error('Nešlo to', e); }",
		},
		{
			name: 'vyhození dál',
			code: 'try { f(); } catch (e) { throw e; }',
		},
		{
			name: 'test typu',
			code: 'try { f(); } catch (e) { if (e instanceof Error) g(); }',
		},
		{
			name: 'stejné jméno mimo catch',
			code: 'const e = 1; g(String(e));',
		},
		{
			name: 'jiná proměnná uvnitř catch',
			code: 'try { f(); } catch (e) { g(String(jina)); }',
		},
		{
			name: 'vlastní pole chyby',
			code: 'try { f(); } catch (e) { if (e.file) g(e.file); }',
		},
		{
			name: 'String nad něčím jiným',
			code: 'try { f(); } catch (e) { g(errorText(e) + String(1)); }',
		},
	],
	invalid: [
		{
			name: 'String(e)',
			code: 'try { f(); } catch (e) { g(String(e)); }',
			errors: 1,
		},
		{
			name: 'String(e) s odstraněním prefixu',
			code: "try { f(); } catch (e) { g(String(e).replace(/^Error:\\s*/, '')); }",
			errors: 1,
		},
		{
			name: 'interpolace v šabloně',
			code: `try { f(); } catch (e) { g(\`Nešlo to: $\{e}\`); }`,
			errors: 1,
		},
		{
			name: 'sáhnutí na message',
			code: 'try { f(); } catch (e) { g(e.message); }',
			errors: 1,
		},
		{
			name: 'jiné jméno proměnné',
			code: 'try { f(); } catch (err) { g(String(err)); }',
			errors: 1,
		},
		{
			name: 'zanořeno hlouběji v těle',
			code: `try { f(); } catch (e) { if (a) { for (const x of xs) g(\`$\{e}\`); } }`,
			errors: 1,
		},
		{
			name: 'uvnitř vnitřní funkce',
			code: `try { f(); } catch (e) { xs.map((x) => \`$\{e}\`); }`,
			errors: 1,
		},
	],
});
