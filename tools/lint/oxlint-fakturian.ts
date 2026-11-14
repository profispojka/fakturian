import { basename, dirname, relative } from 'node:path';

import type { RuleTester } from 'oxlint/plugins-dev';

type Rule = Parameters<InstanceType<typeof RuleTester>['run']>[1];
type Visitor = ReturnType<NonNullable<Rule['create']>>;
type CallNode = Parameters<NonNullable<Visitor['CallExpression']>>[0];
type ProgramNode = Parameters<NonNullable<Visitor['Program']>>[0];
type Expression = CallNode['callee'];
type Argument = CallNode['arguments'][number];
type FunctionNode = Parameters<NonNullable<Visitor['ArrowFunctionExpression']>>[0];
type Comment = ProgramNode['comments'][number];

// Závorky se tu neřeší: AST, které oxlint podává pluginu, je nedrží — rodičem `await`u v `!(await f())`
// je rovnou `UnaryExpression`.
const STANDALONE = new Set(['ExpressionStatement', 'VariableDeclarator']);

const MESSAGE =
	'`await` nesmí být uvnitř jiného výrazu — přiřaď výsledek do konstanty a tu použij. ' +
	'Místo `if (!(await mohuZahodit()))` napiš `const lzeZahodit = await mohuZahodit();` a pak `if (!lzeZahodit)`.';

export const awaitStandalone: Rule = {
	meta: {
		docs: {
			description: 'Vyžaduje, aby `await` stál samostatně, ne vnořený v jiném výrazu.',
		},
	},
	create(context) {
		return {
			AwaitExpression(node) {
				const parent = node.parent;
				if (STANDALONE.has(parent.type)) return;
				if (parent.type === 'AssignmentExpression' && parent.parent.type === 'ExpressionStatement') return;
				context.report({
					message: MESSAGE,
					node,
				});
			},
		};
	},
};

const ERROR_TEXT_MESSAGE =
	'Odchycenou chybu nepřeváděj na text ručně — použij `errorText(e)` z `~/utils/errors`. ' +
	'`String(e)` nechá na hlášce `Error:` a ze `ZodError` udělá víceřádkový JSON.';

export const errorTextRule: Rule = {
	meta: {
		docs: {
			description: 'Odchycená chyba se na text převádí jedině přes `errorText()`.',
		},
	},
	create(context) {
		return {
			Identifier(node) {
				const parent = node.parent;
				const stringified =
					(parent.type === 'CallExpression' &&
						parent.callee.type === 'Identifier' &&
						parent.callee.name === 'String') ||
					parent.type === 'TemplateLiteral' ||
					(parent.type === 'MemberExpression' &&
						parent.object === node &&
						parent.property.type === 'Identifier' &&
						parent.property.name === 'message');
				if (!stringified) return;
				// `typeof`, ať se do proměnné vejde každý uzel cestou nahoru, ne jen tvar, na který se `parent`
				// zúžil o řádek výš.
				let scope: typeof node.parent = parent;
				while (scope.type !== 'Program') {
					if (
						scope.type === 'CatchClause' &&
						scope.param?.type === 'Identifier' &&
						scope.param.name === node.name
					) {
						context.report({
							message: ERROR_TEXT_MESSAGE,
							node,
						});
						return;
					}
					scope = scope.parent;
				}
			},
		};
	},
};

function methodName(node: CallNode): string | undefined {
	const callee = node.callee;
	if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') return callee.property.name;
	return undefined;
}

function chainRoot(node: Expression): string | undefined {
	let current = node;
	for (;;) {
		if (current.type === 'CallExpression') current = current.callee;
		else if (current.type === 'MemberExpression') current = current.object;
		else if (current.type === 'Identifier') return current.name;
		else return undefined;
	}
}

function isText(node: Argument): boolean {
	return (node.type === 'Literal' && typeof node.value === 'string') || node.type === 'TemplateLiteral';
}

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

const NUXT_UI_SELECTORS = new Set([
	'[role="option"]',
	'[role="group"]',
	'[data-slot="label"]',
	'[data-slot="links"] button',
	'button[aria-label="Zavřít"]',
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

export const submitByButton: Rule = {
	meta: {
		docs: {
			description: 'Formulář se v testu odesílá klikem na tlačítko, ne událostí `submit`.',
		},
	},
	create(context) {
		return {
			CallExpression(node) {
				const [event] = node.arguments;
				if (methodName(node) !== 'trigger' || event?.type !== 'Literal' || event.value !== 'submit') return;
				context.report({
					message:
						"`trigger('submit')` projde i se zakázaným nebo chybějícím tlačítkem. Klikni na tlačítko " +
						"„Uložit“ přes jeho `data-testid` (`trigger('click')`).",
					node,
				});
			},
		};
	},
};

const INDEX_MESSAGE =
	'Prvek se nevybírá pořadím ve `findAll()` — posun šablony vybere jiný. Dej opakovanému prvku ' +
	'složenou značku, nebo porovnej celý seznam (`.map(…)` a `toEqual`).';

export const constantsDataOnly: Rule = {
	meta: {
		docs: {
			description: '`src/constants/` drží data, funkce patří do stejnojmenného `src/utils/`.',
		},
	},
	create(context) {
		const report = (node: FunctionNode | Parameters<NonNullable<Visitor['FunctionDeclaration']>>[0]) =>
			context.report({
				message: 'V `src/constants/` stojí jen data — funkci přesuň do stejnojmenného souboru v `src/utils/`.',
				node,
			});
		return {
			FunctionDeclaration: report,
			FunctionExpression: report,
			ArrowFunctionExpression: report,
		};
	},
};

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
						'běží doopravdy, okraj appky hraje falešný backend z `test/setup/backend.ts`.',
					node,
				});
			},
		};
	},
};

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

