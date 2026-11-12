<script setup lang="ts">
defineProps<{ number: string; email: string }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ send: [] }>();
</script>

<template>
	<UModal v-model:open="open" title="Odeslat fakturu e-mailem?">
		<template #body>
			<p data-testid="mail-question">
				Faktura
				<strong>{{ number }}</strong>
				půjde na adresu
				<strong>{{ email }}</strong>
				z tvého mailového klienta.
			</p>
			<p class="hint mt-2">
				Otevře se mailový klient s předvyplněným textem (předmět a tělo upravíš tam). PDF se otevře ve Finderu —
				přetáhni ho do e-mailu jako přílohu.
			</p>
		</template>
		<template #footer="{ close }">
			<UButton variant="ghost" data-testid="mail-no" @click="close">Ne, díky</UButton>
			<UButton variant="create" data-testid="mail-send" @click="emit('send')">Odeslat e-mailem</UButton>
		</template>
	</UModal>
</template>
