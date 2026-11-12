<script setup lang="ts">
import { czkFromCents, czkWholeFromCents } from '~/utils/money';

const { cents, whole = false } = defineProps<{
	cents: number | undefined;
	whole?: boolean;
}>();

const amount = computed(() => {
	if (cents === undefined) return undefined;
	if (whole) return czkWholeFromCents(cents);
	return czkFromCents(cents);
});
</script>

<template>
	<span v-if="amount" class="whitespace-nowrap tabular-nums" data-testid="money">
		{{ amount }}
	</span>
</template>