function forwardsParams(fn: FunctionNode | Parameters<NonNullable<Visitor['FunctionDeclaration']>>[0]): boolean {
	const body = fn.body;
	if (!body) return false;
	let call: Expression | undefined;
	if (body.type === 'BlockStatement') {
		if (body.body.length !== 1) return false;
		const [only] = body.body;
		if (only?.type === 'ReturnStatement' && only.argument) call = only.argument;
		else if (only?.type === 'ExpressionStatement') call = only.expression;
	} else {
		call = body;
	}
	if (call?.type === 'AwaitExpression') call = call.argument;
	if (call?.type !== 'CallExpression') return false;
	const params = fn.params;
	if (params.length !== call.arguments.length) return false;
	const names: string[] = [];
	for (const [i, param] of params.entries()) {
		const arg = call.arguments[i];
		if (param.type === 'Identifier' && arg?.type === 'Identifier' && arg.name === param.name) {
			names.push(param.name);
			continue;
		}
		if (
			param.type === 'RestElement' &&
			param.argument.type === 'Identifier' &&
			arg?.type === 'SpreadElement' &&
			arg.argument.type === 'Identifier' &&
			arg.argument.name === param.argument.name
		) {
			names.push(param.argument.name);
			continue;
		}
		return false;
	}
	const root = chainRoot(call.callee);
	return root === undefined || !names.includes(root);
}

const ALIAS_MESSAGE =
	'Funkce jen přeposílá své parametry jiné funkci — je to přezdívka bez chování i kontraktu. ' +
	'Volej původní funkci přímo.';

export const noAliasFunction: Rule = {
	meta: {
		docs: {
			description: 'Zakazuje jednořádkové obálky, které jen přejmenují jinou funkci.',
		},
	},
	create(context) {
		return {
			FunctionDeclaration(node) {
				// Přetížení přidává podpis, který původní funkce nemá — to už je kontrakt, ne přezdívka.
				const holder = node.parent.type === 'ExportNamedDeclaration' ? node.parent.parent : node.parent;
				const siblings = holder.type === 'Program' || holder.type === 'BlockStatement' ? holder.body : [];
				const overloaded = siblings.some((sibling) => {
					const declared = sibling.type === 'ExportNamedDeclaration' ? sibling.declaration : sibling;
					return declared?.type === 'TSDeclareFunction' && declared.id?.name === node.id?.name;
				});
				if (!overloaded && forwardsParams(node))
					context.report({
						message: ALIAS_MESSAGE,
						node,
					});
			},
			VariableDeclarator(node) {
				const init = node.init;
				if (init?.type !== 'ArrowFunctionExpression' && init?.type !== 'FunctionExpression') return;
				if (forwardsParams(init))
					context.report({
						message: ALIAS_MESSAGE,
						node,
					});
			},
		};
	},
};

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

const EXACT_MESSAGE =
	"Porovnávej celý text (`toBe`, `toEqual`, `toThrow(new Error('…'))`) — shoda na kus textu projde " +
	'i s hláškou, kterou uživatel nikdy vidět nemá.';

export const exactText: Rule = {
	meta: {
		docs: {
			description: 'Test porovnává celý text, ne jeho kus nebo vzor.',
		},
	},
	create(context) {
		return {
			CallExpression(node) {
				const method = methodName(node);
				if (method === 'toMatch') {
					context.report({
						message: EXACT_MESSAGE,
						node,
					});
					return;
				}
				if (method === 'stringMatching' || method === 'stringContaining') {
					context.report({
						message: EXACT_MESSAGE,
						node,
					});
					return;
				}
				if (method !== 'toThrow' && method !== 'toThrowError') return;
				const [expected] = node.arguments;
				if (expected && (isText(expected) || (expected.type === 'Literal' && 'regex' in expected))) {
					context.report({
						message: EXACT_MESSAGE,
						node: expected,
					});
				}
			},
		};
	},
};

// oxfmt vynutit rozbalení neumí; při `objectWrap: preserve` ale nechá objekt rozbalený, jakmile za `{` stojí
// nový řádek. Oprava ho proto jen vloží a vlastnosti na řádky rozhodí formátovač.
export const objectMultiline: Rule = {
	meta: {
		docs: {
			description:
				'Objekt má každou vlastnost na vlastním řádku; jedna vlastnost smí na řádek, když objekt není uvnitř jiného.',
		},
		fixable: 'whitespace',
	},
	create(context) {
		return {
			ObjectExpression(node) {
				const [first] = node.properties;
				if (!first || first.loc.start.line !== node.loc.start.line) return;
				const nested = node.parent.type === 'Property' && node.parent.parent.type === 'ObjectExpression';
				if (node.properties.length === 1 && !nested) return;
				context.report({
					message: 'Rozepiš objekt — každá vlastnost na vlastní řádek.',
					node,
					fix: (fixer) => fixer.insertTextBeforeRange([first.start, first.start], '\n'),
				});
			},
		};
	},
};

export default {
	meta: {
		name: 'fakturian',
	},
	rules: {
		'await-standalone': awaitStandalone,
		'error-text': errorTextRule,
		'shortcut-guard': shortcutGuard,
		'test-id-selector': testIdSelector,
		'submit-by-button': submitByButton,
		'constants-data-only': constantsDataOnly,
		'no-contract-mock': noContractMock,
		'component-path': componentPath,
		'no-alias-function': noAliasFunction,
		'comment-style': commentStyle,
		'exact-text': exactText,
		'object-multiline': objectMultiline,
	},
};
