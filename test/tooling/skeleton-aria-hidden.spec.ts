import { globSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// Komentáře se vybílí (ne smažou), aby seděly řádky v hlášce.
const blank = (match: string) => match.replace(/[^\n]/g, ' ');

const templateOf = (source: string) =>
	source.replace(/<!--[\s\S]*?-->/g, blank).replace(/<(script|style)\b[\s\S]*?<\/\1>/g, blank);

const vueFiles = globSync('src/**/*.vue').toSorted();

// Otevírací tag i přes víc řádků; `>` uvnitř uvozovek (`:class="a > b ? …"`) tag neukončí.
const SKELETON_TAG = /<USkeleton\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

function unhidden(source: string): string[] {
	const template = templateOf(source);
	const offenders: string[] = [];

	for (const tag of template.matchAll(SKELETON_TAG)) {
		if (/\saria-hidden="true"/.test(tag[1]!)) continue;
		offenders.push(`řádek ${template.slice(0, tag.index).split('\n').length}`);
	}

	return offenders;
}

describe('USkeleton je skrytý pro čtečku', () => {
	it('každá šablona skrývá skeletony', () => {
		const offenders = vueFiles.flatMap((file) =>
			unhidden(readFileSync(file, 'utf8')).map((line) => `${file}: ${line}`),
		);
		expect(
			offenders,
			`${offenders.join('\n')}\nUSkeleton se vykreslí jako role="alert" s anglickým aria-label="loading" — dopiš mu aria-hidden="true" a kontejneru načítání aria-busy="true" (vzor layout/list-table.vue).`,
		).toEqual([]);
	});
});

describe('detektor neskrytého skeletonu', () => {
	it.each([
		['skeleton bez aria-hidden', '<template><USkeleton class="h-4 w-full" /></template>'],
		['aria-hidden="false"', '<template><USkeleton class="h-4" aria-hidden="false" /></template>'],
		[
			'víceřádkový tag bez aria-hidden',
			'<template><USkeleton\n\tv-for="row in 3"\n\t:key="row"\n\tclass="h-4" /></template>',
		],
		['párový tag bez aria-hidden', '<template><USkeleton class="h-4"></USkeleton></template>'],
	] as const)('hlásí %s', (_label, source) => {
		expect(unhidden(source)).toHaveLength(1);
	});

	it('hlásí správný řádek', () => {
		expect(unhidden('<template>\n\t<div>\n\t\t<USkeleton class="h-4" />\n\t</div>\n</template>')).toEqual([
			'řádek 3',
		]);
	});

	it.each([
		['skrytý skeleton', '<template><USkeleton class="h-4 w-full" aria-hidden="true" /></template>'],
		[
			'víceřádkový tag s `>` ve výrazu',
			'<template><USkeleton\n\tv-for="row in rows"\n\t:class="row > 2 ? \'w-3/4\' : \'w-full\'"\n\taria-hidden="true" /></template>',
		],
		['skeleton v komentáři', '<template><!-- <USkeleton class="h-4" /> --></template>'],
		[
			'skeleton ve skriptu',
			'<script setup lang="ts">const s = `<USkeleton class="h-4" />`;</script><template><p>x</p></template>',
		],
	] as const)('mlčí na %s', (_label, source) => {
		expect(unhidden(source)).toEqual([]);
	});
});
