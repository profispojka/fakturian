<script setup lang="ts">
const wizardOpen = useState<boolean>('vaultWizardOpen', () => false);

function openWizard() {
	wizardOpen.value = true;
}
</script>

<template>
	<div class="flex flex-col items-start gap-3" data-testid="vault-empty">
		<p class="text-ui text-ink-2" data-testid="vault-empty-text">
			Není zvolena datová složka, do které se ukládají všechna data.
		</p>
		<UButton data-testid="vault-empty-choose" @click="openWizard">Zvolit datovou složku…</UButton>
	</div>
</template>
