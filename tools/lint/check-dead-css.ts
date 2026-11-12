#!/usr/bin/env node
import { globSync, readFileSync } from 'node:fs';

import { parse, type AtRule, type Node } from 'postcss';
import { babelParse, parse as parseSfc, type SFCTemplateBlock } from 'vue/compiler-sfc';

type TemplateRoot = NonNullable<SFCTemplateBlock['ast']>;

export interface Rule {
	owners: string[];
	applies: string[];
}

const CSS = 'src/assets/css/main.css';
const SOURCES = ['src/**/*.vue', 'src/**/*.ts'];

const FOREIGN = new Map([
	['dark', 'nasazuje @nuxtjs/color-mode'],
	['window-inactive', 'nasazuje sledování stavu okna z hlavního procesu'],
	['native', 'nasazuje se na <html> podle běhu v okně appky'],
	['iconify', 'vykresluje Iconify'],
]);

const STAYS = new Map([
	['figures', 'jeho pravidla přebíjí .figures--compact pořadím, musí stát těsně nad ním'],
	['figures--compact', 'přebíjí .figures > * pořadím, ne specificitou'],
	['page-header', 'nese bg-(--bg), které smí stát jen v main.css'],
	['field', 'sdílí deklarační bloky s .form-grid a .ftable'],
]);

const REFERENCE = "@reference '~/assets/css/main.css';";

const TRANSITION = /-(?:enter|leave)-(?:from|active|to)$/;

const TRANSITIONS = new Set(['Transition', 'TransitionGroup']);

// Bez `@reference` nezná `@apply` v bloku tokeny appky a překlad spadne až za běhu.
export function unreferenced(source: string): boolean {
	return parseSfc(source).descriptor.styles.some((style) => !style.content.trim().startsWith(REFERENCE));
}

/** Řetězce z kódu, ne jména a klíče: `{ link: 'h-8' }` nese jen `h-8`. */
function stringsIn(code: string): string[] {
	const found: string[] = [];
	const visit = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const child of node) visit(child);
			return;
		}
		if (typeof node !== 'object' || node === null) return;
		if ('type' in node && 'value' in node) {
			const { type, value } = node;
			if (type === 'StringLiteral' && typeof value === 'string') found.push(value);
			if (type === 'TemplateElement' && typeof value === 'object' && value !== null && 'raw' in value) {
				found.push(String(value.raw));
			}
		}
		for (const [key, child] of Object.entries(node)) {
			if (key !== 'loc' && key !== 'leadingComments' && key !== 'trailingComments') visit(child);
		}
	};
	visit(
		babelParse(code, {
			sourceType: 'module',
			plugins: ['typescript'],
		}).program,
	);
	return found;
}

/**
 * Šablona nese třídu jen v atributu třídy, ve jménu přechodu a v řetězci vázaného výrazu; jméno
 * značky nebo prop (`<UInput>`, `label=`) by jinak vypadalo jako nošení `.input` a `.label`.
 */
function templateStrings(root: TemplateRoot): string[] {
	const found: string[] = [];
	const visit = (nodes: TemplateRoot['children']): void => {
		for (const node of nodes) {
			if (!('props' in node)) continue;
			for (const prop of node.props) {
				if ('exp' in prop) {
					if (prop.name === 'bind' && prop.exp) found.push(...stringsIn(`(${prop.exp.loc.source})`));
					continue;
				}
				const carries =
					prop.name === 'class' ||
					prop.name.endsWith('-class') ||
					(prop.name === 'name' && TRANSITIONS.has(node.tag));
				if (carries && prop.value) found.push(prop.value.content);
			}
			visit(node.children);
		}
	};
	visit(root.children);
	return found;
}

/**
 * `<style>` se vynechává schválně: tvar, který si stránka sama definuje, by se v něm našel a stránka
 * by vypadala jako jeho nositel, i kdyby ho v šabloně nepoužila.
 */
export function markupOf(file: string, source: string): string {
	if (file.endsWith('.ts')) return stringsIn(source).join('\n');
	const { template, script, scriptSetup } = parseSfc(source).descriptor;
	return [
		...(template?.ast ? templateStrings(template.ast) : []),
		...[script, scriptSetup].flatMap((block) => (block ? stringsIn(block.content) : [])),
	].join('\n');
}

const OWN_CLASS = /\.([a-z][a-z0-9-]*)/g;

/** Bloky `@theme` popisují tokeny, ne slovník — `.dark` a spol. */
function inTheme(node: Node): boolean {
	const { parent } = node;
	if (!parent) return false;
	return ('name' in parent && parent.name === 'theme') || inTheme(parent);
}

