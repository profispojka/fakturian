// Jména importů se berou z jejich bindingu, takže `useRoute as getRoute` zákaz ani výjimku neobejde.
export function importedNameOf(identifier, sourceCode) {
	for (let scope = sourceCode.getScope(identifier); scope; scope = scope.upper) {
		const variable = scope.set.get(identifier.name);
		if (!variable) continue;
		const definition = variable.defs[0];
		if (definition?.type !== 'ImportBinding' || definition.node.type !== 'ImportSpecifier') break;
		return definition.node.imported.name ?? definition.node.imported.value;
	}
	return identifier.name;
}

export const isFunction = (node) =>
	node.type === 'FunctionDeclaration' ||
	node.type === 'FunctionExpression' ||
	node.type === 'ArrowFunctionExpression';
