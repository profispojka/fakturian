<script setup lang="ts">
import { useEventListener } from '@vueuse/core';

// `destructive` je ve výchozím stavu `true`: Vue u boolean prop chybějící hodnotu převádí na
// `false`, takže by `open({ title, message })` obarvilo mazání jako neškodnou akci.
const props = withDefaults(
	defineProps<{
		title: string;
		message: string;
		confirmLabel?: string;
		/** `false` u otázek, které nic neničí — červená by pak byla jen ozdoba. */
		destructive?: boolean;
		signal?: AbortSignal;
	}>(),
	{ destructive: true },
);
const emit = defineEmits<{ close: [boolean] }>();

useEventListener(
	() => props.signal,
	'abort',
	() => emit('close', false),
);
</script>

<template>
	<UModal :title="title" :close="{ onClick: () => emit('close', false) }">
		<!-- Nadpis přes slot kvůli testovací značce; `UModal` ho vykreslí na stejné místo. -->
		<template #title>
			<span data-testid="dialog-heading">{{ title }}</span>
		</template>
		<template #body>
			<!-- HTML by `\n` v otázce (řádky faktury od agenta) slilo do jednoho řádku. -->
			<p class="break-words whitespace-pre-line" data-testid="dialog-message">
				{{ message }}
			</p>
		</template>
		<template #footer>
			<UButton variant="create" data-testid="dialog-cancel" @click="emit('close', false)">Zrušit</UButton>
			<UButton
				variant="create"
				:color="destructive ? 'error' : 'primary'"
				data-testid="dialog-confirm"
				@click="emit('close', true)">
				{{ props.confirmLabel ?? 'Smazat' }}
			</UButton>
		</template>
	</UModal>
</template>
