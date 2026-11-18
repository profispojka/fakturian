// Modely mají vlastní rozhraní; limit se týká jen explicitně deklarovaných událostí.
export const maxEmits = {
	meta: {
		type: 'suggestion',
		schema: [
			{
				type: 'object',
				properties: {
					max: {
						type: 'integer',
						minimum: 0,
					},
				},
				additionalProperties: false,
			},
		],
		messages: {
			tooMany: 'Komponenta deklaruje {{count}} událostí, povoleno je maximálně {{max}}. defineModel se nepočítá.',
		},
	},
	create(context) {
		const maximum = context.options[0]?.max ?? 3;
		const events = new Set();
		const types = new Map();
		const visitedTypes = new Set();
		let declaration;

		function collectType(node) {
			if (!node || visitedTypes.has(node)) return;
			visitedTypes.add(node);

			if (node.type === 'TSTypeReference') {
				collectType(types.get(node.typeName.name));
				return;
			}

			if (node.type === 'TSInterfaceDeclaration') {
				for (const extension of node.extends) collectType(types.get(extension.expression.name));
				collectType(node.body);
				return;
			}

			if (node.type === 'TSFunctionType' || node.type === 'TSCallSignatureDeclaration') {
				collectType(node.params[0]?.typeAnnotation?.typeAnnotation);
				return;
			}

			if (node.type === 'TSUnionType' || node.type === 'TSIntersectionType') {
				for (const type of node.types) collectType(type);
				return;
			}

			if (node.type === 'TSLiteralType' && typeof node.literal.value === 'string') {
				events.add(node.literal.value);
				return;
			}

			for (const member of node.members ?? node.body ?? []) {
				if (member.type === 'TSCallSignatureDeclaration') collectType(member);
				else if (member.type === 'TSPropertySignature' || member.type === 'TSMethodSignature') {
					if (!member.computed) events.add(member.key.name ?? member.key.value);
				}
			}
		}

		function collectRuntime(node) {
			if (node?.type === 'ArrayExpression') {
				for (const element of node.elements)
					if (element?.type === 'Literal' && typeof element.value === 'string') events.add(element.value);
			} else if (node?.type === 'ObjectExpression') {
				for (const property of node.properties)
					if (property.type === 'Property' && !property.computed)
						events.add(property.key.name ?? property.key.value);
			}
		}

		return {
			Program(program) {
				for (const statement of program.body) {
					const node = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
					if (node?.type === 'TSTypeAliasDeclaration') types.set(node.id.name, node.typeAnnotation);
					else if (node?.type === 'TSInterfaceDeclaration') types.set(node.id.name, node);
				}
			},
			CallExpression(node) {
				if (node.callee.type !== 'Identifier' || node.callee.name !== 'defineEmits') return;
				declaration = node;
				collectType(node.typeArguments?.params[0]);
				collectRuntime(node.arguments[0]);
			},
			ObjectExpression(node) {
				const parent = node.parent;
				const isComponent =
					parent.type === 'ExportDefaultDeclaration' ||
					(parent.type === 'CallExpression' &&
						parent.callee.type === 'Identifier' &&
						parent.callee.name === 'defineComponent');
				if (!isComponent) return;

				const emits = node.properties.find(
					(property) =>
						property.type === 'Property' &&
						!property.computed &&
						(property.key.name ?? property.key.value) === 'emits',
				);
				if (!emits) return;
				declaration = emits;
				collectRuntime(emits.value);
			},
			'Program:exit'() {
				if (!declaration || events.size <= maximum) return;
				context.report({
					node: declaration,
					messageId: 'tooMany',
					data: {
						count: events.size,
						max: maximum,
					},
				});
			},
		};
	},
};
