<script setup lang="ts">
defineProps<{ items?: readonly unknown[]; filtered?: readonly unknown[]; error?: string | undefined }>();
</script>

<template>
	<p v-if="error" class="text-ui text-danger" data-testid="empty-state-error">Došlo k chybě: {{ error }}</p>
	<UEmpty v-else-if="!items?.length" data-testid="empty-state">
		<template #leading>
			<UIcon name="i-lucide-search-x" class="size-10 text-ink-3" />
		</template>
		<template #description>
			<slot>Žádné položky nenalezeny.</slot>
		</template>
	</UEmpty>
	<UEmpty
		v-else-if="filtered && !filtered.length"
		description="Žádné položky nenalezeny."
		data-testid="empty-state-filtered">
		<template #leading>
			<UIcon name="i-lucide-search-x" class="size-10 text-ink-3" />
		</template>
	</UEmpty>
</template>
