import { importedNameOf, isFunction } from './shared/ast.mjs';

function isComposableRoot(node, sourceCode) {
	if (node.type === 'FunctionDeclaration' && /^use[A-Z]/.test(node.id?.name ?? '')) return true;
	const { parent } = node;
	if (parent.type === 'VariableDeclarator' && parent.init === node)
		return parent.id.type === 'Identifier' && /^use[A-Z]/.test(parent.id.name);

	if (parent.type === 'CallExpression' && parent.callee.type === 'Identifier') {
		const name = importedNameOf(parent.callee, sourceCode);
		return ['defineNuxtPlugin', 'defineNuxtRouteMiddleware', 'defineComponent'].includes(name);
	}

	// Objektový plugin a Options API mají svůj kořen v metodě setup, ne v celém objektu.
	if (parent.type === 'Property' && parent.value === node && parent.key.name === 'setup') {
		const call = parent.parent.parent;
		return (
			call.type === 'CallExpression' &&
			call.callee.type === 'Identifier' &&
			['defineNuxtPlugin', 'defineComponent'].includes(importedNameOf(call.callee, sourceCode))
		);
	}

	// Inline route middleware je vstupní bod Nuxtu stejně jako defineNuxtRouteMiddleware.
	const property = parent.type === 'ArrayExpression' ? parent.parent : parent;
	if (property.type !== 'Property' || property.key.name !== 'middleware') return false;
	const call = property.parent.parent;
	return call.type === 'CallExpression' && call.callee.type === 'Identifier' && call.callee.name === 'definePageMeta';
}

export const noComposablesOutsideRoot = {
	meta: {
		type: 'suggestion',
		schema: [],
		messages: {
			outsideRoot:
				'{{name}}() volej na úrovni modulu nebo v kořeni setup, composable či Nuxt pluginu/middleware. Do handlerů a callbacků předej jeho výsledek. Výjimka: useOverlay().',
		},
	},
	create(context) {
		const filename = `/${context.filename.replaceAll('\\', '/')}`;
		if (filename.includes('/src/plugins/')) return {};
		const { sourceCode } = context;
		return {
			CallExpression(node) {
				let callee = node.callee;
				while (
					['TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression', 'TSInstantiationExpression'].includes(
						callee.type,
					)
				)
					callee = callee.expression;

				let name;
				if (callee.type === 'Identifier') name = importedNameOf(callee, sourceCode);
				else if (callee.type === 'MemberExpression') {
					name = callee.computed ? callee.property.value : callee.property.name;
				}
				if (typeof name !== 'string' || !/^use[A-Z]/.test(name) || name === 'useOverlay') return;

				const functions = sourceCode.getAncestors(node).filter(isFunction);
				if (!functions.length) return;
				if (functions.length === 1) {
					const [enclosingFunction] = functions;
					if (isComposableRoot(enclosingFunction, sourceCode)) return;
				}

				context.report({
					node,
					messageId: 'outsideRoot',
					data: {
						name,
					},
				});
			},
		};
	},
};
