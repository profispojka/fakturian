<script setup lang="ts">
import { PRICE_ICONS } from '~/constants/icons';
import { emptyPriceItem, priceItemSchema, type PriceItem } from '~/schemas/pricelist';

definePageMeta({ alias: ['/pricelist/new'] });

const { pricelist, loaded, upsert } = usePricelist();
const router = useRouter();
const id = useRouteId();
const { form: item, reset, commit } = useForm<PriceItem>(() => emptyPriceItem());
const status = usePageStatus();
const missing = ref(false);
const shown = ref<string | null>(null);
const iconOpen = ref(false);

function pickIcon(key: string | undefined) {
	item.value.icon = key;
	iconOpen.value = false;
}

function syncFromRoute() {
	if (shown.value === id.value) return;
	if (!id.value) {
		reset(emptyPriceItem());
		missing.value = false;
		shown.value = '';
		return;
	}
	const found = pricelist.value.find((priceItem) => priceItem.id === id.value);
	if (!found) {
		missing.value = loaded.value;
		return;
	}
	reset(found);
	missing.value = false;
	shown.value = id.value;
}

watch([id, pricelist, loaded], syncFromRoute, { immediate: true });

async function save() {
	const value = structuredClone(toRaw(item.value));
	status.clear();
	try {
		await upsert(value);
	} catch (e) {
		status.error('Položku se nepodařilo uložit', e);
		return;
	}
	commit();
	await router.push('/pricelist');
}
</script>

<template>
	<UForm v-slot="{ loading }" class="page detail-page" :state="item" :schema="priceItemSchema" @submit="save">
		<header class="detail-header" data-drag-region>
			<UPopover
				v-model:open="iconOpen"
				:content="{ align: 'start', sideOffset: 8 }"
				:ui="{ content: 'rounded-3xl border border-line bg-card/85 ring-0 backdrop-blur-2xl' }">
				<UButton
					variant="ghost"
					color="neutral"
					class="size-10 shrink-0 justify-center rounded-xl border border-line-soft bg-card text-ink-2"
					:icon="item.icon || 'i-lucide-tag'"
					:data-icon="item.icon || 'i-lucide-tag'"
					:ui="{ leadingIcon: 'size-5' }"
					aria-label="Změnit ikonku"
					title="Změnit ikonku"
					data-testid="price-icon-trigger" />
				<template #content>
					<div class="w-72 p-3" data-testid="price-icon-picker">
						<p class="mb-3 px-1 text-meta text-ink-3">Ikonka — jen v appce, na doklad nejde.</p>
						<div class="grid grid-cols-6 gap-1">
							<UButton
								v-for="icon in PRICE_ICONS"
								:key="icon.key"
								variant="ghost"
								color="neutral"
								class="size-10 justify-center rounded-xl text-ink-2 data-selected:bg-row-on data-selected:text-ink"
								:icon="icon.key"
								:aria-label="icon.label"
								:title="icon.label"
								:data-selected="item.icon === icon.key || undefined"
								:aria-pressed="item.icon === icon.key"
								:data-testid="`price-icon-${icon.key}`"
								@click="pickIcon(icon.key)" />
						</div>
						<UButton
							variant="ghost"
							color="neutral"
							class="mt-3 h-9 w-full justify-center rounded-full border border-line text-meta! data-selected:bg-row-on"
							:data-selected="!item.icon || undefined"
							:aria-pressed="!item.icon"
							data-testid="price-icon-none"
							@click="pickIcon(undefined)">
							Bez ikony
						</UButton>
					</div>
				</template>
			</UPopover>
			<h1
				class="flex min-w-0 flex-wrap items-baseline gap-2 text-stat font-semibold tracking-tight text-ink"
				data-testid="price-page-title">
				<template v-if="!id">Nová položka ceníku</template>
				<template v-else>Upravit položku ceníku</template>
			</h1>
		</header>

		<div class="page-body detail-body selectable">
			<EmptyState v-if="missing">Tahle položka v ceníku není — nejspíš je smazaná.</EmptyState>
			<template v-else>
				<div class="mx-auto w-full max-w-5xl" data-testid="price-fields">
					<div class="form-grid">
						<UFormField
							name="name"
							label="Název"
							hint="uvidí ho odběratel na dokladu"
							class="col-span-full">
							<UInput v-model="item.name" data-testid="field-name" autofocus />
						</UFormField>
						<UFormField
							name="note"
							label="Poznámka"
							hint="interní, odběratel ji nevidí"
							class="col-span-full">
							<UInput v-model.optional="item.note" data-testid="field-note" />
						</UFormField>
						<UFormField name="priceCents" label="Cena za jednotku (Kč)">
							<MoneyInput v-model="item.priceCents" data-testid="field-price" />
						</UFormField>
						<UFormField name="unit" label="Jednotka">
							<UInput v-model="item.unit" data-testid="field-unit" placeholder="ks / hod" />
						</UFormField>
						<UFormField
							name="annualLimit"
							label="Roční limit"
							description="prázdné = neomezeně"
							data-testid="annual-limit-field">
							<UInputNumber
								v-model.optional="item.annualLimit"
								:format-options="{ maximumFractionDigits: 2 }"
								:step-snapping="false"
								:increment="false"
								:decrement="false"
								disable-wheel-change
								data-testid="field-annualLimit" />
						</UFormField>
					</div>
				</div>
			</template>
		</div>

		<footer class="detail-footer">
			<div class="mr-auto min-w-0 text-note text-ink-3">
				<div class="flex flex-wrap items-baseline gap-3">
					<Money :cents="item.priceCents" class="text-stat font-semibold text-ink" />
					<span v-if="item.unit.trim()" data-testid="price-unit">/ {{ item.unit }}</span>
				</div>
				<StatusbarFeedback :status="status.message" />
			</div>
			<div class="ml-auto flex shrink-0 items-center gap-2">
				<UButton
					variant="ghost"
					color="neutral"
					class="rounded-full px-3 text-meta!"
					data-testid="price-cancel"
					:disabled="loading || missing"
					to="/pricelist">
					Zrušit
				</UButton>
				<UButton
					variant="create"
					trailing-icon="i-lucide-save"
					type="submit"
					:loading="loading"
					:disabled="missing"
					data-save
					data-testid="price-save">
					Uložit
				</UButton>
			</div>
		</footer>
	</UForm>
</template>
