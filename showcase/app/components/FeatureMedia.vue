<script setup lang="ts">
/**
 * Obrázek funkce s možností přehrát klip.
 *
 * Výchozí je **ostrý screenshot** (PNG přímo z appky) — poster z videa je
 * měkčí a na statické stránce by to bylo znát. Video se načte až když si
 * o něj někdo řekne; pět videí předem by stránku zabilo.
 */
defineProps<{
	shot: string;
	alt: string;
	video?: string;
	videoTitle: string;
	duration?: string;
}>();

const playing = ref(false);
</script>

<template>
	<div class="grid gap-[0.6rem] justify-items-start">
		<VideoDemo v-if="playing && video" :name="video" :title="videoTitle" />
		<ProductShot v-else :name="shot" :alt="alt" />

		<button
			v-if="video && !playing"
			type="button"
			class="inline-flex items-center gap-[0.45rem] py-[0.35rem] px-[0.8rem] border border-(--line-strong) rounded-ctl bg-transparent text-(--ink-2) [font:inherit] text-note cursor-pointer hover:text-(--ink) hover:border-(--ink-3)"
			@click="playing = true">
			<span aria-hidden="true">▶</span>
			Přehrát ukázku{{ duration ? ` (${duration})` : '' }}
		</button>
	</div>
</template>
