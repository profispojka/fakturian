import type { Rule } from './shared/types.ts';

export const noIife: Rule = {
	meta: {
		type: 'suggestion',
		schema: [],
		messages: {
			iife: 'Funkci nevolej hned po definici. Pojmenuj ji a zavolej zvlášť, nebo logiku přesuň do composable / utility.',
		},
	},
	create(context) {
		return {
			CallExpression(node) {
				if (node.callee.type !== 'FunctionExpression' && node.callee.type !== 'ArrowFunctionExpression') return;
				context.report({
					node,
					messageId: 'iife',
				});
			},
		};
	},
};
