<script setup lang="ts">
import { FURTHER_FORMS, LOOKS_LIKE_FORMS } from '~/constants/locales';
import {
	emptySupplier,
	type Supplier,
	supplierReadyForInvoicing,
	supplierSchema,
	type ValidSupplier,
} from '~/schemas/suppliers';
import { systemServices } from '~/services/system';
import { today, yearOf } from '~/utils/date';
import { errorText } from '~/utils/errors';
import { czechPlural, formatCount } from '~/utils/locales';
import { formatNumber, parseSeq, templateOf } from '~/utils/numbering';
import { isValidIco } from '~/utils/validators';

import type { FormSubmitEvent } from '@nuxt/ui';
import type { AresParty } from '~/schemas/ares';

const open = useState<boolean>('vaultWizardOpen', () => false);
const { vaultPath, defaultVaultPath, setVault, pickVault } = useVault();
const { load } = useVaultData();
const { refresh: refreshMenuStats } = useMenuStats();
const { supplier, setSupplier } = useSettings();
const { scan: adoptScan, refresh: refreshAdopt, adopt } = useAdopt();
const { nextNumber } = useInvoices();
const ares = useAres();

const step = ref<'ico' | 'choice' | 'adopt' | 'supplier' | 'done'>('ico');
const defaultPath = ref('');
// Zvlášť od `error`: ten se při přechodu na volbu složky maže a důvod zamčené volby by zmizel.
const defaultPathError = ref('');
const home = ref('');
const busy = ref(false);
const error = ref('');

const ico = ref('');
const found = ref<AresParty | null>(null);
let lastLookupIco = '';

const form = ref<Supplier>(emptySupplier());

const nextInvoiceNumber = ref('');
const nextNumberError = ref('');

// Otáčí se jen poslední číslice; šablona smí končit i písmenem a to stojí.
const rolled = computed(() => {
	const number = nextInvoiceNumber.value;
	const last = number.slice(-1);
	if (!/\d/.test(last)) {
		return {
			head: number,
			digit: null,
		};
	}
	return {
		head: number.slice(0, -1),
		digit: Number(last),
	};
});

const followingNumbers = computed(() => {
	const template = templateOf(supplier.value);
	const year = yearOf(today());
	const seq = parseSeq(template, year, nextInvoiceNumber.value);
	if (seq === null) return [];
	return [1, 2].map((offset) => formatNumber(template, year, seq + offset));
});

const ADOPT_PREVIEW = 5;

const adoptCandidates = computed(() => adoptScan.value?.candidates ?? []);
const adoptCount = computed(() => adoptCandidates.value.length);

const typedIco = computed(() => ico.value.replace(/\s+/g, ''));
const icoReady = computed(() => isValidIco(typedIco.value) && !ares.loading.value);

function updateIco(value: string) {
	ico.value = value;
	if (typedIco.value === lastLookupIco) return;
	found.value = null;
	lastLookupIco = isValidIco(typedIco.value) ? typedIco.value : '';
	if (lastLookupIco) void aresFill(lastLookupIco);
}

async function aresFill(asked: string) {
	const company = await ares.lookup(asked);
	// Odpověď na IČO, které mezitím uživatel přepsal, by do formuláře vnesla cizí firmu.
	if (asked === lastLookupIco) found.value = company;
}

const mustFinish = computed(() => !vaultPath.value || !supplierReadyForInvoicing(supplier.value));

const stage = computed(() => {
	if (step.value === 'done') return 3;
	if (step.value === 'supplier') return 2;
	if (step.value === 'ico') return 0;
	return 1;
});

function pretty(path: string | null): string {
	if (!path) return '';
	const h = home.value.replace(/\/$/, '');
	if (h && path.startsWith(h)) return `~${path.slice(h.length)}`;
	return path;
}

// Se zakázaným tlačítkem prohlížeč formulář neodešle ani Enterem, takže IČO je tady vždy platné.
function continueFromIco() {
	if (vaultPath.value) {
		afterVaultStep();
	} else {
		error.value = '';
		step.value = 'choice';
	}
}

