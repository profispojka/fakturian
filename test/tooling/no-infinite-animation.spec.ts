import { globSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { compileStyle, parse } from 'vue/compiler-sfc';

function infiniteCss(source: string): string[] {
	const compiled = compileStyle({
		source,
		id: 'motion-guardrail',
		filename: 'motion-guardrail.vue',
	});
	if (compiled.errors.length) throw new Error(`CSS nelze analyzovat: ${compiled.errors.join('\n')}`);
	const violations: string[] = [];
	compiled.rawResult?.root.walkDecls((declaration) => {
		if (!/^(?:(?:-(?:webkit|moz)-)?animation(?:-iteration-count)?|--animate-.+)$/i.test(declaration.prop)) return;
		if (!/\binfinite\b/i.test(declaration.value)) return;
		const parent = declaration.parent;
		const selector = parent?.type === 'rule' ? parent.selector : '';
		if (
			selector &&
			selector.split(',').every((part) => /\[(?:aria-busy=["']true["']|role=["']progressbar["'])\]/.test(part))
		)
			return;
		violations.push(`řádek ${declaration.source?.start?.line}: ${declaration.prop}: ${declaration.value}`);
	});
	return violations;
}

function infiniteVue(source: string): string[] {
	const { descriptor, errors } = parse(source);
	if (errors.length) throw new Error(`Vue nelze analyzovat: ${errors.join('\n')}`);
	const violations = descriptor.styles.flatMap((style) => infiniteCss(style.content));
	const nodes = descriptor.template?.ast?.children.toReversed() ?? [];
	while (nodes.length) {
		const node = nodes.pop();
		if (node?.type !== 1) continue;
		nodes.push(...node.children.toReversed());
		const loading =
			node.tag === 'USkeleton' ||
			node.tag === 'UProgress' ||
			node.props.some(
				(prop) =>
					prop.type === 6 &&
					((node.tag === 'UIcon' &&
						prop.name === 'name' &&
						prop.value?.content === 'i-lucide-loader-circle') ||
						(prop.name === 'role' && prop.value?.content === 'progressbar')),
			);
		if (loading) continue;
		for (const prop of node.props) {
			let value = '';
			if (prop.type === 6 && ['class', 'style'].includes(prop.name)) value = prop.value?.content ?? '';
			if (
				prop.type === 7 &&
				prop.name === 'bind' &&
				prop.arg?.type === 4 &&
				['class', 'style'].includes(prop.arg.content)
			)
				value = prop.exp?.loc.source ?? '';
			if (/\banimate-(?:spin|ping|pulse)\b|(?:^|[\W_])infinite(?:$|[\W_])/.test(value))
				violations.push(`řádek ${prop.loc.start.line}: <${node.tag}> ${value}`);
		}
	}
	return violations;
}

describe('Dekorativní animace mají konec', () => {
	it('CSS a Vue šablony nepovolí nekonečný pohyb mimo indikátory načítání', () => {
		const violations = globSync('src/**/*.{css,vue}')
			.toSorted()
			.flatMap((file) => {
				const source = readFileSync(file, 'utf8');
				return (file.endsWith('.vue') ? infiniteVue(source) : infiniteCss(source)).map(
					(violation) => `${file}: ${violation}`,
				);
			});
		expect(violations).toEqual([]);
	});

	it.each([
		'.sun { animation: breathe 2s ease infinite; }',
		'.sun { animation-iteration-count: infinite; }',
		'.sun { -webkit-animation: spin 1s infinite; }',
		'.sun, [role="progressbar"] { animation: spin 1s infinite; }',
		'@theme { --animate-breathe: breathe 2s infinite; }',
		'@media (min-width: 48rem) { .sun:hover { animation: breathe 2s infinite; } }',
	] as const)('odhalí nekonečnou CSS animaci: %s', (source) => {
		expect(infiniteCss(source)).toHaveLength(1);
	});

	it.each([
		'<template><UIcon name="i-lucide-sun" class="animate-spin" /></template>',
		"<template><div :class=\"active ? 'animate-pulse' : ''\" /></template>",
		'<template><div class="motion-safe:hover:animate-ping" /></template>',
		'<template><div :style="{ animation: \'breathe 2s infinite\' }" /></template>',
		'<template><p class="animate-[breathe_2s_infinite]" /></template>',
		'<template><p /></template><style>.sun { animation: breathe 2s infinite; }</style>',
	] as const)('odhalí nekonečný pohyb v komponentě: %s', (source) => {
		expect(infiniteVue(source)).toHaveLength(1);
	});

	it('povolí konečné animace a konkrétní indikátory načítání, ignoruje komentáře', () => {
		expect(infiniteCss('/* animation: spin 1s infinite; */ .sun { animation: rise .5s both; }')).toEqual([]);
		expect(infiniteCss('[aria-busy="true"] .loader { animation: spin 1s infinite; }')).toEqual([]);
		expect(infiniteCss('[role="progressbar"] { animation: spin 1s infinite; }')).toEqual([]);
		expect(
			infiniteVue(`<template>
		<!-- <div class="animate-spin" /> -->
		<UIcon name="i-lucide-loader-circle" class="animate-spin" />
		<USkeleton class="animate-pulse" />
		<div role="progressbar" class="animate-pulse" />
		<div class="motion-safe:animate-den-rise" />
		</template>`),
		).toEqual([]);
	});

	it('neplatné CSS ani šablonu nepovažuje za úspěšnou kontrolu', () => {
		expect(() => infiniteCss('.sun { animation:')).toThrow('CSS nelze analyzovat');
		expect(() => infiniteVue('<template><div></template>')).toThrow('Vue nelze analyzovat');
	});
});
