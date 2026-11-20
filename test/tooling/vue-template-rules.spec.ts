import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

import config from '../../eslint.config.ts';

const componentConfig = config.find((entry) => entry.rules?.['vue/no-restricted-syntax']);
if (!componentConfig) throw new Error('Konfigurace Vue guardrailů chybí.');

const probeConfig = {
	...componentConfig,
	languageOptions: {
		...componentConfig.languageOptions,
		parserOptions: {
			...componentConfig.languageOptions?.parserOptions,
			projectService: false,
		},
	},
	rules: Object.fromEntries(Object.entries(componentConfig.rules!).filter(([name]) => name.startsWith('vue/'))),
};

const linter = new Linter();

describe('Vue guardraily ze skutečné konfigurace ESLintu', () => {
	it.each([
		['nativní odkaz', '<template><a href="https://example.com">Web</a></template>', 'vue/no-restricted-syntax'],
		['hook vnode', '<template><UButton @vue:mounted="load" /></template>', 'vue/no-restricted-syntax'],
		['kebab-case komponenta', '<template><u-button /></template>', 'vue/component-name-in-template-casing'],
		[
			'mutace props',
			'<script setup lang="ts">const props = defineProps<{ item: { count: number } }>(); props.item.count++;</script><template><p /></template>',
			'vue/no-mutating-props',
		],
		[
			'osm props',
			'<script setup lang="ts">defineProps<{ a: string; b: string; c: string; d: string; e: string; f: string; g: string; h: string }>();</script><template><p /></template>',
			'vue/max-props',
		],
	])('odmítne %s', (_name, source, ruleId) => {
		const diagnostics = linter.verify(source, probeConfig, { filename: 'src/Probe.vue' });
		expect(diagnostics.map((diagnostic) => diagnostic.ruleId)).toEqual([ruleId]);
	});

	it('povolí odkaz přes ULink a běžné události', () => {
		const diagnostics = linter.verify(
			'<template><ULink to="/settings">Nastavení</ULink><UButton @click="save" /></template>',
			probeConfig,
			{ filename: 'src/Probe.vue' },
		);
		expect(diagnostics).toEqual([]);
	});
});