async function afterVaultPicked() {
	const scan = await refreshAdopt();
	if (scan?.candidates.length) {
		error.value = '';
		step.value = 'adopt';
	} else {
		afterVaultStep();
	}
}

async function onAdopt() {
	const scan = adoptScan.value;
	if (busy.value || !scan) return;
	busy.value = true;
	error.value = '';
	try {
		await adopt(scan);
		await load();
		await refreshMenuStats();
		afterVaultStep();
	} catch (e) {
		error.value = `Doklady se nepodařilo převzít: ${errorText(e)}`;
	} finally {
		busy.value = false;
	}
}

function afterVaultStep() {
	error.value = '';
	// Složka s dodavatelem jiného IČO nekončí: napsané IČO by tiše propadlo a fakturovalo se za cizí firmu.
	if (supplierReadyForInvoicing(supplier.value) && supplier.value?.ico === typedIco.value) {
		finish();
		return;
	}
	// Uložený dodavatel nese i to, co průvodce neukazuje (číslování, vzhled), takže je základem formuláře.
	const stored = {
		...emptySupplier(),
		...structuredClone(toRaw(supplier.value)),
	};
	const company = structuredClone(toRaw(found.value));
	form.value = {
		...stored,
		// Vyjmenovaně, ne rozprostřením: DIČ z ARES do dodavatele nepatří, neplátce ho na faktuře neuvádí.
		...(company && {
			name: company.name,
			address: company.address,
		}),
		ico: ico.value,
		// Firma, u které ARES zápis nezná, nesmí smazat ten, který si dodavatel už vyplnil.
		registration: company?.registration || stored.registration,
	};
	step.value = 'supplier';
}

function finish() {
	step.value = 'done';
	void showNextNumber();
}

async function showNextNumber() {
	nextInvoiceNumber.value = '';
	nextNumberError.value = '';
	try {
		nextInvoiceNumber.value = await nextNumber();
	} catch (e) {
		nextNumberError.value = `Příští číslo faktury se nepodařilo zjistit: ${errorText(e)}`;
	}
}

async function prepareOpen() {
	error.value = '';
	defaultPathError.value = '';
	try {
		home.value = await systemServices.homeDir();
		defaultPath.value = await defaultVaultPath();
	} catch (e) {
		defaultPath.value = '';
		defaultPathError.value = `Doporučenou složku se nepodařilo zjistit: ${errorText(e)}`;
	}
	ico.value = supplier.value?.ico ?? '';
	found.value = null;
	lastLookupIco = '';
	if (vaultPath.value && supplierReadyForInvoicing(supplier.value)) {
		finish();
	} else {
		step.value = 'ico';
	}
}

async function useDefault() {
	if (busy.value || !defaultPath.value) return;
	busy.value = true;
	error.value = '';
	try {
		await setVault(defaultPath.value);
		await load();
		await refreshMenuStats();
		await afterVaultPicked();
	} catch (e) {
		error.value = `Složku se nepodařilo vytvořit: ${errorText(e)}`;
	} finally {
		busy.value = false;
	}
}

async function pickCustom() {
	if (busy.value) return;
	busy.value = true;
	error.value = '';
	try {
		const picked = await pickVault();
		if (picked) {
			await load();
			await refreshMenuStats();
			await afterVaultPicked();
		}
	} catch (e) {
		error.value = `Složku se nepodařilo použít: ${errorText(e)}`;
	} finally {
		busy.value = false;
	}
}

async function onSupplierSubmit(event: FormSubmitEvent<ValidSupplier>) {
	if (busy.value) return;
	busy.value = true;
	error.value = '';
	try {
		await setSupplier({
			...structuredClone(toRaw(form.value)),
			ico: event.data.ico,
		});
		finish();
	} catch (e) {
		error.value = `Údaje se nepodařilo uložit: ${errorText(e)}`;
	} finally {
		busy.value = false;
	}
}
</script>

