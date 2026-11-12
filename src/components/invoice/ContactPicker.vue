<script setup lang="ts">
import type { Contact } from '~/schemas/customers';

// Vlastní komponenta, ne kus `invoice/[id].vue`: stránka je nejdelší v appce a tenhle dialog s ní
// nesdílí nic než jedno kliknutí.
defineProps<{ contacts: Contact[] }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ pick: [Contact] }>();

const search = {
	icon: 'i-lucide-search',
	variant: 'outline',
	placeholder: 'Hledat (název, IČO, město, e-mail)…',
	'data-testid': 'customer-picker-search',
} as const;
</script>

<template>
	<UModal v-model:open="open" title="Zvolit odběratele" class="max-w-2xl!">
		<template #body>
			<UListbox
				:items="contacts"
				label-key="name"
				:filter="search"
				:filter-fields="['name', 'ico', 'address.city', 'email']"
				autofocus
				data-testid="customer-picker-list"
				@update:model-value="(contact) => emit('pick', contact)">
				<template #empty>
					<EmptyState :items="contacts" :filtered="[]">
						Zatím žádní odběratelé. Použij „Zadat ručně".
					</EmptyState>
				</template>
				<template #item="{ item }">
					<span class="flex w-full items-center gap-3" data-testid="customer-picker-item">
						<UAvatar :alt="item.name" size="md" data-testid="customer-picker-avatar" />
						<span class="flex min-w-0 flex-col gap-1">
							<span class="font-medium" data-testid="customer-picker-name">{{ item.name }}</span>
							<span class="hint" data-testid="customer-picker-subtitle">
								IČO {{ item.ico }} · {{ item.address.city }}
							</span>
						</span>
					</span>
				</template>
			</UListbox>
		</template>
	</UModal>
</template>
