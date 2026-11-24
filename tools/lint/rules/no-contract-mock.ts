import { methodName } from './shared/ast.ts';

import type { Argument, Rule } from './shared/types.ts';

const CONTRACT_MODULE = /(^|\/)useVaultFile$|(^|\/)schemas\//;

function modulePath(node: Argument | undefined): string | undefined {
	if (!node) return undefined;
	if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
	if (node.type === 'ImportExpression' && node.source.type === 'Literal' && typeof node.source.value === 'string') {
		return node.source.value;
	}
	if (node.type === 'Identifier') return node.name;
	return undefined;
}

export const noContractMock: Rule = {
	meta: {
		docs: {
			description: 'Test nemockuje modul, jehož kontrakt hlídá — `useVaultFile` a schémata.',
		},
	},
	create(context) {
		return {
			CallExpression(node) {
				const callee = node.callee;
				const mocks =
					(callee.type === 'Identifier' && callee.name === 'mockNuxtImport') ||
					(callee.type === 'MemberExpression' &&
						callee.object.type === 'Identifier' &&
						callee.object.name === 'vi' &&
						(methodName(node) === 'mock' || methodName(node) === 'doMock'));
				if (!mocks) return;
				const path = modulePath(node.arguments[0]);
				if (path === undefined || !CONTRACT_MODULE.test(path.replace(/\.ts$/, ''))) return;
				context.report({
					message:
						`Mock \`${path}\` vypne kontrakt, který má test hlídat — schémata a \`useVaultFile\` ` +
						'běží doopravdy, stejně jako hlavní proces za mostem z `test/setup/backend.ts`.',
					node,
				});
			},
		};
	},
};
