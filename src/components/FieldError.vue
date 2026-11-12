<script setup lang="ts">
const { error } = defineProps<{ error?: string }>();

const message = computed(() => error?.trim());
</script>

<template>
	<p
		v-if="message"
		class="relative rounded-row bg-danger-soft px-3 py-2 text-meta leading-prose text-danger before:absolute before:bottom-full before:left-4 before:size-0 before:border-x-6 before:border-b-6 before:border-x-transparent before:border-b-danger-soft before:content-['']">
		<!-- Trojúhelník z okrajů, ne otočený čtverec: podklad je průsvitný a překryv by svítil tmavší. -->
		{{ message }}
	</p>
</template>
