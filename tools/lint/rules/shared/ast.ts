import type { CallNode } from './types.ts';

export function methodName(node: CallNode): string | undefined {
	const callee = node.callee;
	if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') return callee.property.name;
	return undefined;
}
