<script setup lang="ts">
import { cs } from '@nuxt/ui/locale';

import type { NuxtError } from '#app';

const props = defineProps<{ error: NuxtError }>();
</script>

<template>
	<UApp :locale="cs">
		<!-- Chybová stránka se vykresluje místo `app.vue`, takže si `UApp` s češtinou nese sama. -->
		<UError
			:error="{ statusMessage: 'Fakturian narazil na chybu', message: props.error.message }"
			icon="i-lucide-triangle-alert"
			redirect="/"
			:clear="{ label: 'Zpět na přehled' }"
			data-drag-region
			data-testid="app-error" />
	</UApp>
</template>
