import type { Rule } from './shared/types.ts';

const ERROR_TEXT_MESSAGE =
	'Odchycenou chybu nepřeváděj na text ručně — použij `errorText(e)` z `~/utils/errors`. ' +
	'`String(e)` nechá na hlášce `Error:` a ze `ZodError` udělá víceřádkový JSON.';

export const errorTextRule: Rule = {
	meta: {
		docs: {
			description: 'Odchycená chyba se na text převádí jedině přes `errorText()`.',
		},
	},
	create(context) {
		return {
			Identifier(node) {
				const parent = node.parent;
				const stringified =
					(parent.type === 'CallExpression' &&
						parent.callee.type === 'Identifier' &&
						parent.callee.name === 'String') ||
					parent.type === 'TemplateLiteral' ||
					(parent.type === 'MemberExpression' &&
						parent.object === node &&
						parent.property.type === 'Identifier' &&
						parent.property.name === 'message');
				if (!stringified) return;
				// `typeof`, ať se do proměnné vejde každý uzel cestou nahoru, ne jen tvar, na který se `parent`
				// zúžil o řádek výš.
				let scope: typeof node.parent = parent;
				while (scope.type !== 'Program') {
					if (
						scope.type === 'CatchClause' &&
						scope.param?.type === 'Identifier' &&
						scope.param.name === node.name
					) {
						context.report({
							message: ERROR_TEXT_MESSAGE,
							node,
						});
						return;
					}
					scope = scope.parent;
				}
			},
		};
	},
};
