import { methodName } from './shared/ast.ts';

import type { Rule } from './shared/types.ts';

const MESSAGE =
	'Selektor se píše celý přímo do `find()` — konstanta ho schová před `fakturian/test-id-selector` ' +
	'a čtenář ho musí dohledat.';

export const selectorLiteral: Rule = {
	meta: {
		docs: {
			description: 'Selektor v testu je napsaný celý v místě hledání, ne poskládaný z konstant.',
		},
	},
	create(context) {
		return {
			CallExpression(node) {
				const method = methodName(node);
				if (method !== 'find' && method !== 'findAll') return;
				const [first] = node.arguments;
				if (first?.type === 'Identifier' || first?.type === 'MemberExpression') {
					context.report({
						message: MESSAGE,
						node: first,
					});
					return;
				}
				if (first?.type !== 'TemplateLiteral') return;
				// Dosazená hodnota smí stát jen uvnitř uvozovek atributu (`[data-testid="row-${id}"]`).
				let quotes = 0;
				for (const [index, quasi] of first.quasis.entries()) {
					quotes += quasi.value.raw.split('"').length - 1;
					const expression = first.expressions[index];
					if (expression && quotes % 2 === 0) {
						context.report({
							message: MESSAGE,
							node: expression,
						});
					}
				}
			},
		};
	},
};
