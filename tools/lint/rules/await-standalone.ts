import type { Rule } from './shared/types.ts';

// Závorky se tu neřeší: AST, které oxlint podává pluginu, je nedrží — rodičem `await`u v `!(await f())`
// je rovnou `UnaryExpression`.
const STANDALONE = new Set(['ExpressionStatement', 'VariableDeclarator']);

const MESSAGE =
	'`await` nesmí být uvnitř jiného výrazu — přiřaď výsledek do konstanty a tu použij. ' +
	'Místo `if (!(await mohuZahodit()))` napiš `const lzeZahodit = await mohuZahodit();` a pak `if (!lzeZahodit)`.';

export const awaitStandalone: Rule = {
	meta: {
		docs: {
			description: 'Vyžaduje, aby `await` stál samostatně, ne vnořený v jiném výrazu.',
		},
	},
	create(context) {
		return {
			AwaitExpression(node) {
				const parent = node.parent;
				if (STANDALONE.has(parent.type)) return;
				if (parent.type === 'AssignmentExpression' && parent.parent.type === 'ExpressionStatement') return;
				context.report({
					message: MESSAGE,
					node,
				});
			},
		};
	},
};
