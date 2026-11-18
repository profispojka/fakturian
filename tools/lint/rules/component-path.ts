import { relative, dirname, basename } from 'node:path';

import type { Rule } from './shared/types.ts';

const pascal = (folder: string): string =>
	folder
		.split('-')
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join('');

export const componentPath: Rule = {
	meta: {
		docs: {
			description: 'Komponenta leží nejvýš o složku hlouběji a jméno neopakuje předponu složky.',
		},
	},
	create(context) {
		return {
			Program(node) {
				const path = relative(context.cwd, context.filename);
				const inside = relative('src/components', dirname(path));
				if (inside.startsWith('..') || inside === '') return;
				const folders = inside.split('/');
				if (folders.length > 1) {
					context.report({
						message: `\`${path}\` je pod \`src/components/\` hlouběji než o jednu složku — Nuxt by do značky vlepil obě.`,
						node,
					});
					return;
				}
				const prefix = pascal(inside);
				if (basename(path).startsWith(prefix)) {
					context.report({
						message: `\`${path}\` opakuje předponu složky — Nuxt z něj udělá \`<${prefix}${basename(path).replace(/\.\w+$/, '')}>\`.`,
						node,
					});
				}
			},
		};
	},
};
