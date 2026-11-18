import type { RuleTester } from 'oxlint/plugins-dev';

export type Rule = Parameters<InstanceType<typeof RuleTester>['run']>[1];

export type Visitor = ReturnType<NonNullable<Rule['create']>>;

export type CallNode = Parameters<NonNullable<Visitor['CallExpression']>>[0];

export type ProgramNode = Parameters<NonNullable<Visitor['Program']>>[0];

export type Expression = CallNode['callee'];

export type Argument = CallNode['arguments'][number];

export type FunctionNode = Parameters<NonNullable<Visitor['ArrowFunctionExpression']>>[0];

export type Comment = ProgramNode['comments'][number];

export type Node = Parameters<NonNullable<Visitor['CallExpression']>>[0]['parent'];

export type AnyFunctionNode =
	| Parameters<NonNullable<Visitor['FunctionDeclaration']>>[0]
	| Parameters<NonNullable<Visitor['ArrowFunctionExpression']>>[0];
