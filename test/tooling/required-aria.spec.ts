import { globSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// `required` na UFormField kreslí jen CSS hvězdičku, na vstup nepropíše nic (ariaAttrs nesou jen invalid
// a describedby). Čtečka pozná povinnost jen z `aria-required` na vstupu, proto musí s polem souhlasit.
const blank = (match: string) => match.replace(/[^\n]/g, ' ');

const templateOf = (source: string) =>
	source.replace(/<!--[\s\S]*?-->/g, blank).replace(/<(script|style)\b[\s\S]*?<\/\1>/g, blank);

// Konec otevírací značky — přeskakuje '>' uvnitř hodnot atributů (`:required="a > b"`).
function openTagEnd(source: string, start: number): number {
	let quote = '';
	for (let i = start; i < source.length; i++) {
		const char = source[i];
		if (quote) {
			if (char === quote) quote = '';
		} else if (char === '"' || char === "'") {
			quote = char;
		} else if (char === '>') {
			return i;
		}
	}
	return source.length;
}

// Povinnost z atributu: `undefined` = nepovinné, `'true'` = vždy, jinak výraz srovnatelný napříč formátováním
// (bez bílých znaků a koncových čárek); `x || undefined` jen nevykreslí aria-required="false", znamená totéž co `x`.
function requirement(tag: string, name: string): string | undefined {
	const match = new RegExp(`(?:^|\\s)(:?)${name}(?:=(?:"([^"]*)"|'([^']*)'))?(?=[\\s/>]|$)`).exec(tag);
	if (!match) return undefined;
	const value = (match[2] ?? match[3] ?? '')
		.replace(/\s+/g, '')
		.replace(/,(?=[)\]}])/g, '')
		.replace(/\|\|undefined$/, '');
	if (value === 'false') return undefined;
	if (!match[1] || value === 'true') return 'true';
	return value;
}

// Složené bloky berou `required` jako prop a `aria-required` si propíšou na vlastní vstup samy.
const COMPOSITES = [
	'FormDate',
	'FormAddressAutocomplete',
	'FormCadastralArea',
	'FormIcoAres',
	'FormPhone',
	'FormRichtext',
	'FormMultiselect',
	'FormYesNoSwitch',
];

// Výběr kreslí spouštěč reka-ui, který `aria-required` přepíše hodnotou propu `required`; povinnost proto nese jen
// prop místo samotného atributu `aria-required`.
const SELECTS = ['USelect', 'FormRatingSelect'];

// Obsah UFormFieldu až k jeho párové zavírací značce (vnořená pole se počítají).
function fieldBody(template: string, openEnd: number): string {
	const tokens = /<UFormField(?=[\s/>])|<\/UFormField>/g;
	tokens.lastIndex = openEnd;
	let depth = 1;
	for (let token = tokens.exec(template); token; token = tokens.exec(template)) {
		depth += token[0] === '</UFormField>' ? -1 : 1;
		if (depth === 0) return template.slice(openEnd, token.index);
	}
	return template.slice(openEnd);
}

function controlRequirements(body: string): (string | undefined)[] {
	const result: (string | undefined)[] = [];
	for (const open of body.matchAll(/<([A-Z][\w]*)(?=[\s/>])/g)) {
		const tag = body.slice(open.index, openTagEnd(body, open.index));
		if (SELECTS.includes(open[1]!)) {
			result.push(requirement(tag, 'required'));
			continue;
		}
		result.push(requirement(tag, 'aria-required'));
		if (COMPOSITES.includes(open[1]!)) result.push(requirement(tag, 'required'));
	}
	return result;
}

function unannounced(source: string): string[] {
	const template = templateOf(source);
	const offenders: string[] = [];

	for (const open of template.matchAll(/<UFormField(?=[\s/>])/g)) {
		const end = openTagEnd(template, open.index);
		const tag = template.slice(open.index, end);
		const required = requirement(tag, 'required');
		if (!required) continue;

		// Vždy povinné pole snese podmíněný vstup (přidávací select je povinný, dokud seznam nic nemá),
		// podmíněné pole musí mít na vstupu tutéž podmínku.
		const controls = controlRequirements(tag.endsWith('/') ? '' : fieldBody(template, end + 1));
		if (required === 'true' ? controls.some(Boolean) : controls.includes(required)) continue;

		const line = template.slice(0, open.index).split('\n').length;
		const label = /(?:^|\s):?label="([^"]*)"/.exec(tag)?.[1] ?? '';
		const expected = required === 'true' ? 'aria-required="true"' : ':aria-required se stejnou podmínkou';
		offenders.push(`řádek ${line}: „${label}" — vstup nemá ${expected}`);
	}

	return offenders;
}

