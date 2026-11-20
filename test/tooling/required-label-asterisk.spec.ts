import { globSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// Komentáře se vybílí (ne smažou), aby seděly řádky v hlášce.
const blank = (match: string) => match.replace(/[^\n]/g, ' ');

const templateOf = (source: string) =>
	source.replace(/<!--[\s\S]*?-->/g, blank).replace(/<(script|style)\b[\s\S]*?<\/\1>/g, blank);

const vueFiles = globSync('src/**/*.vue').toSorted();

// Pole bez UFormField labelu (richtext, uploader, skupina checkboxů) nese hvězdičku ručně. UFormField ji
// kreslí třídou `text-danger`, ruční musí sáhnout na tutéž, jinak zůstane černá.
const MANUAL_ASTERISK = /<span\b([^>]*)>\s*\*\s*<\/span>/g;

function uncolored(source: string): string[] {
	const template = templateOf(source);
	const offenders: string[] = [];

	for (const span of template.matchAll(MANUAL_ASTERISK)) {
		if (/[\s"']text-danger[\s"']/.test(span[1]!)) continue;
		offenders.push(`řádek ${template.slice(0, span.index).split('\n').length}`);
	}

	return offenders;
}

describe('ruční hvězdička povinnosti je červená', () => {
	it('každá šablona barví ruční hvězdičku', () => {
		const offenders = vueFiles.flatMap((file) =>
			uncolored(readFileSync(file, 'utf8')).map((line) => `${file}: ${line}`),
		);
		expect(
			offenders,
			`${offenders.join('\n')}\nRuční hvězdičce dopiš class="text-danger" — UFormField ji u svých labelů kreslí toutéž třídou a černá hvězdička vedle červené vypadá jako jiný stav.`,
		).toEqual([]);
	});
});

describe('detektor černé hvězdičky', () => {
	it('hlásí hvězdičku bez barvy', () => {
		expect(uncolored('<template><h2>Otázka <span aria-hidden="true">*</span></h2></template>')).toHaveLength(1);
	});

	it.each([
		[
			'obarvenou hvězdičku',
			'<template><h2>Otázka <span aria-hidden="true" class="text-danger">*</span></h2></template>',
		],
		['hvězdičku v komentáři', '<template><!-- <span aria-hidden="true">*</span> --></template>'],
		[
			'hvězdičku ve skriptu',
			'<script setup lang="ts">const s = `<span>*</span>`;</script><template><p>x</p></template>',
		],
	] as const)('mlčí na %s', (_label, source) => {
		expect(uncolored(source)).toEqual([]);
	});
});
