import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { dead, markupOf, misplaced, rules, unreferenced, vocabulary, wearers } from '../tools/lint/check-dead-css.ts';

const css = readFileSync(new URL('../src/assets/css/main.css', import.meta.url), 'utf8');
const names = vocabulary(css);
const index = rules(css);

describe('rejstřík slovníku', () => {
	it('čte tvary ze selektorů', () => {
		expect(names).toContain('page');
		expect(names).toContain('ftable');
		expect(names).toContain('field');
	});

	it('čte jména @utility', () => {
		expect(names).toContain('bevel');
		expect(names).toContain('eyebrow');
	});

	it('nebere token za tvar slovníku', () => {
		// `--color-ink-2` je token, ne třída; `@theme` se do rejstříku nečte.
		expect(names).not.toContain('ink-2');
	});

	it('vynechá třídy, které appce nasazuje něco jiného než markup', () => {
		expect(names).not.toContain('dark');
		expect(names).not.toContain('window-inactive');
		expect(names).not.toContain('iconify');
	});
});

describe('pravidla', () => {
	it('rozebere pravidlo na tvary v selektoru a utility v @apply', () => {
		const own = '@utility bevel {\n\t@apply border;\n}\n.raised {\n\t@apply grow bevel;\n}\n';
		expect(rules(own)).toEqual([
			{
				owners: ['bevel'],
				applies: [],
			},
			{
				owners: ['raised'],
				applies: ['bevel'],
			},
		]);
	});

	it('nebere utilitu Tailwindu ze seznamu za vlastní tvar', () => {
		// Kdyby ji `@apply` propašoval mezi vlastní, `.grow` by se nedalo nahlásit ani mrtvé.
		const own = '.raised {\n\t@apply grow;\n}\n';
		expect(rules(own)).toEqual([
			{
				owners: ['raised'],
				applies: [],
			},
		]);
	});

	it('čte pravidlo i uvnitř @media a @layer', () => {
		const nested = '@layer base {\n\t@media (width > 40rem) {\n\t\t.wide { color: red; }\n\t}\n}\n';
		expect(rules(nested)).toEqual([
			{
				owners: ['wide'],
				applies: [],
			},
		]);
	});

	it('nečte @theme ani s odsazenou závorkou a komentářem se složenou závorkou', () => {
		const theme =
			'@theme inline {\n\t/* { */ --color-dark: #000;\n\t.dark { color: red; }\n  }\n.page { color: red; }\n';
		expect(vocabulary(theme)).toEqual(['page']);
	});
});

describe('nálezy', () => {
	it('hlásí tvar, který v markupu nikdo nenosí', () => {
		expect(dead(['native-select'], '<p class="page">x</p>', index)).toEqual(['native-select']);
	});

	it('mlčí o tvaru, který markup nosí', () => {
		expect(dead(['page'], '<p class="page">x</p>', index)).toEqual([]);
	});

	it('nepovažuje složeninu za použití jejího základu', () => {
		expect(dead(['btn'], '<p class="btn-primary">x</p>', [])).toEqual(['btn']);
	});

	it('mlčí o utilitě, kterou si bere žijící pravidlo', () => {
		const own: ReturnType<typeof rules> = [
			{
				owners: ['raised'],
				applies: ['bevel'],
			},
		];
		expect(dead(['bevel', 'raised'], '<p class="raised">x</p>', own)).toEqual([]);
	});

	it('hlásí i utilitu, kterou drželo jen mrtvé pravidlo', () => {
		// `.native-select` nikdo nenosí, takže `chevron` padá s ní — týmž během, ne až tím příštím.
		const own: ReturnType<typeof rules> = [
			{
				owners: ['native-select'],
				applies: ['chevron'],
			},
		];
		expect(dead(['chevron', 'native-select'], '<p class="page">x</p>', own)).toEqual(['chevron', 'native-select']);
	});

	it('nechá žít utilitu, kterou si bere pravidlo na element', () => {
		const own: ReturnType<typeof rules> = [
			{
				owners: [],
				applies: ['eyebrow'],
			},
		];
		expect(dead(['eyebrow'], '<div />', own)).toEqual([]);
	});

	it('mlčí o variantě skládané až za běhu', () => {
		const markup = `:class="\`state--\${stateOf(i)}\`"`;
		expect(dead(['state--paid'], markup, [])).toEqual([]);
	});

	it('hlásí variantu, jejíž základ se za běhu neskládá', () => {
		expect(dead(['state--paid'], '<p class="state">x</p>', [])).toEqual(['state--paid']);
	});

	it('mlčí o třídách přechodu, které vyrábí Vue z jeho jména', () => {
		const markup = '<Transition name="fade"><div /></Transition>';
		expect(dead(['fade-enter-active', 'fade-leave-to'], markup, [])).toEqual([]);
	});

	it('hlásí třídy přechodu, jehož jméno v markupu není', () => {
		expect(dead(['fade-enter-active'], '<div />', [])).toEqual(['fade-enter-active']);
	});
});

