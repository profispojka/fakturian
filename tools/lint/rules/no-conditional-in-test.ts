import { ancestorsOf, importedNameOf, isFunction, memberName } from './shared/ast.ts';
import type { Node, Rule, Scope } from './shared/types.ts';

type Wrapper = Extract<
	Node,
	{ type: 'TSAsExpression' | 'TSTypeAssertion' | 'TSNonNullExpression' | 'TSInstantiationExpression' | 'ChainExpression' }
>;

type Conditional = Extract<
	Node,
	{ type: 'IfStatement' | 'SwitchStatement' | 'ConditionalExpression' | 'LogicalExpression' }
>;

const isWrapper = (node: Node): node is Wrapper =>
	node.type === 'TSAsExpression' ||
	node.type === 'TSTypeAssertion' ||
	node.type === 'TSNonNullExpression' ||
	node.type === 'TSInstantiationExpression' ||
	node.type === 'ChainExpression';

const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null && 'type' in value;

function containsTestNode(node: Node | null | undefined, predicate: (node: Node) => boolean): boolean {
	if (!node) return false;
	if (predicate(node)) return true;
	if (isFunction(node)) return false;
	return Object.entries(node).some(([key, value]: [string, unknown]) => {
		if (key === 'parent') return false;
		const children: unknown[] = Array.isArray(value) ? value : [value];
		return children.some((child) => isNode(child) && containsTestNode(child, predicate));
	});
}