<template>
	<UModal
		v-model:open="open"
		class="max-h-[calc(100dvh-48px)] max-w-5xl! duration-500 ease-out motion-safe:transition-[height]"
		:class="step === 'adopt' || step === 'supplier' ? 'h-180' : 'h-120'"
		:dismissible="!mustFinish && !busy"
		:close="false"
		title="Nastavení datové složky"
		description="Výběr složky a fakturačních údajů"
		:ui="{
			content: 'overflow-hidden',
			body: 'min-h-0 p-0!',
			header: 'sr-only',
		}"
		@enter="prepareOpen">
		<template #body>
			<div class="welcome" data-testid="wizard">
				<aside class="welcome-side" data-drag-region>
					<div class="h-(--topbar) shrink-0" data-drag-region />
					<div class="welcome-side-body">
						<div
							class="mb-5 flex size-12 items-center justify-center rounded-2xl border border-line bg-card/50 text-accent">
							<UIcon name="i-lucide-folder-open" class="size-6" />
						</div>
						<p class="text-meta font-medium text-ink-3">Fakturian</p>
						<template v-if="step === 'ico'">
							<h2 class="welcome-title" data-testid="wizard-heading">Vítej ve Fakturianu</h2>
							<p class="welcome-lead">
								Začneme tvým IČO — jméno a adresu k němu dohledáme v registru ARES.
							</p>
						</template>
						<template v-else-if="step === 'choice'">
							<h2 class="welcome-title" data-testid="wizard-heading">Kam ukládat data</h2>
							<p class="welcome-lead">
								Faktury, odběratelé i ceník se ukládají lokálně do jedné datové složky. Žádný cloud —
								data máš plně pod kontrolou.
							</p>
						</template>
						<template v-else-if="step === 'adopt'">
							<h2 class="welcome-title" data-testid="wizard-heading">Ve složce už doklady jsou</h2>
							<p class="welcome-lead">
								Našel jsem {{ formatCount(adoptCount, 'document') }},
								{{ czechPlural(adoptCount, LOOKS_LIKE_FORMS) }} jako tvoje vydané faktury.
							</p>
						</template>
						<template v-else-if="step === 'supplier'">
							<h2 class="welcome-title" data-testid="wizard-heading">Tvoje fakturační údaje</h2>
							<p class="welcome-lead">
								Jméno, adresa a účet stojí na každé faktuře. IBAN, e-mail a splatnost doplníš potom v
								Nastavení.
							</p>
						</template>
						<template v-else>
							<div class="motion-safe:animate-sheet-in">
								<h2 class="welcome-title" data-testid="wizard-heading">Hotovo, můžeš fakturovat</h2>
								<p class="welcome-lead">
									Fakturační údaje jsou uložené — kdykoli je upravíš v Nastavení.
								</p>
							</div>
						</template>

						<UStepper
							:items="[{ title: 'IČO' }, { title: 'Datová složka' }, { title: 'Fakturační údaje' }]"
							:model-value="stage"
							orientation="vertical"
							disabled
							class="mt-10"
							:ui="{
								header: 'gap-0',
								item: 'items-center gap-2.5 rounded-xl px-3 py-2 data-[state=active]:bg-row-on',
								trigger:
									'size-4 border border-line bg-transparent text-accent group-data-[state=active]:border-accent group-data-[state=active]:bg-transparent group-data-[state=completed]:border-transparent group-data-[state=completed]:bg-accent-soft group-data-[state=completed]:text-accent',
								separator: 'hidden',
								wrapper: 'mt-0',
								title: 'text-meta! font-normal text-ink-2 group-data-[state=active]:font-medium group-data-[state=active]:text-ink',
							}"
							data-testid="wizard-stages">
							<template #indicator>
								<UIcon
									name="i-lucide-check"
									class="hidden size-2.5 group-data-[state=completed]:block" />
								<span class="hidden size-1.5 rounded-full bg-accent group-data-[state=active]:block" />
							</template>
						</UStepper>
					</div>
				</aside>

				<section class="welcome-main">
					<div class="h-(--topbar) shrink-0" data-drag-region />
					<div
						class="welcome-main-body"
						:data-centered="step === 'ico' || step === 'choice' || undefined"
						data-testid="wizard-main">
						<!-- Ostatní kroky dostanou jméno bez stylů. `:css="false"` by odchod dokončil uprostřed
						vykreslení a `out-in` by pak nový krok nevykreslil. -->
						<Transition :name="step === 'done' ? 'welcome-finish' : 'welcome-step'" mode="out-in">
							<div :key="step" class="welcome-sheet">
								<template v-if="step === 'ico'">
									<form
										class="mx-auto grid w-full max-w-xs gap-4"
										data-testid="wizard-ico-form"
										@submit.prevent="continueFromIco">
										<UFormField name="ico" label="IČO">
											<UInput
												:model-value="ico"
												placeholder="12345678"
												autofocus
												class="w-full tabular-nums"
												data-testid="field-ico"
												@update:model-value="updateIco" />
										</UFormField>

										<p v-if="ares.loading.value" class="hint" data-testid="wizard-ares-loading">
											Hledám v ARES…
										</p>
										<p v-else-if="found" class="welcome-found" data-testid="wizard-ares-found">
											<UIcon name="i-lucide-check" class="size-4 shrink-0" />
											<span class="shrink-0 font-medium">Načteno z ARES</span>
											<span class="min-w-0 truncate text-ink">{{ found.name }}</span>
										</p>
										<FieldError
											v-else-if="ares.error.value"
											:error="`${ares.error.value} — údaje vyplníš ručně v dalším kroku.`"
											data-testid="wizard-error" />

										<UButton
											variant="create"
											type="submit"
											block
											trailing-icon="i-lucide-arrow-right"
											:disabled="!icoReady"
											data-testid="wizard-ico-continue">
											Pokračovat
										</UButton>
									</form>
								</template>

								<template v-else-if="step === 'choice'">
									<div class="grid gap-3">
										<UButton
											variant="ghost"
											color="neutral"
											class="flex items-start gap-3 rounded-2xl border border-line-soft bg-card/40 p-4 text-left text-ink [font:inherit] hover:not-disabled:border-accent hover:not-disabled:bg-row-hover disabled:opacity-60"
											:disabled="busy || !defaultPath"
											data-testid="wizard-recommended"
											@click="useDefault">
											<UIcon
												name="i-lucide-folder-plus"
												class="mt-0.5 size-5 shrink-0 text-accent" />
											<span class="flex min-w-0 flex-col items-start gap-1.5">
												<span class="font-medium text-ink">Použít doporučenou složku</span>
												<span class="text-meta leading-prose text-ink-2">
													Vytvoří se sama v Dokumentech — nemusíš nic hledat.
												</span>
												<code class="welcome-path" data-testid="wizard-recommended-path">
													{{ pretty(defaultPath) || '…' }}
												</code>
											</span>
										</UButton>

										<UButton
											variant="ghost"
											color="neutral"
											class="flex items-start gap-3 rounded-2xl border border-line-soft bg-card/40 p-4 text-left text-ink [font:inherit] hover:not-disabled:border-accent hover:not-disabled:bg-row-hover disabled:opacity-60"
											:disabled="busy"
											data-testid="wizard-custom"
											@click="pickCustom">
											<UIcon
												name="i-lucide-folder-search"
												class="mt-0.5 size-5 shrink-0 text-accent" />
											<span class="flex min-w-0 flex-col items-start gap-1.5">
												<span class="font-medium text-ink">Vybrat vlastní složku…</span>
												<span class="text-meta leading-prose text-ink-2">
													Třeba v iCloud Drive kvůli zálohování. Když v ní už faktury jsou — i
													vystavené jinde — appka je najde a nabídne převzít.
												</span>
											</span>
										</UButton>
									</div>

									<FieldError
										:error="defaultPathError"
										class="mt-4"
										data-testid="wizard-default-path-error" />
									<FieldError :error="error" class="mt-4" data-testid="wizard-error" />
								</template>

								<template v-else-if="step === 'adopt'">
									<p class="hint">
										Převzetím se přesunou do podsložky
										<code class="welcome-path">faktury/</code>
										pod svým číslem a objeví se v přehledu. Fakturační údaje — IČO, adresu i účet —
										si z nich appka přečte sama.
									</p>

									<ul class="mt-5 text-meta">
										<li
											v-for="c in adoptCandidates.slice(0, ADOPT_PREVIEW)"
											:key="c.path"
											class="flex items-baseline justify-between gap-3 border-b border-line-soft py-2 last:border-b-0"
											data-testid="wizard-scan">
											<span>{{ c.number }} · {{ c.customer }}</span>
											<span class="truncate text-ink-2">{{ c.file }}</span>
										</li>
									</ul>
									<p
										v-if="adoptCount > ADOPT_PREVIEW"
										class="mt-4 text-meta leading-prose text-ink-2"
										data-testid="wizard-next">
										…a {{ czechPlural(adoptCount - ADOPT_PREVIEW, FURTHER_FORMS) }}
										{{ adoptCount - ADOPT_PREVIEW }}
									</p>

									<FieldError :error="error" class="mt-4" data-testid="wizard-error" />

									<div class="row mt-6">
										<UButton
											variant="create"
											:loading="busy"
											data-testid="wizard-adopt"
											@click="onAdopt">
											Převzít doklady
										</UButton>
										<UButton
											variant="ghost"
											:disabled="busy"
											data-testid="wizard-not-now"
											@click="afterVaultStep">
											Zatím ne
										</UButton>
									</div>
								</template>

								<template v-else-if="step === 'supplier'">
									<UForm :state="form" :schema="supplierSchema" @submit="onSupplierSubmit">
										<div class="motion-safe:animate-sheet-in">
											<p class="section-label">Kdo fakturuje</p>
											<div class="form-grid mt-3 grid-cols-1!">
												<UFormField name="name" label="Jméno / název">
													<UInput
														v-model="form.name"
														placeholder="Jan Dodavatel"
														data-testid="field-name" />
												</UFormField>
												<UFormField name="address.street" label="Ulice a č.p.">
													<UInput
														v-model="form.address.street"
														data-testid="field-address-street" />
												</UFormField>
												<div class="form-grid form-grid--wide-first">
													<UFormField name="address.city" label="Město">
														<UInput
															v-model="form.address.city"
															data-testid="field-address-city" />
													</UFormField>
													<UFormField name="address.zip" label="PSČ">
														<UInput
															v-model="form.address.zip"
															data-testid="field-address-zip" />
													</UFormField>
												</div>
											</div>

											<p class="section-label mt-6!">Kam ti mají platit</p>
											<div class="form-grid mt-3 grid-cols-1!">
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
											</div>
										</div>

										<FieldError :error="error" class="mt-4" data-testid="wizard-error" />

										<div class="welcome-actions">
											<UTooltip
												text="IBAN, e-mail, splatnost i číslování faktur doladíš potom v Nastavení.">
												<UButton
													variant="create"
													type="submit"
													loading-auto
													:disabled="busy"
													data-testid="wizard-save">
													Uložit a pokračovat
												</UButton>
											</UTooltip>
										</div>
									</UForm>
								</template>

								<template v-else>
									<div
										class="welcome-done"
										:data-long="nextInvoiceNumber.length > 10 || undefined"
										data-testid="wizard-done">
										<p class="eyebrow motion-safe:animate-sheet-in">Příští číslo faktury</p>
										<p class="welcome-number">
											<span class="sr-only" data-testid="wizard-next-number">
												{{ nextInvoiceNumber }}
											</span>
											<span aria-hidden="true" class="inline-flex">
												{{ rolled.head }}
												<span
													v-if="rolled.digit !== null"
													class="welcome-roll"
													:style="{ '--digit': rolled.digit }"
													data-testid="wizard-digit-roll">
													<span v-for="d in 10" :key="d">{{ d - 1 }}</span>
												</span>
											</span>
										</p>
										<p
											v-for="following in followingNumbers"
											:key="following"
											class="welcome-ghost"
											aria-hidden="true"
											data-testid="wizard-following-number">
											{{ following }}
										</p>

										<FieldError :error="nextNumberError" class="mt-4" data-testid="wizard-error" />

										<div class="welcome-done-actions">
											<p class="hint">Šablonu číslování upravíš v Nastavení.</p>
											<UButton
												variant="create"
												trailing-icon="i-lucide-arrow-right"
												data-testid="wizard-start"
												@click="open = false">
												Začít fakturovat
											</UButton>
										</div>
									</div>
								</template>
							</div>
						</Transition>
					</div>
				</section>
			</div>
		</template>
	</UModal>