describe('kde tvar bydlí', () => {
	const markup = new Map([
		['src/pages/index.vue', '<ol class="rank-list"><li class="row" /></ol>'],
		['src/pages/invoices.vue', '<div class="row" />'],
		['src/app.config.ts', "({ ui: { link: 'link' } })"],
	]);

	it('nevidí tvar ve <style> bloku stránky jako jeho nošení', () => {
		// Jinak by si každá stránka svůj tvar „nosila" sama a nikdy by nešlo poznat, že ho v šabloně
		// nepoužívá.
		const sfc = '<template><div /></template>\n<style>\n.rank-list > li { color: red; }\n</style>';
		expect(markupOf('src/pages/x.vue', sfc)).toBe('');
	});

	it('bere z .ts jen řetězce, ne klíče objektu', () => {
		const config = "({ ui: { link: 'h-8 px-3 text-ui' } })";
		expect(markupOf('src/app.config.ts', config)).toBe('h-8 px-3 text-ui');
	});

	it('apostrof v komentáři .ts rozbor nerozhodí', () => {
		const source = `// it's a comment\nexport const a = 'row';\nexport const b = \`state--\${a}\`;`;
		expect(markupOf('src/x.ts', source)).toBe('row\nstate--\n');
	});

	it('u .vue bere třídy, jména přechodů a řetězce vázaných výrazů a skriptu', () => {
		const sfc = [
			'<template>',
			'<div class="row" enter-active-class="fly">',
			'<Transition name="fade"><span :class="{ \'is-on\': on }" :ui="{ base: \'h-8\' }" /></Transition>',
			'</div>',
			'</template>',
			'<script setup lang="ts">const tone = \'muted\';</script>',
			'<style>\n.gone { color: red; }\n</style>',
		].join('\n');
		expect(markupOf('src/pages/x.vue', sfc)).toBe('row\nfly\nfade\nis-on\nh-8\nmuted');
	});

	it('jméno značky, prop ani text šablony za nošení tvaru nebere', () => {
		const sfc = '<template><label for="q" name="label"><UInput placeholder="input" />search</label></template>';
		expect(markupOf('src/pages/x.vue', sfc)).toBe('');
	});

	it('vyjmenuje soubory, které tvar nosí', () => {
		expect(wearers('row', markup)).toEqual(['src/pages/index.vue', 'src/pages/invoices.vue']);
	});

	it('hlásí tvar, který nosí jediná stránka', () => {
		expect(misplaced(['rank-list'], markup, new Set())).toEqual([
			{
				name: 'rank-list',
				want: 'nosí jen src/pages/index.vue — patří do jeho <style>',
			},
		]);
	});

	it('mlčí o tvaru, který nosí víc stránek', () => {
		expect(misplaced(['row'], markup, new Set())).toEqual([]);
	});

	it('mlčí o tvaru, který nosí jen .ts — tam <style> blok nejde', () => {
		expect(misplaced(['link'], markup, new Set())).toEqual([]);
	});

	it('mlčí o vlastní @utility — bere si ji přes @apply sám main.css', () => {
		expect(misplaced(['rank-list'], markup, new Set(['rank-list']))).toEqual([]);
	});

	it('mlčí o tvaru, který vyhrává pořadím, ne specificitou', () => {
		const compact = new Map([['src/pages/index.vue', '<div class="figures--compact" />']]);
		expect(misplaced(['figures--compact'], compact, new Set())).toEqual([]);
	});
});

describe('<style> blok komponenty', () => {
	it('mlčí o bloku, který začíná @reference', () => {
		expect(
			unreferenced("<template />\n<style>\n@reference '~/assets/css/main.css';\n.a { @apply p-2; }\n</style>"),
		).toBe(false);
	});

	it('hlásí blok bez @reference', () => {
		expect(unreferenced('<template />\n<style>\n.a { @apply p-2; }\n</style>')).toBe(true);
	});

	it('hlásí blok, kde @reference nestojí první', () => {
		expect(unreferenced("<style>\n/* proč */\n@reference '~/assets/css/main.css';\n</style>")).toBe(true);
	});

	it('mlčí o souboru bez bloku', () => {
		expect(unreferenced('<template />')).toBe(false);
	});
});
