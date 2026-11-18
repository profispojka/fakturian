import { methodName } from './shared/ast.ts';

import type { Argument, Rule } from './shared/types.ts';

function isText(node: Argument): boolean {
	return (node.type === 'Literal' && typeof node.value === 'string') || node.type === 'TemplateLiteral';
}

const EXACT_MESSAGE =
	"Porovnávej celý text (`toBe`, `toEqual`, `toThrow(new Error('…'))`) — shoda na kus textu projde " +
	'i s hláškou, kterou uživatel nikdy vidět nemá.';

export const exactText: Rule = {
	meta: {
		docs: {
			description: 'Test porovnává celý text, ne jeho kus nebo vzor.',
		},
	},
	create(context) {
		return {
			CallExpression(node) {
				const method = methodName(node);
				if (method === 'toMatch') {
					context.report({
						message: EXACT_MESSAGE,
						node,
					});
					return;
				}
				if (method === 'stringMatching' || method === 'stringContaining') {
					context.report({
						message: EXACT_MESSAGE,
						node,
					});
					return;
				}
				if (method !== 'toThrow' && method !== 'toThrowError') return;
				const [expected] = node.arguments;
				if (expected && (isText(expected) || (expected.type === 'Literal' && 'regex' in expected))) {
					context.report({
						message: EXACT_MESSAGE,
						node: expected,
					});
				}
			},
		};
	},
};
