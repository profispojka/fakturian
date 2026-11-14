<script setup lang="ts">
import { refAutoReset, useAsyncState, whenever } from '@vueuse/core';

import { DEFAULT_TEMPLATE } from '~/constants/numbering';
import { SAMPLE_INVOICE } from '~/constants/sample-invoice';
import { supplierSettingsSchema, emptySupplier, type Supplier, type ValidSupplier } from '~/schemas/suppliers';
import { systemServices } from '~/services/system';
import { today, yearOf } from '~/utils/date';
import { czechSentence, formatPassiveCount } from '~/utils/locales';
import { formatNumber, validateTemplate } from '~/utils/numbering';

import type { FormSubmitEvent } from '@nuxt/ui';

definePageMeta({ vaultOptional: true });

const SOURCE_URL = 'https://github.com/profispojka/fakturian';
const LICENSE_URL = 'https://github.com/profispojka/fakturian/blob/main/LICENSE';
const appVersion = useRuntimeConfig().public.appVersion;

// Přes `openUrl`, ne `<a href>`: okno appky by cizí stránku otevřelo místo sebe.
async function open(url: string) {
	try {
		await systemServices.openUrl(url);
	} catch (e) {
		status.error('Odkaz se nepodařilo otevřít', e);
	}
}

const { vaultPath, pickVault, openInFinder } = useVault();
const { supplier, setSupplier } = useSettings();
const { preview: previewInvoice, continueSeries } = useInvoices();

const { form, dirty, reset, mayDiscard } = useForm<Supplier>(() => supplier.value ?? emptySupplier());
// Rozepsaný formulář se nepřepisuje: nepovedené uložení vrátí dodavatele v paměti zpátky a formulář by
// s ním přišel o všechno, co v něm uživatel napsal.
whenever(supplier, (s) => {
	if (!dirty.value) reset(s);
});

const saved = refAutoReset(false, 1500);
const status = usePageStatus();
const { error: vaultReadError } = useMenuStats();

const templateError = computed(() => {
	const template = form.value.invoiceNumberFormat;
	if (!template.trim()) return '';
	return validateTemplate(template) ?? '';
});

const templateHint = computed(() => {
	const template = form.value.invoiceNumberFormat;
	if (!template.trim()) return '';
	if (templateError.value) return '';
	return `Např. ${formatNumber(template, yearOf(today()), 1)}`;
});

// Navázání se píše celým číslem ve formátu řady; samotné pořadí by `nextNumber` nepřečetl.
const startExample = computed(() => {
	const template = form.value.invoiceNumberFormat.trim() || DEFAULT_TEMPLATE;
	if (validateTemplate(template)) return '';
	return formatNumber(template, yearOf(today()), 137);
});

const startHint = computed(() => {
	if (!startExample.value) return '';
	return `Celé číslo, např. ${startExample.value}`;
});

const designPreview = ref<string[] | null>(null);

async function onDesignPreview() {
	try {
		designPreview.value = await previewInvoice(SAMPLE_INVOICE);
	} catch (e) {
		status.error('Náhled se nepodařilo otevřít', e);
	}
}

async function onSubmit(event: FormSubmitEvent<ValidSupplier>) {
	if (templateError.value) return;
	// IČO a IBAN se ukládají v tvaru ze schématu, ne tak, jak je uživatel napsal nebo vložil z banky.
	const typed = {
		...structuredClone(toRaw(form.value)),
		ico: event.data.ico,
		iban: event.data.iban,
	};
	let next: Supplier;
	try {
		next = await continueSeries(typed);
		await setSupplier(next);
	} catch (e) {
		// Bez odchycení by tlačítko tiše nic neudělalo a chyba skončila v konzoli.
		status.error('Údaje se nepodařilo uložit', e);
		return;
	}
	// Převod řady mohl přepsat navázání, formulář má ukázat, co se opravdu uložilo.
	reset(next);
	saved.value = true;
}

const vaultMsg = ref('');

async function onChange() {
	// Přepnutí načte appku znovu, takže rozepsané údaje by bez ptaní zmizely.
	const canDiscard = await mayDiscard('update');
	if (!canDiscard) return;

	try {
		await pickVault();
	} catch (e) {
		// Bez odchycení by tlačítko tiše nic neudělalo a appka zůstala ve staré složce bez vysvětlení.
		status.error('Změna datové složky selhala', e);
	}
}