// Hlídá větvení kroků a asercí; výpočty dat a implementace mocků nejsou testový scénář.
export const noConditionalInTest: Rule = {
	meta: {
		type: 'suggestion',
		schema: [],
		messages: {
			conditional:
				'Podmíněné kroky a aserce rozděl do samostatných scénářů. Výpočty hodnot a callbacky mocků jsou povolené.',
		},
	},
	create(context) {
		const { sourceCode } = context;
		const testCallbacks = new Set<Node>();
		const mockArguments = new Set<Node>();
		const callbackArguments = new Set<Node>();
		const browserArguments = new Set<Node>();
		const reported = new Set<Node>();

		function callNameOf(node: Node): string {
			if (isWrapper(node)) return callNameOf(node.expression);
			if (node.type === 'CallExpression') return callNameOf(node.callee);
			if (node.type === 'TaggedTemplateExpression') return callNameOf(node.tag);
			if (node.type === 'MemberExpression') {
				const property = memberName(node);
				if (property === undefined) return '';
				return `${callNameOf(node.object)}.${property}`;
			}
			if (node.type !== 'Identifier') return '';
			for (let scope: Scope | null = sourceCode.getScope(node); scope; scope = scope.upper) {
				const variable = scope.set.get(node.name);
				if (!variable) continue;
				const definition = variable.defs[0];
				if (definition?.type === 'Parameter' || definition?.type === 'FunctionName') return '';
				if (definition?.node.type === 'ImportNamespaceSpecifier' && definition.parent?.type === 'ImportDeclaration') {
					const source = definition.parent.source.value;
					if (source === 'vitest') return 'vitest';
					if (source === '@playwright/test') return 'playwright';
					if (source === '@jest/globals') return 'jest';
				}
				break;
			}
			return importedNameOf(node, sourceCode);
		}

		function containsTestStep(node: Node | null | undefined, includeAwait = true): boolean {
			return containsTestNode(node, (child) => {
				if (child.type === 'AwaitExpression' && includeAwait) return true;
				if (child.type !== 'CallExpression') return false;
				const name = callNameOf(child.callee);
				return (
					/^(?:(?:vitest|playwright|jest)\.)?(?:expect|assert)(?:\.|$)/.test(name) ||
					/(?:^|\.)(?:click|dblclick|press|fill|setValue|trigger|setProps|check|uncheck|selectOption|goto|reload|hover|focus|blur|submit|requestSubmit|dispatchEvent|mount|mountSuspended)$/.test(
						name,
					)
				);
			});
		}

		function isDataStatement(node: Node | null | undefined): boolean {
			if (!node) return true;
			if (containsTestStep(node)) return false;
			switch (node.type) {
				case 'BlockStatement':
					return node.body.every((statement) => isDataStatement(statement));
				case 'IfStatement':
					return isDataStatement(node.consequent) && isDataStatement(node.alternate);
				case 'SwitchStatement':
					return node.cases.every((branch) => branch.consequent.every((statement) => isDataStatement(statement)));
				case 'ForOfStatement':
				case 'ForInStatement':
				case 'ForStatement':
					return isDataStatement(node.body);
				case 'VariableDeclaration':
				case 'ContinueStatement':
				case 'BreakStatement':
				case 'EmptyStatement':
					return true;
				case 'ReturnStatement':
					return node.argument !== null;
				case 'ExpressionStatement': {
					const expression = node.expression;
					return (
						expression.type === 'AssignmentExpression' ||
						expression.type === 'UpdateExpression' ||
						(expression.type === 'CallExpression' && /\.(?:push|add|set)$/.test(callNameOf(expression.callee)))
					);
				}
				default:
					return false;
			}
		}

		function isActionChoice(node: Extract<Conditional, { type: 'ConditionalExpression' | 'LogicalExpression' }>) {
			if (
				ancestorsOf(node).some(
						(ancestor) =>
							ancestor.type === 'ForStatement' &&
							ancestor.test &&
							ancestor.test.range[0] <= node.range[0] &&
							ancestor.test.range[1] >= node.range[1],
					) &&
				!containsTestStep(node, false)
			)
				return false;
			const branches = node.type === 'LogicalExpression' ? [node.right] : [node.consequent, node.alternate];
			if (branches.some((branch) => containsTestStep(branch))) return true;
			if (
				branches.some((branch) =>
					containsTestNode(
						branch,
						(child) => child.type === 'AssignmentExpression' || child.type === 'UpdateExpression',
					),
				)
			)
				return true;
			let value: Node = node;
			while (
				isWrapper(value.parent) ||
				value.parent.type === 'LogicalExpression' ||
				value.parent.type === 'ConditionalExpression'
			)
				value = value.parent;
			const parent = value.parent;
			const invokesBranch = containsTestNode(node, (child) => child.type === 'CallExpression');
			const enclosingFunction = ancestorsOf(parent).findLast(isFunction);
			return (
				(invokesBranch && (parent.type === 'ExpressionStatement' || parent.type === 'AwaitExpression')) ||
				(parent.type === 'CallExpression' && parent.callee === value) ||
				(invokesBranch &&
					parent.type === 'ReturnStatement' &&
					enclosingFunction !== undefined &&
					testCallbacks.has(enclosingFunction))
			);
		}

		function checkConditional(node: Conditional) {
			if (node.type === 'LogicalExpression' && node.operator === '??') return;
			const ancestors = ancestorsOf(node);
			if (!ancestors.some((ancestor) => testCallbacks.has(ancestor))) return;
			let insideFunction = false;
			for (const ancestor of ancestors.toReversed()) {
				if (isFunction(ancestor)) insideFunction = true;
				if (mockArguments.has(ancestor) && insideFunction) return;
				if (testCallbacks.has(ancestor)) break;
			}
			const functionNode = ancestors.findLast(isFunction);
			if (!functionNode) return;
			if (
				ancestors.some((ancestor) => browserArguments.has(ancestor)) &&
				!containsTestNode(
					functionNode.body,
					(child) =>
						child.type === 'CallExpression' &&
						/^(?:(?:vitest|playwright|jest)\.)?(?:expect|assert)(?:\.|$)/.test(callNameOf(child.callee)),
				)
			)
				return;
			if (!containsTestStep(functionNode.body) && ancestors.some((ancestor) => callbackArguments.has(ancestor)))
				return;
			if (node.type === 'LogicalExpression' || node.type === 'ConditionalExpression') {
				if (ancestors.some((ancestor) => reported.has(ancestor))) return;
				if (!isActionChoice(node)) return;
			} else {
				if (node.type === 'IfStatement' && !node.alternate && node.consequent.type === 'ExpressionStatement') {
					const expression = node.consequent.expression;
					if (
						expression.type === 'AssignmentExpression' &&
						expression.left.type === 'Identifier' &&
						!containsTestNode(
							expression.right,
							(child) =>
								child.type === 'CallExpression' ||
								child.type === 'AwaitExpression' ||
								child.type === 'AssignmentExpression' ||
								child.type === 'UpdateExpression',
						)
					)
						return;
				}
				const inDataLoop = ancestors.some(
					(ancestor) =>
						ancestor.type === 'ForOfStatement' ||
						ancestor.type === 'ForInStatement' ||
						ancestor.type === 'ForStatement',
				);
				const exitsBeforeSteps =
					containsTestNode(node, (child) => child.type === 'ReturnStatement') &&
					containsTestStep(functionNode.body);
				if (!exitsBeforeSteps && (inDataLoop || !testCallbacks.has(functionNode)) && isDataStatement(node)) return;
			}
			reported.add(node);
			context.report({
				node,
				messageId: 'conditional',
			});
		}

		return {
			CallExpression(node) {
				const name = callNameOf(node.callee);
				if (/\.(?:evaluate|evaluateAll|addInitScript)$/.test(name)) {
					for (const argument of node.arguments) browserArguments.add(argument);
				}
				if (
					/^(?:(?:vitest|playwright|jest)\.)?(?:test|it|fit|xit|xtest)(?:\.(?:only|skip|todo|each|for|concurrent|sequential|fails|skipIf|runIf))*$/.test(
						name,
					)
				) {
					for (const original of node.arguments) {
						let argument: Node = original;
						while (isWrapper(argument)) argument = argument.expression;
						if (isFunction(argument)) testCallbacks.add(argument);
					}
				}
				if (
					/(?:^|\.)(?:vi|jest)\.(?:fn|mock|doMock|hoisted|stubGlobal)$/.test(name) ||
					/\.(?:route|routeWebSocket|mockImplementation|mockImplementationOnce|mockReturnValue|mockReturnValueOnce|mockResolvedValue|mockResolvedValueOnce)$/.test(
						name,
					) ||
					/^(?:mockNuxtImport|mockComponent|mockNuxtComponent)$/.test(name) ||
					/^(?:stub|mock)[A-Z]/.test(name)
				) {
					for (const argument of node.arguments) mockArguments.add(argument);
				}
				if (
					/\.(?:on|once|addEventListener|evaluate|evaluateAll|addInitScript|waitForRequest|waitForResponse|waitForURL|toHaveURL|poll|find|findIndex|filter|every|some|map|flatMap|reduce|setProps)$/.test(
						name,
					) ||
					/^(?:defineComponent|h|mount|mountSuspended|watch|watchEffect)$/.test(name)
				) {
					for (const argument of node.arguments) callbackArguments.add(argument);
				}
			},
			IfStatement: checkConditional,
			SwitchStatement: checkConditional,
			ConditionalExpression: checkConditional,
			LogicalExpression: checkConditional,
		};
	},
};
