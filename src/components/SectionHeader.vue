<script setup lang="ts">
defineProps<{ title: string }>();
</script>

<template>
	<header class="flex min-h-(--ctl) items-center justify-between gap-3">
		<h2 class="section-title m-0!">
			{{ title }}
		</h2>
		<slot />
	</header>
</template>
