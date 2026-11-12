<script setup lang="ts">
import { roundCents } from '~/utils/money';

// Vymazané pole je `undefined`, ne nula: schéma ho odmítne jako nevyplněné.
const czk = defineModel<number | undefined>({
	get: (cents) => cents && cents / 100,
	set: (value) => value && roundCents(value * 100),
});
</script>

<template>
	<UInputNumber
		v-model.optional="czk"
		:format-options="{ maximumFractionDigits: 2 }"
		:step-snapping="false"
		:increment="false"
		:decrement="false"
		disable-wheel-change />
</template>
