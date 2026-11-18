import type { Rule } from './shared/types.ts';

export const blankLineAroundMultilineStatements: Rule = {
	meta: {
		type: 'layout',
		fixable: 'whitespace',
		schema: [],
		messages: {
			missing: 'Víceřádkový příkaz odděl od sousedního prázdným řádkem.',
		},
	},
	create(context) {
		return {
			Program(program) {
				for (let index = 1; index < program.body.length; index++) {
					const previous = program.body[index - 1];
					const current = program.body[index];
					if (!previous || !current) continue;
					if (previous.type === 'ImportDeclaration' && current.type === 'ImportDeclaration') continue;
					if (
						previous.loc.start.line === previous.loc.end.line &&
						current.loc.start.line === current.loc.end.line
					)
						continue;
					// Komentář nad příkazem k němu patří, mezera jde nad něj; komentář za předchozím příkazem ne.
					const leadingComment = context.sourceCode
						.getCommentsBefore(current)
						.find((comment) => comment.loc.start.line > previous.loc.end.line);
					const first = leadingComment ?? current;
					if (first.loc.start.line - previous.loc.end.line !== 1) continue;
					context.report({
						node: current,
						messageId: 'missing',
						fix: (fixer) => fixer.insertTextBefore(first, '\n'),
					});
				}
			},
		};
	},
};