export function utilities(css: string): Set<string> {
	const names = new Set<string>();
	parse(css).walkAtRules('utility', (rule) => {
		names.add(rule.params.trim());
	});
	return names;
}

export function vocabulary(css: string): string[] {
	const names = new Set<string>(utilities(css));
	for (const rule of rules(css)) {
		for (const owner of rule.owners) names.add(owner);
	}
	for (const name of FOREIGN.keys()) names.delete(name);
	return [...names].toSorted();
}

export function rules(css: string): Rule[] {
	const own = utilities(css);
	const found: Rule[] = [];
	parse(css).walk((node) => {
		if (inTheme(node)) return;
		let owners: string[];
		if (node.type === 'rule') owners = [...node.selector.matchAll(OWN_CLASS)].map(([, name]) => name ?? '');
		else if (node.type === 'atrule' && node.name === 'utility') owners = [node.params.trim()];
		else return;
		const applies = (node.nodes ?? [])
			.filter((child): child is AtRule => child.type === 'atrule' && child.name === 'apply')
			.flatMap((apply) => apply.params.split(/\s+/))
			.filter((name) => own.has(name));
		found.push({
			owners: owners.filter(Boolean),
			applies,
		});
	});
	return found;
}

export function dead(names: string[], markup: string, index: Rule[]): string[] {
	const wears = (needle: string): boolean => new RegExp(String.raw`(?<![\w-])${needle}(?![\w-])`).test(markup);

	const worn = new Set(
		names.filter((name) => {
			if (wears(name)) return true;
			const [base] = name.split('--');
			if (base !== undefined && base !== name && markup.includes(`${base}--`)) return true;
			const transition = name.replace(TRANSITION, '');
			return transition !== name && wears(transition);
		}),
	);

	const known = new Set(names);
	const alive = new Set(names);
	const standing = (rule: Rule): boolean =>
		rule.owners.length === 0 || rule.owners.some((o) => !known.has(o) || alive.has(o));

	for (let changed = true; changed;) {
		changed = false;
		for (const name of alive) {
			if (worn.has(name)) continue;
			if (index.some((rule) => rule.applies.includes(name) && standing(rule))) continue;
			alive.delete(name);
			changed = true;
		}
	}
	return names.filter((name) => !alive.has(name));
}

export function wearers(name: string, markup: Map<string, string>): string[] {
	const re = new RegExp(String.raw`(?<![\w-])${name}(?![\w-])`);
	return [...markup].filter(([, source]) => re.test(source)).map(([file]) => file);
}

export function misplaced(
	shared: string[],
	markup: Map<string, string>,
	own: Set<string>,
): { name: string; want: string }[] {
	const out: { name: string; want: string }[] = [];
	for (const name of shared) {
		if (STAYS.has(name) || own.has(name)) continue;
		const worn = wearers(name, markup);
		const [only] = worn;
		if (worn.length === 1 && only !== undefined && only.endsWith('.vue')) {
			out.push({
				name,
				want: `nosí jen ${only} — patří do jeho <style>`,
			});
		}
	}
	return out;
}

if (import.meta.main) {
	const css = readFileSync(CSS, 'utf8');
	const files = SOURCES.flatMap((pattern) => globSync(pattern)).filter((file) => file !== CSS);
	const markup = new Map(files.map((file) => [file, markupOf(file, readFileSync(file, 'utf8'))]));

	const everywhere = [...markup.values()].join('\n');
	const shared = vocabulary(css);
	const orphans = dead(shared, everywhere, rules(css));
	for (const name of orphans) console.error(`${CSS}  .${name}  →  v src/** ji nikdo nenosí`);

	const strays = misplaced(shared, markup, utilities(css));
	for (const { name, want } of strays) console.error(`.${name}  →  ${want}`);

	const bare = files.filter((file) => file.endsWith('.vue') && unreferenced(readFileSync(file, 'utf8')));
	for (const file of bare) console.error(`${file}  →  <style> nezačíná ${REFERENCE}`);

	if (orphans.length + strays.length + bare.length > 0) {
		if (orphans.length > 0) console.error(`\n${orphans.length}× tvar, který appka nepoužívá — smazat.`);
		if (strays.length > 0) console.error(`${strays.length}× tvar, který bydlí jinde, než kde se nosí.`);
		if (bare.length > 0) console.error(`${bare.length}× <style> blok bez @reference.`);
		process.exit(1);
	}
}
