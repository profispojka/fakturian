import type { Rule } from './shared/types.ts';

export const noDelete: Rule = {
	meta: {
		type: 'suggestion',
		schema: [],
		messages: {
			forbidden: 'Operátor delete nepoužívej. Nepotřebná pole vynech destrukturalizací přímo v místě použití.',
		},
	},
	create(context) {
		return {
			UnaryExpression(node) {
				if (node.operator !== 'delete') return;
				context.report({
					node,
					messageId: 'forbidden',
				});
			},
		};
	},
};