const vueFiles = globSync('src/**/*.vue').toSorted();

describe('povinný UFormField ohlásí povinnost i čtečce', () => {
	it('každý povinný UFormField dává vstupu aria-required', () => {
		const offenders = vueFiles.flatMap((file) =>
			unannounced(readFileSync(file, 'utf8')).map((offender) => `${file}: ${offender}`),
		);
		expect(
			offenders,
			`${offenders.join('\n')}\nrequired na UFormField kreslí jen hvězdičku, vstup potřebuje aria-required se stejnou podmínkou (nativní required ne, spustil by bublinu prohlížeče), složený blok (${COMPOSITES.join(', ')}) a výběr (${SELECTS.join(', ')}) prop :required.`,
		).toEqual([]);
	});
});

const field = (attrs: string, input: string) =>
	`<template><UFormField label="Jméno" name="jmeno"${attrs}>${input}</UFormField></template>`;

describe('detektor povinnosti bez aria-required', () => {
	it.each([
		['povinné pole bez aria-required', field(' required', '<UInput v-model="x" />')],
		['vypnutý aria-required', field(' required', '<UInput v-model="x" :aria-required="false" />')],
		['nativní required místo aria-required', field(' :required="true"', '<UTextarea v-model="x" required />')],
		['jinou podmínku na vstupu', field(' :required="a"', '<USelect v-model="x" :required="b" />')],
		['statický aria-required u dynamického pole', field(' :required="a"', '<UInput aria-required="true" />')],
		['složený blok bez :required', field(' required', '<FormPhone v-model="x" />')],
		['datum bez :required', field(' required', '<FormDate v-model="x" />')],
		['výběr s aria-required místo required', field(' required', '<USelect v-model="x" aria-required="true" />')],
		['hodnocení s aria-required místo required', field(' required', '<FormRatingSelect aria-required="true" />')],
		['vnořený vstup s povinností jen u vnitřního pole', field(' required', field('', '<UInput />'))],
		['samouzavírací povinné pole', '<template><UFormField label="Jméno" required /></template>'],
	] as const)('hlásí %s', (_label, source) => {
		expect(unannounced(source)).toHaveLength(1);
	});

	it.each([
		['statickou povinnost', field(' required', '<UInput v-model="x" aria-required="true" />')],
		['bindovanou true', field(' :required="true"', '<UInput v-model="x" :aria-required="true" />')],
		[
			'stejnou podmínku přes víc řádků',
			field(' :required="\n\tlist.includes(\n\t\tx,\n\t)\n"', '<UTextarea :aria-required="list.includes(x)" />'),
		],
		['podmínku s || undefined', field(' :required="req"', '<UInput :aria-required="req || undefined" />')],
		['podmíněný vstup u vždy povinného pole', field(' required', '<USelect :required="!list.length" />')],
		['vstup zanořený v obalu', field(' required', '<div class="flex"><USelect required /></div>')],
		['složený blok s :required', field(' required', '<FormMultiselect v-model="x" :required="true" />')],
		['datum s required', field(' required', '<FormDate v-model="x" required />')],
		['výběr s required', field(' required', '<USelect v-model="x" required />')],
		['výběr se stejnou podmínkou v required', field(' :required="a"', '<FormRatingSelect :required="a" />')],
		['nepovinné pole', field('', '<UInput v-model="x" />')],
		['vypnuté pole', field(' :required="false"', '<UInput v-model="x" />')],
		['pole v komentáři', `<template><!-- ${field(' required', '<UInput />')} --></template>`],
		['aria-required nezaměněný za required', field(' aria-required="true"', '<UInput />')],
	] as const)('mlčí na %s', (_label, source) => {
		expect(unannounced(source)).toEqual([]);
	});
});
