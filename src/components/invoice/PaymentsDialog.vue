<script setup lang="ts">
import { paymentFormSchema, type ReceivedPayment } from '~/schemas/payments';
import { formatDate, MIN_DATE, MAX_DATE, today } from '~/utils/date';

import type { InvoiceSummary } from '~/schemas/invoices';
import type { DateString } from '~/utils/date';
import type { Settlement } from '~/utils/payments';

const props = defineProps<{
	invoice: InvoiceSummary;
	payments: ReceivedPayment[];
	settlement: Settlement;
	saving: boolean;
}>();
const emit = defineEmits<{ record: [payment: ReceivedPayment]; remove: [id: string]; close: [] }>();

// Zbytek k úhradě a dnešek v okamžiku otevření: úhrada celé faktury je tak jedno potvrzení.
const draft = ref<{ id: string; date?: DateString; amountCents: number }>({
	id: crypto.randomUUID(),
	date: today(),
	amountCents: Math.abs(props.settlement.outstandingCents),
});
const draftDate = useDateModel(draft, 'date');
</script>

<template>
	<UModal :open="true" :dismissible="!saving" :close="!saving" @update:open="emit('close')">
		<template v-if="!saving" #close="{ ui }">
			<UButton
				variant="ghost"
				color="neutral"
				icon="i-lucide-x"
				aria-label="Zavřít"
				:class="ui.close()"
				data-testid="payments-close" />
		</template>
		<template #title>
			<span data-testid="payments-heading">Platby faktury {{ invoice.number }}</span>
		</template>
		<template #body>
			<dl class="figures--compact mb-4">
				<div>
					<dt class="text-ink-2">Částka dokladu</dt>
					<dd class="text-ink"><Money :cents="invoice.totalCents" /></dd>
				</div>
				<div>
					<dt class="text-ink-2">Uhrazeno</dt>
					<dd class="text-ink" data-testid="payments-paid"><Money :cents="settlement.paidCents" /></dd>
				</div>
				<div v-if="settlement.overpaidCents > 0">
					<dt class="text-ink-2">Přeplatek</dt>
					<dd class="text-warn" data-testid="payments-overpaid">
						<Money :cents="settlement.overpaidCents" />
					</dd>
				</div>
				<div v-else>
					<dt class="text-ink-2">Zbývá</dt>
					<dd class="text-ink" data-testid="payments-outstanding">
						<Money :cents="settlement.outstandingCents" />
					</dd>
				</div>
			</dl>

			<ul v-if="payments.length" class="mb-3 divide-y divide-line-soft">
				<li
					v-for="(p, index) in payments"
					:key="p.id"
					class="flex min-h-9 items-center gap-3 text-ui"
					data-testid="payment-row">
					<span class="text-ink-2 tabular-nums">{{ formatDate(p.date) }}</span>
					<UBadge v-if="p.fioId" variant="soft" color="neutral" data-testid="payment-fio">Fio</UBadge>
					<Money :cents="p.amountCents" class="ml-auto text-ink" />
					<!-- Pohyb z Fia by příští synchronizace zapsala znovu, smazání by nic nezměnilo. -->
					<UButton
						v-if="!p.fioId"
						size="xs"
						variant="ghost"
						color="neutral"
						icon="i-lucide-x"
						:disabled="saving"
						:aria-label="`Smazat platbu z ${formatDate(p.date)}`"
						:data-testid="`payment-remove-${index}`"
						@click="emit('remove', p.id)" />
				</li>
			</ul>

			<UForm
				:schema="paymentFormSchema"
				:state="draft"
				class="flex flex-wrap items-start gap-3"
				@submit="emit('record', $event.data)">
				<UFormField name="amountCents" label="Částka (Kč)">
					<MoneyInput v-model="draft.amountCents" data-testid="field-amountCents" />
				</UFormField>
				<UFormField name="date" label="Datum úhrady">
					<UInputDate
						v-model="draftDate"
						:min-value="MIN_DATE"
						:max-value="MAX_DATE"
						data-testid="field-date" />
				</UFormField>
				<UButton type="submit" class="mt-6" :loading="saving" data-testid="payment-record">
					Zapsat platbu
				</UButton>
			</UForm>
		</template>
	</UModal>
</template>
