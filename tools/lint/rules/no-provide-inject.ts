import type { Rule } from './shared/types.ts';

export const noProvideInject: Rule = {
	meta: {
		type: 'problem',
		schema: [],
		messages: {
			forbidden: '`{{name}}` nepoužívej. Kontext komponent předávej přes props, model a události.',
		},
	},
	create(context) {
		const names = new Set(['inject', 'provide']);
		return {
			ImportSpecifier(node) {
				if (
					node.parent.type !== 'ImportDeclaration' ||
					node.parent.source.value !== 'vue' ||
					node.importKind === 'type'
				)
					return;
				const name = node.imported.type === 'Identifier' ? node.imported.name : node.imported.value;
				if (names.has(name))
					context.report({
						node,
						messageId: 'forbidden',
						data: {
							name,
						},
					});
			},
			CallExpression(node) {
				const callee = node.callee;
				let name: string | undefined;
				if (callee.type === 'Identifier') name = callee.name;
				else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier')
					name = callee.property.name;
				if (name && names.has(name))
					context.report({
						node,
						messageId: 'forbidden',
						data: {
							name,
						},
					});
			},
		};
	},
};
