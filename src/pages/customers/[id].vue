<script setup lang="ts">
import { contactSchema, emptyContact, type Contact } from '~/schemas/customers';

definePageMeta({ alias: ['/customers/new'] });

const { contacts, loaded, upsert } = useContacts();
const router = useRouter();
const id = useRouteId();
const { form: contact, reset, commit } = useForm<Contact>(() => emptyContact());
const status = usePageStatus();
const missing = ref(false);
const shown = ref<string | null>(null);

function syncFromRoute() {
	if (shown.value === id.value) return;
	if (!id.value) {
		reset(emptyContact());
		missing.value = false;
		shown.value = '';
		return;
	}
	const found = contacts.value.find((row) => row.id === id.value);
	if (!found) {
		missing.value = loaded.value;
		return;
	}
	reset(toRaw(found));
	missing.value = false;
	shown.value = id.value;
}

watch([id, contacts, loaded], syncFromRoute, { immediate: true });

const { lookup: aresLookup, loading: aresLoading, error: aresError } = useAres();

async function fillFromAres() {
	const ico = contact.value.ico;
	if (!ico) return;

	const company = await aresLookup(ico);
	if (!company) return;
	const next: Contact = {
		...contact.value,
		name: company.name,
		ico: company.ico,
		address: company.address,
	};
	// Neplátce DIČ nemá; to z předchozího IČO nesmí zůstat.
	if (company.dic) next.dic = company.dic;
	else delete next.dic;
	contact.value = next;
}

async function save() {
	status.clear();
	try {
		await upsert(structuredClone(toRaw(contact.value)));
	} catch (e) {
		status.error('Odběratele se nepodařilo uložit', e);
		return;
	}
	commit();
	await router.push('/customers');
}
</script>

<template>
	<UForm v-slot="{ loading }" class="page detail-page" :state="contact" :schema="contactSchema" @submit="save">
		<header class="detail-header" data-drag-region>
			<span
				class="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line-soft bg-card text-ink-2">
				<UIcon name="i-lucide-contact-round" class="size-5" />
			</span>
			<h1
				class="flex min-w-0 flex-wrap items-baseline gap-2 text-stat font-semibold tracking-tight text-ink"
				data-testid="customer-page-title">
				<template v-if="!id">Nový odběratel</template>
				<template v-else>Upravit odběratele</template>
			</h1>
		</header>

		<div class="page-body detail-body selectable">
			<EmptyState v-if="missing">Tenhle odběratel v seznamu není — nejspíš je smazaný.</EmptyState>
			<template v-else>
				<div class="mx-auto w-full max-w-5xl" data-testid="customer-fields">
					<div class="grid grid-cols-1 gap-6 wide:grid-cols-2 wide:gap-8">
						<div>
							<h2 class="mb-4 text-ui font-medium text-ink">Hlavní údaje</h2>
							<!-- Pole pod sebou: dvě vedle sebe by v půlce plochy byla užší, než jaký text mají pojmout. -->
							<div class="form-grid grid-cols-1!">
								<UFormField name="name" label="Název / jméno">
									<UInput v-model="contact.name" data-testid="field-name" autofocus />
								</UFormField>
								<div class="form-grid form-grid--wide-first">
									<UFormField name="ico" label="IČO">
										<UInput
											v-model="contact.ico"
											data-testid="field-ico"
											:ui="id ? {} : { trailing: 'pe-0', base: 'pe-16' }">
											<!-- Jen při zakládání: u uloženého odběratele by dotaz přepsal údaje, které si uživatel upravil. -->
											<template v-if="!id" #trailing>
												<!-- Šířka je pevná: popisek se při dotahování střídá se spinnerem a poskakující hrana
												     by z pole udělala živý obrázek. -->
												<UButton
													class="w-14 justify-center rounded-s-none rounded-e-ctl border-s border-s-line-soft text-meta text-ink-2"
													data-testid="ares"
													variant="ghost"
													:loading="aresLoading"
													:label="aresLoading ? '' : 'ARES'"
													@click="fillFromAres" />
											</template>
										</UInput>
									</UFormField>
									<UFormField name="dic" label="DIČ">
										<UInput v-model.trim.optional="contact.dic" data-testid="field-dic" />
									</UFormField>
								</div>
								<FieldError :error="aresError" data-testid="ares-error" />
								<UFormField name="email" label="E-mail">
									<UInput v-model.trim.optional="contact.email" data-testid="field-email" />
								</UFormField>
							</div>
						</div>

						<div>
							<h2 class="mb-4 text-ui font-medium text-ink">Adresa</h2>
							<!-- Pole pod sebou: dvě vedle sebe by v půlce plochy byla užší, než jaký text mají pojmout. -->
							<div class="form-grid grid-cols-1!">
								<UFormField name="address.street" label="Ulice a č.p.">
									<UInput v-model="contact.address.street" data-testid="field-address-street" />
								</UFormField>
								<div class="form-grid form-grid--wide-first">
									<UFormField name="address.city" label="Město">
										<UInput v-model="contact.address.city" data-testid="field-address-city" />
									</UFormField>
									<UFormField name="address.zip" label="PSČ">
										<UInput v-model="contact.address.zip" data-testid="field-address-zip" />
									</UFormField>
								</div>
							</div>
						</div>
					</div>

					<div class="form-grid mt-3">
						<UFormField name="note" class="col-span-full" label="Poznámka">
							<UTextarea v-model.optional="contact.note" data-testid="field-note" :rows="2" />
						</UFormField>
					</div>
				</div>
			</template>
		</div>

		<footer class="detail-footer">
			<div class="mr-auto min-w-0 text-note text-ink-3">
				<span>{{ !id ? 'Nový odběratel' : 'Úprava odběratele' }}</span>
				<StatusbarFeedback :status="status.message" />
			</div>
			<div class="ml-auto flex shrink-0 items-center gap-2">
				<UButton
					variant="ghost"
					color="neutral"
					class="rounded-full px-3 text-meta!"
					data-testid="customer-cancel"
					:disabled="loading || missing"
					to="/customers">
					Zrušit
				</UButton>
				<UButton
					variant="create"
					type="submit"
					trailing-icon="i-lucide-save"
					data-save
					data-testid="action-save"
					:disabled="missing"
					:loading="loading">
					Uložit
				</UButton>
			</div>
		</footer>
	</UForm>
</template>
