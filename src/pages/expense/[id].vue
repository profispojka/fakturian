<script setup lang="ts">
import {
	emptyExpense,
	expenseFormSchema,
	type ExpenseForm,
	type Expense,
	type ValidExpenseForm,
} from '~/schemas/expenses';
import { systemServices } from '~/services/system';
import { MIN_DATE, MAX_DATE } from '~/utils/date';

import type { FormSubmitEvent } from '@nuxt/ui';

definePageMeta({ alias: ['/expense/new'] });

const { expenses, loaded, upsert, documentPath } = useExpenses();
const router = useRouter();

const id = useRouteId();

const { form, reset } = useForm<ExpenseForm>(() => emptyExpense());
const expenseDate = useDateModel(form, 'date');
const status = usePageStatus();
const missing = ref(false);

// Celý objekt se vymění, nedoplňuje po klíčích: nepovinná pole v novém výdaji chybí, takže by po
// předchozím zůstala viset příloha.
function fill(e: ExpenseForm) {
	reset(e);
	status.clear();
}

function startNew() {
	fill(emptyExpense());
	missing.value = false;
}

/** `''` nový výdaj, jinak `id`; `null` = zatím nic. */
const shown = ref<string | null>(null);

function syncFromRoute() {
	if (shown.value === id.value) return;
	if (!id.value) {
		startNew();
		shown.value = '';
		return;
	}
	const found = expenses.value.find((x) => x.id === id.value);
	if (!found) {
		missing.value = loaded.value;
		return;
	}
	fill(found);
	missing.value = false;
	shown.value = id.value;
}
watch([id, expenses, loaded], syncFromRoute, { immediate: true });

async function onSubmit(event: FormSubmitEvent<ValidExpenseForm>) {
	status.clear();
	const e: Expense = {
		...form.value,
		date: event.data.date,
	};

	try {
		await upsert(e);
	} catch (err) {
		status.error('Výdaj se nepodařilo uložit', err);
		return;
	}
	fill(e);
	await router.push('/expense');
}

async function openDocument(file: string) {
	try {
		const path = await documentPath(file);
		await systemServices.revealPath(path);
	} catch (err) {
		status.error('Doklad se nepodařilo ukázat ve Finderu', err);
	}
}
</script>

<template>
	<UForm
		v-slot="{ loading }"
		class="page detail-page"
		data-testid="expense-form"
		:state="form"
		:schema="expenseFormSchema"
		@submit="onSubmit">
		<header class="detail-header" data-drag-region>
			<span
				class="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line-soft bg-card text-ink-2">
				<UIcon name="i-lucide-receipt" class="size-5" />
			</span>
			<h1
				class="flex min-w-0 flex-wrap items-baseline gap-2 text-stat font-semibold tracking-tight text-ink"
				data-testid="expense-title">
				<template v-if="!id">Nový výdaj</template>
				<template v-else>Výdaj</template>
				<span v-if="id && form.supplier" class="text-title font-normal text-ink-3">{{ form.supplier }}</span>
			</h1>
		</header>

		<div class="page-body detail-body selectable">
			<EmptyState v-if="missing">Tenhle výdaj v evidenci není — nejspíš je smazaný.</EmptyState>

			<div v-else class="mx-auto flex w-full max-w-5xl flex-col gap-6">
				<section>
					<h2 class="mb-4 text-ui font-medium text-ink">Údaje výdaje</h2>
					<div class="form-grid">
						<UFormField name="supplier" label="Dodavatel" class="col-span-full">
							<UInput v-model="form.supplier" autofocus data-testid="field-supplier" />
						</UFormField>
						<UFormField name="description" label="Popis" class="col-span-full">
							<UInput v-model="form.description" data-testid="field-description" />
						</UFormField>
						<UFormField name="amountCents" label="Částka (Kč)">
							<MoneyInput v-model="form.amountCents" data-testid="field-amountCzk" />
						</UFormField>
						<UFormField name="date" label="Datum">
							<UInputDate
								v-model="expenseDate"
								:min-value="MIN_DATE"
								:max-value="MAX_DATE"
								data-testid="field-date" />
						</UFormField>
					</div>
				</section>
				<div
					v-if="form.documentFile"
					class="flex min-w-0 flex-wrap items-center gap-3 rounded-2xl border border-line-soft p-4"
					data-testid="expense-document">
					<UIcon name="i-lucide-paperclip" class="size-5 shrink-0 text-ink-3" />
					<span class="min-w-0 flex-1 truncate text-meta text-ink-2">{{ form.documentFile }}</span>
					<UButton
						color="neutral"
						class="rounded-full text-meta!"
						variant="ghost"
						data-testid="expense-document-reveal"
						@click="openDocument(form.documentFile)">
						Ukázat ve Finderu
					</UButton>
				</div>
			</div>
		</div>

		<footer class="detail-footer">
			<div class="mr-auto min-w-0 text-note text-ink-3">
				<div class="flex flex-wrap items-baseline gap-3">
					<Money :cents="form.amountCents" class="text-stat font-semibold text-ink" />
					<span>{{ !id ? 'Nový výdaj' : 'Úprava výdaje' }}</span>
				</div>
				<StatusbarFeedback :status="status.message" />
			</div>
			<UButton
				variant="create"
				class="ml-auto"
				trailing-icon="i-lucide-save"
				type="submit"
				:loading="loading"
				:disabled="missing"
				data-save
				data-testid="expense-save">
				Uložit
			</UButton>
		</footer>
	</UForm>
</template>
