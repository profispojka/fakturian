import type { Comment, Rule } from './shared/types.ts';

const DIRECTIVE = /^\s*(?:Stryker |@vitest-environment )/;

const BANNER = /^[\s*]*[─━═=\-–—#~_]{2,}/;

const TEST_CALL = /^(?:it|test|describe)(?:\.|\(|$)/;

function contentLines(comment: Comment): number {
	if (comment.type !== 'Block') return 1;
	const lines = comment.value.split('\n').map((line) => line.replace(/^\s*\*?\s?/, '').trim());
	return lines.filter((line, i) => line !== '' || (i > 0 && i < lines.length - 1)).length;
}

export const commentStyle: Rule = {
	meta: {
		docs: {
			description: 'Komentář je výjimka: nejvýš dva řádky, bez banerů, úvodu modulu a popisu testu.',
		},
	},
	create(context) {
		const code = context.sourceCode;
		const lineOf = (offset: number): number => code.getLocFromIndex(offset).line;
		return {
			Program(program) {
				const comments = program.comments.filter((c) => c.type !== 'Shebang' && !DIRECTIVE.test(c.value));
				const [first] = program.body;
				// Komentář za kódem na řádku k souvislému textu nad ním nepatří.
				const standalone = (c: Comment): boolean => {
					const lineStart = code.lineStartIndices[lineOf(c.start) - 1] ?? 0;
					return code.text.slice(lineStart, c.start).trim() === '';
				};

				const groups: Comment[][] = [];
				for (const comment of comments) {
					const group = groups.at(-1);
					const last = group?.at(-1);
					const continues =
						group &&
						last &&
						standalone(comment) &&
						standalone(last) &&
						lineOf(comment.start) === lineOf(last.end) + 1;
					if (continues) group.push(comment);
					else groups.push([comment]);
				}

				for (const group of groups) {
					const [head] = group;
					const tail = group.at(-1);
					if (!head || !tail) continue;
					const loc = {
						start: code.getLocFromIndex(head.start),
						end: code.getLocFromIndex(tail.end),
					};
					const lines = group.reduce((sum, c) => sum + contentLines(c), 0);
					if (lines > 2) {
						context.report({
							message: `Komentář má ${lines} řádky — nejvýš dva. Proč patří do dvou řádků, výklad do \`docs/\`.`,
							loc,
						});
					}
					if (group.some((c) => c.value.split('\n').some((line) => BANNER.test(line)))) {
						context.report({
							message: 'Dekorativní baner do kódu nepatří — oddíl nese jméno funkce nebo soubor.',
							loc,
						});
					}
					if (first && tail.end <= first.start) {
						const attached =
							first.type !== 'ImportDeclaration' && lineOf(first.start) === lineOf(tail.end) + 1;
						if (!attached) {
							context.report({
								message: 'Úvod modulu nepiš — co soubor dělá, říká jeho jméno a obsah.',
								loc,
							});
						}
					}
				}
			},
			ExpressionStatement(node) {
				const expression = node.expression;
				if (expression.type !== 'CallExpression') return;
				if (!TEST_CALL.test(code.getText(expression.callee))) return;
				const before = code.getCommentsBefore(node).at(-1);
				if (before && lineOf(before.end) === lineOf(node.start) - 1) {
					context.report({
						message: 'Komentář nad testem nepiš — co test hlídá, říká jeho název.',
						loc: {
							start: code.getLocFromIndex(before.start),
							end: code.getLocFromIndex(before.end),
						},
					});
				}
			},
		};
	},
};
