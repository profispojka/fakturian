import { methodName } from './shared/ast.ts';

import type { Rule } from './shared/types.ts';

export const submitByButton: Rule = {
	meta: {
		docs: {
			description: 'Formulář se v testu odesílá klikem na tlačítko, ne událostí `submit`.',
		},
	},
	create(context) {
		return {
			CallExpression(node) {
				const [event] = node.arguments;
				if (methodName(node) !== 'trigger' || event?.type !== 'Literal' || event.value !== 'submit') return;
				context.report({
					message:
						"`trigger('submit')` projde i se zakázaným nebo chybějícím tlačítkem. Klikni na tlačítko " +
						"„Uložit“ přes jeho `data-testid` (`trigger('click')`).",
					node,
				});
			},
		};
	},
};
