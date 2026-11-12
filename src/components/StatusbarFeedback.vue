<script setup lang="ts">
import type { Ref } from 'vue';
import type { PageStatus } from '~/composables/usePageStatus';

const props = defineProps<{
	status: PageStatus | Ref<PageStatus | null> | null;
}>();

const message = computed(() => unref(props.status));
</script>

<template>
	<span
		v-if="message"
		:class="{ 'text-accent': message.tone === 'success' }"
		:data-tone="message.tone"
		data-testid="status-message">
		{{ message.text }}
	</span>
	<slot v-else />
</template>
