import type { Expression, FunctionNode, Visitor, Rule } from './shared/types.ts';

function chainRoot(node: Expression): string | undefined {
	let current = node;
	for (;;) {
		if (current.type === 'CallExpression') current = current.callee;
		else if (current.type === 'MemberExpression') current = current.object;
		else if (current.type === 'Identifier') return current.name;
		else return undefined;
	}
}

function forwardsParams(fn: FunctionNode | Parameters<NonNullable<Visitor['FunctionDeclaration']>>[0]): boolean {
	const body = fn.body;
	if (!body) return false;
	let call: Expression | undefined;
	if (body.type === 'BlockStatement') {
		if (body.body.length !== 1) return false;
		const [only] = body.body;
		if (only?.type === 'ReturnStatement' && only.argument) call = only.argument;
		else if (only?.type === 'ExpressionStatement') call = only.expression;
	} else {
		call = body;
	}
	if (call?.type === 'AwaitExpression') call = call.argument;
	if (call?.type !== 'CallExpression') return false;
	const params = fn.params;
	if (params.length !== call.arguments.length) return false;
	const names: string[] = [];
	for (const [i, param] of params.entries()) {
		const arg = call.arguments[i];
		if (param.type === 'Identifier' && arg?.type === 'Identifier' && arg.name === param.name) {
			names.push(param.name);
			continue;
		}
		if (
			param.type === 'RestElement' &&
			param.argument.type === 'Identifier' &&
			arg?.type === 'SpreadElement' &&
			arg.argument.type === 'Identifier' &&
			arg.argument.name === param.argument.name
		) {
			names.push(param.argument.name);
			continue;
		}
		return false;
	}
	const root = chainRoot(call.callee);
	return root === undefined || !names.includes(root);
}

const ALIAS_MESSAGE =
	'Funkce jen přeposílá své parametry jiné funkci — je to přezdívka bez chování i kontraktu. ' +
	'Volej původní funkci přímo.';

export const noAliasFunction: Rule = {
	meta: {
		docs: {
			description: 'Zakazuje jednořádkové obálky, které jen přejmenují jinou funkci.',
		},
	},
	create(context) {
		return {
			FunctionDeclaration(node) {
				// Přetížení přidává podpis, který původní funkce nemá — to už je kontrakt, ne přezdívka.
				const holder = node.parent.type === 'ExportNamedDeclaration' ? node.parent.parent : node.parent;
				const siblings = holder.type === 'Program' || holder.type === 'BlockStatement' ? holder.body : [];
				const overloaded = siblings.some((sibling) => {
					const declared = sibling.type === 'ExportNamedDeclaration' ? sibling.declaration : sibling;
					return declared?.type === 'TSDeclareFunction' && declared.id?.name === node.id?.name;
				});
				if (!overloaded && forwardsParams(node))
					context.report({
						message: ALIAS_MESSAGE,
						node,
					});
			},
			VariableDeclarator(node) {
				const init = node.init;
				if (init?.type !== 'ArrowFunctionExpression' && init?.type !== 'FunctionExpression') return;
				if (forwardsParams(init))
					context.report({
						message: ALIAS_MESSAGE,
						node,
					});
			},
		};
	},
};
