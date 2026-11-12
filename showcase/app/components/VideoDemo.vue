<script setup lang="ts">
/**
 * Klip z appky. Načítá se až na vyžádání — pět videí na stránce by jinak
 * zabilo načtení. Do prvního kliknutí je vidět poster, pak se teprve
 * stáhne mp4/webm.
 */
const props = withDefaults(
	defineProps<{
		/** název bez přípony v /media */
		name: string;
		title: string;
		caption?: string;
		/** smyčka bez zvuku (dlaždice funkcí); jinak klasický přehrávač */
		loop?: boolean;
	}>(),
	{ loop: false },
);

const start = ref(false);
const video = ref<HTMLVideoElement | null>(null);

async function play() {
	start.value = true;
	await nextTick();
	try {
		await video.value?.play();
	} catch {
		/* autoplay zamítnut — uživatel si video pustí sám ovládáním */
	}
}
</script>

<template>
	<figure class="m-0">
		<div class="relative border border-(--line) rounded-card overflow-hidden bg-(--surface)">
			<video
				v-if="start"
				ref="video"
				:poster="`/media/${name}-poster.jpg`"
				:loop="loop"
				:muted="loop"
				playsinline
				controls
				preload="auto"
				class="block w-full">
				<source :src="`/media/${name}.webm`" type="video/webm" />
				<source :src="`/media/${name}.mp4`" type="video/mp4" />
				<track kind="captions" srclang="cs" label="Česky" :src="`/media/${name}.vtt`" default />
			</video>

			<button
				v-else
				type="button"
				class="group block relative w-full p-0 border-0 bg-none cursor-pointer"
				@click="play">
				<img
					:src="`/media/${name}-poster.jpg`"
					:alt="`Náhled videa: ${title}`"
					width="1920"
					height="1200"
					loading="lazy"
					decoding="async" />
				<span
					class="absolute inset-0 grid place-items-center text-[2rem] text-white bg-[rgb(0_0_0/0.22)] transition-colors duration-150 ease-[ease] group-hover:bg-[rgb(0_0_0/0.34)]"
					aria-hidden="true">
					▶
				</span>
				<span class="absolute w-px h-px overflow-hidden [clip-path:inset(50%)]">
					Přehrát video: {{ title }}
				</span>
			</button>
		</div>
		<figcaption v-if="caption" class="mt-[0.65rem] text-note text-(--ink-2)">{{ caption }}</figcaption>
	</figure>
</template>
