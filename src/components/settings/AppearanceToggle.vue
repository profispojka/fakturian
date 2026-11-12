<script setup lang="ts">
const colorMode = useColorMode();
</script>

<template>
	<URadioGroup
		v-model="colorMode.preference"
		:items="[
			{ value: 'light', label: 'Světlý' },
			{ value: 'dark', label: 'Tmavý' },
			{ value: 'system', label: 'Systém' },
		]"
		variant="list"
		orientation="horizontal"
		indicator="hidden"
		aria-label="Barevný motiv"
		data-testid="settings-appearance"
		:data-mode="colorMode.preference">
		<template #label="{ item }">
			<span :data-testid="`appearance-${item.value}`">{{ item.label }}</span>
		</template>
	</URadioGroup>
</template>