</template>

<style>
@reference '~/assets/css/main.css';

.welcome {
	@apply grid h-full min-h-0 grid-cols-[14rem_minmax(0,1fr)] wide:grid-cols-[18rem_minmax(0,1fr)];
}

.welcome-side {
	@apply flex min-h-0 flex-col bg-card/30;
}
.welcome-main {
	@apply flex min-h-0 flex-col;
}

.welcome-side-body,
.welcome-main-body {
	@apply min-h-0 flex-1 overflow-y-auto pt-5;
}
.welcome-side-body {
	@apply px-5 pb-8 wide:px-7;
}
.welcome-main-body {
	@apply px-5 wide:px-8;
}
.welcome-main-body[data-centered] {
	@apply flex flex-col justify-center pt-0 pb-(--topbar);
}
.welcome-sheet {
	@apply mx-auto w-full max-w-140;
}

.welcome-title {
	@apply mt-3 text-stat-lg leading-tight font-semibold tracking-tight text-ink;
}
.welcome-lead {
	@apply mt-3 text-ui leading-prose text-ink-2;
}

.welcome-path {
	@apply rounded-micro bg-field px-2 py-1 font-mono text-meta break-all text-ink;
}
.welcome-found {
	@apply flex items-center gap-2 rounded-ctl bg-accent-soft px-3 py-2 text-meta leading-prose text-accent;
}
.welcome-actions {
	@apply sticky bottom-0 mt-8 flex flex-wrap items-center justify-end gap-3 bg-linear-to-t from-palette via-palette/95 to-transparent pt-8 pb-5;
}

