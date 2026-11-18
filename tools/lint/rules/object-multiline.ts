import type { Rule } from './shared/types.ts';

// oxfmt vynutit rozbalení neumí; při `objectWrap: preserve` ale nechá objekt rozbalený, jakmile za `{` stojí
// nový řádek. Oprava ho proto jen vloží a vlastnosti na řádky rozhodí formátovač.
export const objectMultiline: Rule = {
	meta: {
		docs: {
			description:
				'Objekt má každou vlastnost na vlastním řádku; jedna vlastnost smí na řádek, když objekt není uvnitř jiného.',
		},
		fixable: 'whitespace',
	},
	create(context) {
		return {
			ObjectExpression(node) {
				const [first] = node.properties;
				if (!first || first.loc.start.line !== node.loc.start.line) return;
				const nested = node.parent.type === 'Property' && node.parent.parent.type === 'ObjectExpression';
				if (node.properties.length === 1 && !nested) return;
				context.report({
					message: 'Rozepiš objekt — každá vlastnost na vlastní řádek.',
					node,
					fix: (fixer) => fixer.insertTextBeforeRange([first.start, first.start], '\n'),
				});
			},
		};
	},
};
