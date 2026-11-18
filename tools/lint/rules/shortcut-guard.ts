import type { Rule } from './shared/types.ts';

const OVERLAY_GUARD = `if(document.querySelector('[data-slot="overlay"]'))return;`;

export const shortcutGuard: Rule = {
	meta: {
		docs: {
			description: 'Každá zkratka má `usingInput: true` a jako první příkaz hlídá plachtu.',
		},
	},
	create(context) {
		const message =
			'Zkratka v `defineShortcuts()` musí mít `usingInput: true` a `handler`, jehož první příkaz je ' +
			'`if (document.querySelector(\'[data-slot="overlay"]\')) return;` — jinak ⌘S uloží doklad pod otevřeným dialogem.';
		return {
			CallExpression(node) {
				if (node.callee.type !== 'Identifier' || node.callee.name !== 'defineShortcuts') return;
				const [shortcuts] = node.arguments;
				if (!shortcuts || shortcuts.type !== 'ObjectExpression') return;
				for (const entry of shortcuts.properties) {
					if (entry.type !== 'Property' || entry.value.type !== 'ObjectExpression') {
						context.report({
							message,
							node: entry,
						});
						continue;
					}
					const options = entry.value.properties;
					const usingInput = options.some(
						(p) =>
							p.type === 'Property' &&
							p.key.type === 'Identifier' &&
							p.key.name === 'usingInput' &&
							p.value.type === 'Literal' &&
							p.value.value === true,
					);
					const handler = options.find(
						(p) => p.type === 'Property' && p.key.type === 'Identifier' && p.key.name === 'handler',
					);
					let guarded = false;
					if (handler?.type === 'Property') {
						const fn = handler.value;
						if (
							(fn.type === 'ArrowFunctionExpression' || fn.type === 'FunctionExpression') &&
							fn.body?.type === 'BlockStatement'
						) {
							const [first] = fn.body.body;
							guarded =
								first !== undefined &&
								context.sourceCode.getText(first).replace(/\s+/g, '') === OVERLAY_GUARD;
						}
					}
					if (!usingInput || !guarded)
						context.report({
							message,
							node: entry,
						});
				}
			},
		};
	},
};
