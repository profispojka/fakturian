import type { Rule, AnyFunctionNode } from './shared/types.ts';

export const noWrappingIf: Rule = {
	meta: {
		type: 'suggestion',
		schema: [],
		messages: {
			wrapping: 'Tělo funkce nebal do jednoho if. Obrať podmínku na včasný return a zbytek piš pod ním.',
		},
	},
	create(context) {
		const check = (node: AnyFunctionNode) => {
			if (node.parent.type === 'CallExpression' || node.parent.type === 'NewExpression') return;
			const statements = node.body?.type === 'BlockStatement' ? node.body.body : [];
			const [statement] = statements;
			if (statements.length !== 1 || statement?.type !== 'IfStatement' || statement.alternate) return;
			if (statement.consequent.type !== 'BlockStatement' || statement.consequent.body.length < 2) return;
			context.report({
				node: statement,
				messageId: 'wrapping',
			});
		};
		return {
			FunctionDeclaration: check,
			FunctionExpression: check,
			ArrowFunctionExpression: check,
		};
	},
};
