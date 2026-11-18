import type { Rule, FunctionNode, Visitor } from './shared/types.ts';

export const constantsDataOnly: Rule = {
	meta: {
		docs: {
			description: '`src/constants/` drží data, funkce patří do stejnojmenného `src/utils/`.',
		},
	},
	create(context) {
		const report = (node: FunctionNode | Parameters<NonNullable<Visitor['FunctionDeclaration']>>[0]) =>
			context.report({
				message: 'V `src/constants/` stojí jen data — funkci přesuň do stejnojmenného souboru v `src/utils/`.',
				node,
			});
		return {
			FunctionDeclaration: report,
			FunctionExpression: report,
			ArrowFunctionExpression: report,
		};
	},
};
