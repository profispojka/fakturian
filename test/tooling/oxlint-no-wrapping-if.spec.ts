import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

import { noWrappingIf } from '../../tools/lint/rules/no-wrapping-if.ts';

RuleTester.describe = describe;
RuleTester.it = it;

new RuleTester().run('no-wrapping-if', noWrappingIf, {
	valid: [
		{
			name: 'včasný return a zbytek pod ním',
			code: 'function save(model) { if (!model) return; send(model); }',
		},
		{
			name: 'větvení s else',
			code: 'const label = (done) => { if (done) { return "Hotovo"; } else { return "Rozpracováno"; } };',
		},
		{
			name: 'arrow funkce s výrazem místo těla',
			code: 'const isEmpty = (items) => items.length === 0;',
		},
		{
			name: 'callback předaný do volání',
			code: 'onMounted(() => { if (route.query.loggedOut) { toast.add(message); router.replace(path); } });',
		},
		{
			name: 'stráž s jedním příkazem',
			code: 'const onChange = (value) => { if (value) apply(value); };',
		},
		{
			name: 'stráž s jedním příkazem v bloku',
			code: 'function guard(host) { if (!allowed(host)) { throw createError({ status: 404 }); } }',
		},
	],
	invalid: [
		{
			name: 'if obalující celé tělo deklarace',
			code: 'function create(model) { if (model.gid) { send(model); notify(); } }',
			errors: [{ messageId: 'wrapping' }],
		},
		{
			name: 'if obalující celé tělo arrow funkce',
			code: 'const onChange = (value) => { if (value) { apply(value); log(value); } };',
			errors: [{ messageId: 'wrapping' }],
		},
		{
			name: 'if obalující celé tělo metody',
			code: 'const services = { save(model) { if (model) { send(model); notify(); } } };',
			errors: [{ messageId: 'wrapping' }],
		},
	],
});
