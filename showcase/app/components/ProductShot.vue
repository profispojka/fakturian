<script setup lang="ts">
/**
 * Obrázek z appky. Rám kreslí CSS (ostrý v obou motivech), obrázek se mění
 * podle zvoleného motivu webu — světlá appka na tmavé stránce vypadá jako
 * cizí prvek.
 */
const props = withDefaults(
	defineProps<{
		/** název souboru bez přípony v /media/shots */
		name: string;
		alt: string;
		caption?: string;
		/** má obrázek dostat lištu okna macOS? */
		window?: boolean;
		width?: number;
		height?: number;
		priority?: boolean;
		/** existuje tmavá varianta `<name>.dark.png`? */
		dark?: boolean;
	}>(),
	{
		window: false,
		width: 2880,
		height: 1800,
		priority: false,
		dark: true,
	},
);

const colorMode = useColorMode();
const src = computed(() => `/media/shots/${props.name}${props.dark && colorMode.value === 'dark' ? '.dark' : ''}.png`);
</script>

<template>
	<figure class="shot" :class="{ 'shot--window': window }">
		<img
			:src="src"
			:alt="alt"
			:width="width"
			:height="height"
			:loading="priority ? 'eager' : 'lazy'"
			:fetchpriority="priority ? 'high' : undefined"
			decoding="async" />
		<figcaption v-if="caption">{{ caption }}</figcaption>
	</figure>
</template>
