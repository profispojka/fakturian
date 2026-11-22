import type { Rule } from './shared/types.ts';

export const noDoubleAssertion: Rule = {
	meta: {
		type: 'problem',
		schema: [],
		messages: {
			double:
				'`as unknown as` vypne kontrolu typu úplně. Falešný objekt napiš tak, aby typu odpovídal, cizí data ověř zodem.',
		},
	},
	create(context) {
		return {
			TSAsExpression(node) {
				if (node.expression.type !== 'TSAsExpression') return;
				if (node.expression.typeAnnotation.type !== 'TSUnknownKeyword') return;
				context.report({
					node,
					messageId: 'double',
				});
			},
		};
	},
};