const { pickFiles, importFiles } = useImport();
const importDetail = ref<string[]>([]);

async function onImport() {
	const paths = await pickFiles();
	if (paths.length === 0) return;

	vaultMsg.value = '';
	importDetail.value = [];

	try {
		const { report, addedContacts } = await importFiles(paths);
		const parts = [formatPassiveCount(report.imported.length, 'document', 'naimportován')];
		if (addedContacts > 0) parts.push(formatPassiveCount(addedContacts, 'customer', 'přidán'));
		if (report.skipped.length > 0) parts.push(formatPassiveCount(report.skipped.length, 'file', 'přeskočen'));

		vaultMsg.value = czechSentence(parts);
		importDetail.value = report.skipped.map((s) => `${s.file}: ${s.reason}`);
	} catch (e) {
		status.error('Import selhal', e);
	}
}

const { setLogo, hasLogo, logoUnreadable, removeLogo, refreshLogo } = useLogo();

async function onLogo() {
	vaultMsg.value = '';
	if (hasLogo.value) {
		const confirmed = await getUserConfirmation(
			'Stávající logo bude nahrazeno novým obrázkem. Tato změna ovlivní nově vystavené faktury.',
			{
				title: 'Změnit logo?',
				confirmLabel: 'Nahradit',
			},
		);
		if (!confirmed) return;
	}

	try {
		const wasSaved = await setLogo();
		if (wasSaved) vaultMsg.value = 'Logo uloženo do datové složky.';
	} catch (e) {
		status.error('Logo se nepodařilo uložit', e);
	}
}

async function onRemoveLogo() {
	vaultMsg.value = '';
	const confirmed = await getUserConfirmation('Nově vystavené faktury budou bez loga.', {
		title: 'Odebrat logo?',
		confirmLabel: 'Odebrat',
	});
	if (!confirmed) return;

	try {
		await removeLogo();
		vaultMsg.value = 'Logo odebráno z datové složky.';
	} catch (e) {
		status.error('Logo se nepodařilo odebrat', e);
	}
}

useAsyncState(refreshLogo, undefined, {
	onError: (e) => status.error('Stav loga se nepodařilo zjistit', e),
});
</script>

