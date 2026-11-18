import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';
import { expect, it } from 'vitest';
import { compileTemplate, parse } from 'vue/compiler-sfc';

const globalObjects = new Set(['globalThis', 'window', 'self', 'global']);

function isGlobalObject(node: ts.Expression): boolean {
	if (ts.isIdentifier(node)) return globalObjects.has(node.text);
	return (
		ts.isPropertyAccessExpression(node) &&
		ts.isIdentifier(node.expression) &&
		node.expression.text === '_ctx' &&
		globalObjects.has(node.name.text)
	);
}

function usesNativeDate(source: string): boolean {
	const file = ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	let found = false;

	function visit(node: ts.Node) {
		if (ts.isIdentifier(node) && node.text === 'Date') {
			const parent = node.parent;
			if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
				if (isGlobalObject(parent.expression)) found = true;
			} else if (ts.isPropertyAssignment(parent) && parent.name === node) {
				// Klíč datového objektu není použití globálního konstruktoru.
			} else if (!ts.isTypeReferenceNode(parent)) {
				found = true;
			}
		}
		if (
			ts.isElementAccessExpression(node) &&
			isGlobalObject(node.expression) &&
			node.argumentExpression &&
			ts.isStringLiteral(node.argumentExpression) &&
			node.argumentExpression.text === 'Date'
		) {
			found = true;
		}
		ts.forEachChild(node, visit);
	}

	visit(file);
	return found;
}

it('rozliší nativní datum od textu, typu a klíče datového objektu', () => {
	expect(usesNativeDate('new Date()')).toBe(true);
	expect(usesNativeDate('Date.now()')).toBe(true);
	expect(usesNativeDate('const NativeDate = Date')).toBe(true);
	expect(usesNativeDate('globalThis.Date.parse(value)')).toBe(true);
	expect(usesNativeDate("new window['Date']()")).toBe(true);
	expect(usesNativeDate("type Input = Date; const row = { Date: 'Date.now()' }; row.Date;")).toBe(false);
	expect(usesNativeDate('dayjs().add(1, "day").toISOString()')).toBe(false);
	const compiled = compileTemplate({
		source: '<div>{{ window.Date.now() }} {{ globalThis["Date"].now() }}</div>',
		filename: 'probe.vue',
		id: 'probe',
	});
	expect(usesNativeDate(compiled.code)).toBe(true);
});

it('Vue šablony ani HTML skripty nepoužívají nativní Date', () => {
	const root = resolve(import.meta.dirname, '../..');
	const violations: string[] = [];
	const files = globSync(['{src,public}/**/*.{vue,html}'], { cwd: root });

	for (const file of files) {
		const source = readFileSync(resolve(root, file), 'utf8');
		if (file.endsWith('.vue')) {
			const template = parse(source).descriptor.template;
			if (!template) continue;
			const { code, errors } = compileTemplate({
				source: template.content,
				filename: file,
				id: file,
				compilerOptions: {
					expressionPlugins: ['typescript'],
				},
			});
			if (errors.length) violations.push(`${file}: šablonu nelze analyzovat (${String(errors[0])})`);
			if (usesNativeDate(code)) violations.push(file);
		} else {
			for (const script of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
				if (usesNativeDate(script[1] ?? '')) violations.push(file);
			}
		}
	}

	expect(violations).toEqual([]);
});