.welcome .section-label {
	@apply text-ui font-medium tracking-normal text-ink normal-case;
}

.welcome-number,
.welcome-ghost {
	@apply text-display font-semibold tabular-nums;
}
.welcome-done[data-long] :is(.welcome-number, .welcome-ghost) {
	@apply text-stat-lg;
}
.welcome-number {
	@apply mt-3 whitespace-nowrap text-ink motion-safe:animate-number-rise;
}
.welcome-roll {
	@apply inline-flex h-[1em] flex-col overflow-hidden align-top;
}
.welcome-roll > span {
	@apply h-[1em] motion-safe:animate-digit-roll;
	transform: translateY(calc(var(--digit) * -1em));
}
.welcome-ghost {
	@apply mt-1 text-transparent select-none motion-safe:animate-number-rise;
	-webkit-text-stroke: 1px var(--line);
	animation-delay: 0.12s;
}
.welcome-ghost + .welcome-ghost {
	@apply opacity-50;
	animation-delay: 0.24s;
}
.welcome-done-actions {
	@apply mt-8 flex flex-wrap items-center justify-between gap-3 motion-safe:animate-sheet-in;
	animation-delay: 0.5s;
	animation-fill-mode: both;
}

/* Jen cesta na poslední krok: formulář se rozplyne nahoru, než vyroste příští číslo. */
.welcome-finish-leave-active {
	@apply duration-200 ease-in motion-safe:transition-[opacity,filter,translate];
}
.welcome-finish-leave-to {
	@apply -translate-y-3 opacity-0 blur-sm;
}
</style>