<template>
	<UForm
		v-slot="{ loading }"
		:state="form"
		:schema="supplierSettingsSchema"
		class="page detail-page settings-editor"
		@submit="onSubmit">
		<!-- Formulářem je celá stránka, aby tlačítko v dolním pásu bylo jeho `type="submit"`. -->
		<header class="detail-header" data-drag-region>
			<span
				class="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line-soft bg-card text-ink-2">
				<UIcon name="i-lucide-settings" class="size-5" />
			</span>
			<h1 class="text-stat font-semibold tracking-tight text-ink" data-testid="settings-title">Nastavení</h1>
		</header>

		<div class="page-body detail-body selectable">
			<div class="mx-auto flex w-full max-w-5xl flex-col gap-8">
				<UAlert
					v-if="vaultReadError"
					color="error"
					variant="soft"
					icon="i-lucide-triangle-alert"
					title="Doklady se nepodařilo načíst"
					:description="vaultReadError"
					data-testid="vault-read-error" />
				<section class="card">
					<h2 class="section-title">Vzhled aplikace</h2>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<span class="text-ui text-ink-2">Barevný motiv</span>
						<SettingsAppearanceToggle />
					</div>
				</section>
				<section v-if="vaultPath" class="card">
					<h2 class="section-title">Vlastní fakturační údaje (dodavatel)</h2>
					<div class="grid grid-cols-1 gap-6 wide:grid-cols-2 wide:gap-8">
						<div>
							<h3 class="section-title">Identifikace</h3>
							<div class="form-grid grid-cols-1!">
								<UFormField name="name" label="Jméno / název">
									<UInput v-model="form.name" placeholder="Jan Dodavatel" data-testid="field-name" />
								</UFormField>
								<UFormField name="ico" label="IČO">
									<UInput v-model="form.ico" data-testid="field-ico" />
								</UFormField>
								<UFormField name="registration" label="Zápis do rejstříku nebo evidence">
									<UInput v-model="form.registration" data-testid="field-registration" />
								</UFormField>
							</div>
						</div>

						<div>
							<h3 class="section-title">Sídlo</h3>
							<div class="form-grid grid-cols-1!">
								<UFormField name="address.street" label="Ulice a č.p.">
									<UInput v-model="form.address.street" data-testid="field-address-street" />
								</UFormField>
								<div class="form-grid form-grid--wide-first">
									<UFormField name="address.city" label="Město">
										<UInput v-model="form.address.city" data-testid="field-address-city" />
									</UFormField>
									<UFormField name="address.zip" label="PSČ">
										<UInput v-model="form.address.zip" data-testid="field-address-zip" />
									</UFormField>
								</div>
							</div>
						</div>

						<div>
							<h3 class="section-title">Banka</h3>
							<div class="form-grid grid-cols-1!">
								<div class="form-grid form-grid--wide-first">
									<UFormField name="bankAccount" label="Číslo účtu">
										<UInput
											v-model="form.bankAccount"
											placeholder="2000145399"
											data-testid="field-bankAccount" />
									</UFormField>
									<UFormField name="bankCode" label="Kód banky">
										<UInput
											v-model="form.bankCode"
											placeholder="0800"
											data-testid="field-bankCode" />
									</UFormField>
								</div>
								<UFormField name="iban" label="IBAN (nepovinné)">
									<UInput
										v-model.optional="form.iban"
										placeholder="CZ6508000000192000145399"
										data-testid="field-iban" />
								</UFormField>
							</div>
						</div>

						<div>
							<h3 class="section-title">Kontakt</h3>
							<div class="form-grid grid-cols-1!">
								<UFormField name="email" label="E-mail">
									<UInput v-model.trim.optional="form.email" data-testid="field-email" />
								</UFormField>
							</div>
						</div>
					</div>

					<h3 class="section-title mt-6">Fakturace</h3>
					<p class="mb-4 text-note text-ink-3">
						Při přechodu odjinud zadej první číslo řady, na které mají další doklady navázat.
					</p>
					<div class="form-grid">
						<UFormField name="defaultDueDays" label="Výchozí splatnost (dny)">
							<UInputNumber
								v-model="form.defaultDueDays"
								:step="1"
								:min="0"
								data-testid="field-defaultDueDays" />
						</UFormField>
						<UFormField
							name="invoiceNumberFormat"
							label="Formát čísla faktury"
							:hint="templateHint"
							:error="templateError">
							<UInput
								v-model="form.invoiceNumberFormat"
								placeholder="{RRRR}{NNNN}"
								data-testid="field-invoiceNumberFormat" />
						</UFormField>
						<UFormField
							name="invoiceNumberStart"
							label="Navázat na řadu od čísla"
							:hint="startHint"
							data-testid="settings-number-start">
							<UInput
								v-model.optional="form.invoiceNumberStart"
								:placeholder="startExample"
								data-testid="field-invoiceNumberStart" />
						</UFormField>
					</div>

					<div class="mt-6 border-t border-line-soft pt-5">
						<h3 class="section-title">Vzhled faktury (PDF)</h3>
						<p class="mb-4 text-note text-ink-3">
							Logo nejlépe vypadá jako PNG s průhledným pozadím. Náhled otevře ukázkovou fakturu s tvými
							údaji bez ukládání.
						</p>
						<div class="row">
							<UButton
								variant="ghost"
								icon="i-lucide-file-search"
								loading-auto
								data-testid="design-preview"
								@click="onDesignPreview">
								Náhled
							</UButton>
						</div>
					</div>
				</section>

				<section class="card" data-testid="settings-vault">
					<h2 class="section-title">Datová složka</h2>
					<p class="mb-4 text-note text-ink-3">
						Data jsou obyčejné soubory v téhle složce — přesouvá se ve Finderu a appce se pak ukáže znovu
						přes „Změnit složku…". Import přijímá PDF s vloženým ISDOC, doplní odběratele a přeskočí již
						evidovaná čísla faktur. Logo se ukládá jako logo.png do datové složky a cestuje s daty.
					</p>
					<p v-if="vaultPath" class="hint mb-3 break-all" data-testid="vault-path">
						{{ vaultPath }}
					</p>
					<VaultEmptyState v-else class="mb-3" />
					<UAlert
						v-if="logoUnreadable"
						class="mb-3"
						color="warning"
						variant="subtle"
						icon="i-lucide-image-off"
						title="Logo nejde přečíst"
						description="Soubor logo.png v datové složce je poškozený, není to obrázek PNG, nebo ho iCloud na tenhle Mac nestáhl. Faktury proto vycházejí bez loga, dokud ho nenastavíš znovu nebo neodebereš."
						data-testid="logo-warning" />

					<div v-if="vaultPath" class="flex flex-wrap gap-2">
						<UButton
							color="neutral"
							variant="ghost"
							icon="i-lucide-folder-cog"
							data-testid="vault-change"
							@click="onChange">
							Změnit složku…
						</UButton>
						<UButton
							color="neutral"
							variant="ghost"
							icon="i-lucide-folder-open"
							data-testid="vault-reveal"
							@click="openInFinder">
							Otevřít ve Finderu
						</UButton>
						<UButton
							color="neutral"
							variant="ghost"
							icon="i-lucide-file-down"
							loading-auto
							data-testid="import-documents"
							@click="onImport">
							Importovat faktury…
						</UButton>
						<UButton
							color="neutral"
							variant="ghost"
							icon="i-lucide-image"
							data-testid="logo-set"
							@click="onLogo">
							<template v-if="hasLogo">Změnit logo…</template>
							<template v-else>Nastavit logo…</template>
						</UButton>
						<UButton
							v-if="hasLogo"
							variant="ghost"
							color="error"
							icon="i-lucide-image-off"
							data-testid="logo-remove"
							@click="onRemoveLogo">
							Odebrat logo
						</UButton>
					</div>
					<p v-if="vaultMsg" class="hint mt-2 text-accent!" data-testid="vault-message">
						{{ vaultMsg }}
					</p>
					<ul v-if="importDetail.length" class="mt-2 list-disc pl-5 text-meta leading-normal text-ink-2">
						<li v-for="d in importDetail" :key="d">
							{{ d }}
						</li>
					</ul>
				</section>

				<SettingsSnapshots v-if="vaultPath" />

				<section class="card">
					<h2 class="section-title">O aplikaci</h2>
					<p class="mb-2 text-meta text-ink-2 tabular-nums">Fakturian · Verze {{ appVersion }}</p>
					<p class="hint">
						Zdrojový kód Fakturianu je veřejný. Licence
						<UButton
							variant="ghost"
							color="neutral"
							class="row-link cursor-pointer text-accent underline"
							data-testid="about-license"
							@click="open(LICENSE_URL)">
							FSL-1.1-MIT
						</UButton>
						dovoluje ho používat, studovat i měnit, jen ne prodávat jako konkurenční produkt; každá verze po
						dvou letech přechází na licenci MIT. Poskytuje se
						<strong>bez jakékoli záruky</strong>
						v rozsahu, který připouští zákon.
					</p>
					<p class="hint mt-2">
						Zdrojový kód:
						<UButton
							variant="ghost"
							color="neutral"
							class="row-link cursor-pointer text-accent underline"
							data-testid="about-source"
							@click="open(SOURCE_URL)">
							{{ SOURCE_URL }}
						</UButton>
					</p>
				</section>
			</div>
		</div>

		<footer class="detail-footer">
			<div class="mr-auto min-w-0 flex-1 text-note text-ink-3" data-testid="statusbar">
				<span
					v-if="vaultPath"
					class="selectable block truncate"
					:title="vaultPath"
					data-testid="statusbar-vault">
					{{ vaultPath }}
				</span>
				<span v-else>Bez datové složky</span>
				<StatusbarFeedback :status="status.message">
					<span v-if="saved" class="text-accent">Uloženo</span>
				</StatusbarFeedback>
			</div>
			<UButton
				v-if="vaultPath"
				variant="create"
				class="ml-auto"
				trailing-icon="i-lucide-save"
				type="submit"
				:loading="loading"
				data-save
				data-testid="settings-save">
				Uložit údaje
			</UButton>
		</footer>

		<InvoicePreviewDialog v-if="designPreview" :pages="designPreview" @close="designPreview = null" />
	</UForm>
</template>

<style>
@reference '~/assets/css/main.css';

.settings-editor .section-title {
	@apply text-ui font-medium tracking-normal text-ink normal-case;
}
</style>
