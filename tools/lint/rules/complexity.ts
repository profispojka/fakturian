import type { Node, Rule, AnyFunctionNode } from './shared/types.ts';

const CONDITION_HOLDERS = new Set([
	'IfStatement',
	'ConditionalExpression',
	'WhileStatement',
	'DoWhileStatement',
	'ForStatement',
]);

function isDecision(logical: Extract<Node, { type: 'LogicalExpression' }>): boolean {
	let current: Node = logical;
	while (
		current.parent &&
		((current.parent.type === 'LogicalExpression' && current.parent.operator !== '??') ||
			(current.parent.type === 'UnaryExpression' && current.parent.operator === '!'))
	)
		current = current.parent;
	if (current.parent?.type === 'ExpressionStatement') return true;
	return (
		current.parent !== null &&
		CONDITION_HOLDERS.has(current.parent.type) &&
		'test' in current.parent &&
		current.parent.test === current
	);
}

// `?.`, `??` a logické výrazy při skládání hodnot nejsou rozhodovací větve.
export const complexity: Rule = {
	meta: {
		type: 'suggestion',
		schema: [
			{
				type: 'object',
				properties: {
					max: {
						type: 'integer',
						minimum: 1,
					},
				},
				additionalProperties: false,
			},
		],
		messages: {
			tooComplex:
				'Funkce má rozhodovací složitost {{count}}, povoleno je maximálně {{max}}. Rozděl ji na menší funkce.',
		},
	},
	create(context) {
		const option: unknown = context.options[0];
		const maximum =
			typeof option === 'object' && option !== null && 'max' in option && typeof option.max === 'number'
				? option.max
				: 20;
		const counts: number[] = [];
		const enter = () => {
			counts.push(1);
		};
		const exit = (node: AnyFunctionNode) => {
			const count = counts.pop();
			if (count !== undefined && count > maximum)
				context.report({
					node,
					messageId: 'tooComplex',
					data: {
						count,
						max: maximum,
					},
				});
		};
		const branch = () => {
			const count = counts.at(-1);
			if (count !== undefined) counts[counts.length - 1] = count + 1;
		};
		return {
			FunctionDeclaration: enter,
			FunctionExpression: enter,
			ArrowFunctionExpression: enter,
			'FunctionDeclaration:exit': exit,
			'FunctionExpression:exit': exit,
			'ArrowFunctionExpression:exit': exit,
			IfStatement: branch,
			ConditionalExpression: branch,
			ForStatement: branch,
			ForInStatement: branch,
			ForOfStatement: branch,
			WhileStatement: branch,
			DoWhileStatement: branch,
			CatchClause: branch,
			SwitchCase(node) {
				if (node.test) branch();
			},
			LogicalExpression(node) {
				if (node.operator !== '??' && isDecision(node)) branch();
			},
		};
	},
};
