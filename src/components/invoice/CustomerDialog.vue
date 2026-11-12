<script setup lang="ts">
import { whenever } from '@vueuse/core';

import { contactSchema, type Contact } from '~/schemas/customers';
import { partyToContact } from '~/utils/invoice';

import type { InvoiceParty } from '~/schemas/invoices';

// Odběratel se zadá přímo na faktuře: cesta přes Odběratele by vedla přes hlídku rozepsaného dokladu.
const { party } = defineProps<{ party: InvoiceParty }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ confirm: [contact: Contact, remember: boolean] }>();

const form = ref<Contact>(partyToContact(party));
const remember = ref(false);
const { lookup: aresLookup, loading: aresLoading, error: aresError } = useAres();
const title = computed(() => (party.name ? 'Upravit odběratele' : 'Zadat odběratele'));

// Úprava odběratele z dokladu mezi Odběratele sama nepatří — vznikl by dvojník už uloženého.
whenever(open, () => {
	form.value = partyToContact(party);
	remember.value = !party.name;
	aresError.value = '';
});

async function fillFromAres() {
	const ico = form.value.ico;
	const company = await aresLookup(ico);
	// Pole IČO je během dotazu zamčené, ale dialog jde zavřít a otevřít znovu; odpověď pak patří jinému formuláři.
	if (!company || form.value.ico !== ico) return;
	form.value = {
		...form.value,
		name: company.name,
		ico: company.ico,
		dic: company.dic,
		address: company.address,
	};
}

function confirm() {
	emit(
		'confirm',
		{
			...form.value,
			address: {
				...form.value.address,
			},
		},
		remember.value,
	);
	open.value = false;
}
</script>

<template>
	<UModal v-model:open="open" :title="title" class="max-w-2xl!">
		<template #body>
			<UForm :state="form" :schema="contactSchema" data-testid="customer-dialog-form" @submit="confirm">
				<div class="form-grid grid-cols-1!">
					<UFormField name="name" label="Název / jméno">
						<UInput v-model="form.name" autofocus data-testid="customer-field-name" />
					</UFormField>
					<div class="form-grid form-grid--wide-first">
						<UFormField name="ico" label="IČO">
							<UInput
								v-model="form.ico"
								data-testid="customer-field-ico"
								:disabled="aresLoading"
								:ui="{ trailing: 'pe-0', base: 'pe-16' }">
								<template #trailing>
									<UButton
										class="w-14 justify-center rounded-s-none rounded-e-ctl border-s border-s-line-soft text-meta text-ink-2"
										variant="ghost"
										data-testid="customer-ares"
										:loading="aresLoading"
										:label="aresLoading ? '' : 'ARES'"
										@click="fillFromAres" />
								</template>
							</UInput>
						</UFormField>
						<UFormField name="dic" label="DIČ">
							<UInput v-model.trim.optional="form.dic" data-testid="customer-field-dic" />
						</UFormField>
					</div>
					<FieldError :error="aresError" data-testid="customer-ares-error" />
					<UFormField name="email" label="E-mail">
						<UInput v-model.trim.optional="form.email" data-testid="customer-field-email" />
					</UFormField>
					<UFormField name="address.street" label="Ulice a č.p.">
						<UInput v-model="form.address.street" data-testid="customer-field-street" />
					</UFormField>
					<div class="form-grid form-grid--wide-first">
						<UFormField name="address.city" label="Město">
							<UInput v-model="form.address.city" data-testid="customer-field-city" />
						</UFormField>
						<UFormField name="address.zip" label="PSČ">
							<UInput v-model="form.address.zip" data-testid="customer-field-zip" />
						</UFormField>
					</div>
					<UCheckbox v-model="remember" label="Uložit i do Odběratelů" data-testid="customer-remember" />
				</div>
				<div class="mt-4 flex justify-end gap-2">
					<UButton variant="ghost" color="neutral" data-testid="customer-dialog-cancel" @click="open = false">
						Zrušit
					</UButton>
					<UButton type="submit" data-testid="customer-dialog-confirm">Použít na faktuře</UButton>
				</div>
			</UForm>
		</template>
	</UModal>
</template>
