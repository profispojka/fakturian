import { maxEmits } from './rules/max-emits.mjs';
import { noComposablesOutsideRoot } from './rules/no-composables-outside-root.mjs';
import { noConditionalInTest } from './rules/no-conditional-in-test.mjs';

export default {
	meta: {
		name: 'fakturian-guards',
	},
	rules: {
		'no-conditional-in-test': noConditionalInTest,
		'max-emits': maxEmits,
		'no-composables-outside-root': noComposablesOutsideRoot,
	},
};
