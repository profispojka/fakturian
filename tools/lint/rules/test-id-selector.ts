import { methodName } from './shared/ast.ts';

import type { Argument, Expression, Rule } from './shared/types.ts';

const NUXT_UI_SELECTORS = new Set([
	'[role="option"]',
	'[role="group"]',
	'[data-slot="label"]',
	'[data-slot="links"] button',
	'button[aria-label="Zavřít"]',
	'button[aria-label="Předchozí rok"]',
	'button[aria-label="Další rok"]',
]);

const FORM_FIELD = /^\[name="[^"]+"\]$/;

function selectorOf(node: Argument): string | undefined {
	if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
	if (node.type === 'TemplateLiteral') return node.quasis[0]?.value.cooked ?? '';
	return undefined;
}

function isFindAll(node: Expression): boolean {
	return node.type === 'CallExpression' && methodName(node) === 'findAll';
}

export const testIdSelector: Rule = {
	meta: {
		docs: {
			description: 'Prvek se v testu hledá přes `data-testid`, ne podle třídy, textu ani pořadí.',
		},
	},
	create(context) {
		return {
			CallExpression(node) {
				const method = methodName(node);
				if (method === 'find' || method === 'findAll') {
					const [first] = node.arguments;
					if (!first) return;
					const selector = selectorOf(first);
					if (selector === undefined) return;
					if (
						selector.startsWith('[data-testid') ||
						NUXT_UI_SELECTORS.has(selector) ||
						FORM_FIELD.test(selector)
					) {
						return;
					}
					context.report({
						message:
							`Selektor \`${selector}\` nehledá přes \`data-testid\`. Doplň značku do šablony ` +
							'(skill `test-ids`); vnitřek Nuxt UI jen přes povolenou roli nebo slot.',
						node: first,
					});
					return;
				}
				if (method === 'at' && node.callee.type === 'MemberExpression' && isFindAll(node.callee.object)) {
					context.report({
						message: INDEX_MESSAGE,
						node,
					});
				}
			},
			MemberExpression(node) {
				if (node.computed && node.property.type === 'Literal' && isFindAll(node.object)) {
					context.report({
						message: INDEX_MESSAGE,
						node,
					});
				}
			},
		};
	},
};

const INDEX_MESSAGE =
	'Prvek se nevybírá pořadím ve `findAll()` — posun šablony vybere jiný. Dej opakovanému prvku ' +
	'složenou značku, nebo porovnej celý seznam (`.map(…)` a `toEqual`).';
