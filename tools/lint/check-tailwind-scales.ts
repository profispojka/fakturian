#!/usr/bin/env node
import { globSync, readFileSync } from 'node:fs';

import { parse } from 'postcss';

import { MIN_WINDOW_SIZE } from '../../desktop/window-size.ts';

interface ScaleIndex {
	text: Map<string, string>;
	radius: Map<string, string>;
	leading: Map<string, string>;
	breakpoint: Map<number, string>;
	alias: Map<string, string>;
	literal: Map<string, string>;
	floor: number;
}

const CSS = 'src/assets/css/main.css';
const SOURCES = ['src/**/*.vue', 'src/**/*.ts', CSS];

const clean = (value: string): string => value.replace(/\/\*.*?\*\//g, '').trim();

const asColor = (value: string): string => value.replaceAll('_', ' ').replace(/\s+/g, '');

export function scaleIndex(css: string, floor = 0): ScaleIndex {
	const index: ScaleIndex = {
		text: new Map(),
		radius: new Map(),
		leading: new Map(),
		breakpoint: new Map(),
		alias: new Map(),
		literal: new Map(),
		floor,
	};
	parse(css).walkAtRules('theme', (theme) => {
		theme.walkDecls(/^--/, (decl) => {
			const name = decl.prop.slice('--'.length);
			if (name.includes('--')) return;
			const value = clean(decl.value);
			if (name.startsWith('text-')) index.text.set(value, name);
			else if (name.startsWith('radius-')) index.radius.set(value, name.slice('radius-'.length));
			else if (name.startsWith('leading-')) index.leading.set(value, name.slice('leading-'.length));
			else if (name.startsWith('breakpoint-')) {
				index.breakpoint.set(Number.parseInt(value, 10), name.slice('breakpoint-'.length));
			} else if (name.startsWith('color-')) {
				const short = name.slice('color-'.length);
				const alias = value.match(/^var\(--([a-z0-9-]+)\)$/);
				if (alias?.[1] !== undefined) index.alias.set(alias[1], short);
				else index.literal.set(asColor(value), short);
			}
		});
	});
	return index;
}

const COLOR = String.raw`(?:text|bg|border|border-[tblrxyse]|fill|stroke|outline|divide|ring|caret|decoration|from|to|via)`;

/**
 * Vrací `{ line, found, want }`; `want` je celá třída, která se má napsat místo nalezené, ne jen
 * jméno tokenu — ať se oprava dá přepsat rovnou, bez dohledávání předpony.
 */
export function offenders(text: string, index: ScaleIndex): { line: number; found: string; want: string }[] {
	const hits: { line: number; found: string; want: string }[] = [];
	const lines = text.split('\n');
	for (const [i, line] of lines.entries()) {
		const at = (found: string, want: string): number =>
			hits.push({
				line: i + 1,
				found,
				want,
			});

		const SCALES: Record<string, { family: Map<string, string>; whole: boolean }> = {
			text: {
				family: index.text,
				whole: true,
			},
			leading: {
				family: index.leading,
				whole: false,
			},
			rounded: {
				family: index.radius,
				whole: false,
			},
		};
		for (const [, prefix, raw] of line.matchAll(/\b(text|leading|rounded)-\[([^\]]+)\]/g)) {
			if (prefix === undefined || raw === undefined) continue;
			const entry = SCALES[prefix];
			if (!entry) continue;
			const { family, whole } = entry;
			const name = family.get(raw.replaceAll('_', ' '));
			if (name) at(`${prefix}-[${raw}]`, whole ? name : `${prefix}-${name}`);
		}

		for (const [, prefix, raw] of line.matchAll(new RegExp(String.raw`\b(${COLOR})-\[([^\]]+)\]`, 'g'))) {
			if (prefix === undefined || raw === undefined) continue;
			const name = index.literal.get(asColor(raw));
			if (name) at(`${prefix}-[${raw}]`, `${prefix}-${name}`);
		}

		for (const [, prefix, token] of line.matchAll(new RegExp(String.raw`\b(${COLOR})-\(--([a-z0-9-]+)\)`, 'g'))) {
			if (prefix === undefined || token === undefined) continue;
			const name = index.alias.get(token);
			if (name) at(`${prefix}-(--${token})`, `${prefix}-${name}`);
		}

		const mix = /\b(\w[\w-]*)-\[color-mix\(in[_ ]srgb,var\(--([a-z0-9-]+)\)[_ ](\d+)%,transparent\)\]/g;
		for (const [, prefix, token, percent] of line.matchAll(mix)) {
			if (prefix === undefined || token === undefined || percent === undefined) continue;
			const name = index.alias.get(token);
			if (name) at(`${prefix}-[color-mix(…${token} ${percent}%…)]`, `${prefix}-${name}/${percent}`);
		}

		for (const [, prefix] of line.matchAll(/(?<![\w:-])(sm|md|lg|xl|2xl):[a-z!-]/g)) {
			if (prefix !== undefined) at(`${prefix}:`, 'split: nebo wide: — výchozí zlomy jsou jen kvůli Nuxt UI');
		}

		for (const [, kind, px] of line.matchAll(/\b(min|max)-\[(\d+)px\]:/g)) {
			if (kind === undefined || px === undefined) continue;
			const width = Number.parseInt(px, 10);
			const dead = kind === 'min' ? width <= index.floor : width < index.floor;
			if (dead) {
				const always = kind === 'min' ? 'vždycky pravda' : 'vždycky nepravda';
				at(`${kind}-[${px}px]:`, `smazat — ${always}, okno se pod ${index.floor} px nezmenší`);
				continue;
			}
			const name = index.breakpoint.get(kind === 'min' ? width : width + 1);
			if (name) at(`${kind}-[${px}px]:`, `${kind === 'min' ? '' : 'max-'}${name}:`);
		}
	}
	return hits;
}

// Na obyčejném elementu tyhle utility nic nedělají, preflight už nuluje; na komponentě Nuxt UI přebíjejí
// její výchozí vzhled, proto se hlásí jen u značky psané malými písmeny.
const NOOP = /(?<![\w:!-])(m-0|p-0|px-0|py-0|mx-0|my-0|border-0|list-none)(?![\w!-])/g;

export function noops(text: string): { line: number; found: string; want: string }[] {
	const hits: { line: number; found: string; want: string }[] = [];
	for (const [i, line] of text.split('\n').entries()) {
		for (const [, classes] of line.matchAll(/<[a-z][a-z0-9]*\b[^>]*?\bclass="([^"]*)"/g)) {
			for (const [found] of (classes ?? '').matchAll(NOOP)) {
				hits.push({
					line: i + 1,
					found,
					want: 'smazat — preflight to už nuluje (proti Nuxt UI s `!`)',
				});
			}
		}
	}
	return hits;
}

if (import.meta.main) {
	const index = scaleIndex(readFileSync(CSS, 'utf8'), MIN_WINDOW_SIZE.width);
	let total = 0;
	for (const file of SOURCES.flatMap((pattern) => globSync(pattern)).toSorted((a, b) => a.localeCompare(b))) {
		const text = readFileSync(file, 'utf8');
		const hits = file.endsWith('.vue') ? [...offenders(text, index), ...noops(text)] : offenders(text, index);
		for (const hit of hits) {
			console.error(`${file}:${hit.line}  ${hit.found}  →  ${hit.want}`);
			total += 1;
		}
	}
	if (total > 0) {
		console.error(`\n${total}× třída mimo škály a zlomy z ${CSS}.`);
		process.exit(1);
	}
}
