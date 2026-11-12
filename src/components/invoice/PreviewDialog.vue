<script setup lang="ts">
const props = defineProps<{ pages: string[] }>();
const emit = defineEmits<{ close: [] }>();

// Přes `<img>`, ne `v-html`: obrázek ze SVG nespustí skript ani nesáhne na styly appky.
const sources = computed(() => props.pages.map((svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`));
</script>

<template>
	<UModal :open="true" class="max-w-4xl!" @update:open="emit('close')">
		<template #close="{ ui }">
			<UButton
				variant="ghost"
				color="neutral"
				icon="i-lucide-x"
				aria-label="Zavřít"
				:class="ui.close()"
				data-testid="invoice-preview-close" />
		</template>
		<template #title>
			<span data-testid="invoice-preview-heading">Náhled dokladu</span>
		</template>
		<template #body>
			<div class="flex flex-col gap-4">
				<img
					v-for="(src, index) in sources"
					:key="index"
					:src="src"
					:alt="`Strana ${index + 1}`"
					class="w-full border border-line-soft"
					data-testid="invoice-preview-page" />
			</div>
		</template>
	</UModal>
</template>
