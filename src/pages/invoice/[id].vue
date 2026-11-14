<script setup lang="ts">
import { useTimeoutFn, whenever } from '@vueuse/core';

import { DocumentKind } from '~/constants/invoice';
import { emptyLine, emptyParty, newInvoice, invoiceSchema } from '~/schemas/invoices';
import {
	yearOf,
	today,
	addDays,
	daysBetween,
	formatDate,
	fromCalendarDate,
	toCalendarDate,
	MIN_DATE,
	MAX_DATE,
	MIN_YEAR,
	MAX_YEAR,
} from '~/utils/date';
import { contactToParty, creditTargetOf, invoiceTotalCents, lineTotalCents, variableSymbolFor } from '~/utils/invoice';
import { formatCount } from '~/utils/locales';
import { defaultInvoiceMail } from '~/utils/mail';
import { templateOf } from '~/utils/numbering';
import { formatAmount, hasLimit, itemForLine, itemLabel, recordsFor } from '~/utils/pricelist';

import type { FormErrorEvent, TableColumn } from '@nuxt/ui';
import type { Contact } from '~/schemas/customers';
import type { Invoice, InvoiceLine, InvoiceParty } from '~/schemas/invoices';
import type { PriceItem } from '~/schemas/pricelist';

definePageMeta({
	alias: ['/invoice/new'],
	// Bez pevného klíče Nuxt po přepisu adresy z `/invoice/new` na číslo dokladu stránku vytvoří
	// znovu a otázka na e-mail i hláška „Uloženo" zmizí se starou instancí.
	key: 'invoice',
});

interface InvoiceLineRow {
	line: InvoiceLine;
	badge: { label: string; icon: string | undefined } | null;
}

const { supplier } = useSettings();
const { contacts, upsert: upsertContact } = useContacts();
const { archive, pricelist, overflows: limitOverflows, remainingOn: remainingInLimit, refreshUsage } = usePricelist();
const { nextNumber, save, preview, load, archived, pendingInvoice, markSent, askRemove } = useInvoices();
const { emailWithAttachment } = useMail();
const { refresh: refreshMenuStats } = useMenuStats();

const savedPath = ref('');
const status = usePageStatus();
const number = useRouteId();
// Router se bere v setupu: `navigateTo()` si kontext Nuxtu hledá až v okamžiku volání a po `await`u
// ho nemusí najít — pak tiše nikam nepřejde a druhé „Uložit" by doklad zapsalo znovu jako nový.
const router = useRouter();
const missing = ref(false);
const sentAt = ref<string | null>(null);
const showEmailModal = ref(false);
const previewing = ref(false);
const previewPages = ref<string[] | null>(null);

const swapping = ref(false);
const bodyEl = ref<HTMLElement | null>(null);
const { start: startSwapTimer, stop: stopSwapTimer } = useTimeoutFn(
	() => {
		swapping.value = false;
	},
	900,
	{ immediate: false },
);

async function playSwap() {
	stopSwapTimer();
	swapping.value = false;
	await nextTick();
	bodyEl.value?.scrollTo({ top: 0 });
	void bodyEl.value?.offsetHeight;
	swapping.value = true;
	startSwapTimer();
}

function forgetPending() {
	pendingInvoice.value = null;
}

const {
	form: inv,
	reset,
	commit,
	dirty,
	mayDiscard,
} = useForm<Invoice>(() => newInvoice(supplier.value, ''), {
	afterConfirm: (confirmed, exit) => {
		if (!confirmed && exit === 'update') forgetPending();
	},
});

async function startNew() {
	if (number.value) {
		await router.push('/invoice/new');
		return;
	}
	const may = await mayDiscard('new');
	if (!may) return;
	await initNew();
	await playSwap();
}

// Zbývající množství se počítá bez vlastního záznamu téhle faktury, jinak by si hláška a blokace
// protiřečily při editaci už vystaveného dokladu.
const invoiceContext = computed(() => ({
	limitOverflows: limitOverflows(inv.value),
	...(!number.value && { numberTemplate: templateOf(supplier.value) }),
	creditTarget: creditTargetOf(inv.value, archive.value),
}));

const schema = computed(() => invoiceSchema(invoiceContext.value));

async function initNew() {
	savedPath.value = '';
	status.clear();
	// Předvyplněný doklad patří k předchozímu otevření stránky; kdyby zůstal viset, příští „Nová
	// faktura" by místo čistého listu otevřela cizí doklad.
	forgetPending();
	try {
		const assigned = await nextNumber();
		// Pozdní odpověď by přepsala doklad, na který adresa mezitím přešla.
		if (number.value) return;
		reset(newInvoice(supplier.value, assigned));
	} catch (e) {
		if (number.value) return;
		// Nejčastěji vadná šablona číselné řady — bez hlášky by stránka tiše nic neudělala.
		reset(newInvoice(supplier.value, ''));
		status.error('Nepodařilo se přidělit číslo faktury', e);
	}
}

/** `''` nový doklad, jinak číslo; `null` = zatím nic. */
const shown = ref<string | null>(null);

async function openFromRoute() {
	if (shown.value === number.value) return;
	const swap = shown.value !== null;
	shown.value = number.value;
	missing.value = false;
	sentAt.value = null;
	// Vyzvedne se a hned zahodí, ještě před `await`: po selhání níž by zůstal viset a každé další
	// otevření stránky by zopakovalo týž pád.
	const prepared = pendingInvoice.value;
	forgetPending();
	try {
		await refreshUsage();
		if (!number.value) {
			if (prepared) {
				savedPath.value = '';
				status.clear();
				reset(prepared);
			} else {
				await initNew();
			}
		} else {
			const invoices = await archived();
			const summary = invoices.find((i) => i.number === number.value);
			if (!summary) {
				missing.value = true;
				return;
			}
			sentAt.value = summary.sentAt;
			const stored = await load(summary.number);
			// Pozdní odpověď by přepsala doklad, na který adresa mezitím přešla.
			if (number.value !== summary.number) return;
			savedPath.value = '';
			status.clear();
			reset(stored);
		}
	} catch (e) {
		// Bez hlášky by tu stál formulář s prázdným číslem a „Zobrazit" by poslalo do backendu prázdný
		// doklad.
		status.error('Fakturu se nepodařilo otevřít', e);
		return;
	}
	if (swap) await playSwap();
}

watch(number, openFromRoute, { immediate: true });

whenever(supplier, (s) => {
	// Jen otisk dodavatele — přepsat celou fakturu by zahodilo rozdělané položky. Bankovní spojení
	// k otisku patří, bez něj by doklad odešel bez účtu a bez QR.
	if (number.value || inv.value.supplier.name) return;
	const wasPristine = !dirty.value;
	const fingerprint = newInvoice(s, inv.value.number);
	inv.value.bankAccount = fingerprint.bankAccount;
	inv.value.bankCode = fingerprint.bankCode;
	inv.value.iban = fingerprint.iban;
	inv.value.supplier = {
		...inv.value.supplier,
		...fingerprint.supplier,
	};
	// Doplnění fakturačních údajů není práce uživatele — jako neuložená změna by se appka ptala i nad
	// formulářem, do kterého nikdo nesáhl.
	if (wasPristine) commit();
});

const calendarPrevious = {
	icon: 'i-lucide-chevron-left',
	'data-testid': 'date-month-prev',
};
const calendarNext = {
	icon: 'i-lucide-chevron-right',
	'data-testid': 'date-month-next',
};
const issueDate = useDateModel(inv, 'issueDate');
const dueDate = useDateModel(inv, 'dueDate');
// Formuláře, kde splatnost nastavil uživatel sám. `reset()` dá formuláři nový objekt, takže se nemaže.
const ownDueDate = new WeakSet<Invoice>();

const dateFields = reactive([
	{
		name: 'issueDate',
		label: 'Datum vystavení',
		open: false,
		model: computed({
			get: () => issueDate.value,
			set: (selected: typeof issueDate.value) => {
				const before = inv.value.issueDate;
				issueDate.value = selected;
				// Nový doklad drží lhůtu splatnosti; u vystaveného by posun potichu změnil, co už odešlo.
				if (number.value || !inv.value.dueDate || ownDueDate.has(inv.value)) return;
				inv.value.dueDate = addDays(inv.value.dueDate, daysBetween(before, inv.value.issueDate));
			},
		}),
	},
	{
		name: 'dueDate',
		label: 'Datum splatnosti',
		open: false,
		model: computed({
			get: () => dueDate.value,
			set: (selected: typeof dueDate.value) => {
				ownDueDate.add(inv.value);
				dueDate.value = selected;
			},
		}),
	},
]);

const showContactPicker = ref(false);

function openContactPicker() {
	showContactPicker.value = true;
}
function pickContact(c: Contact) {
	inv.value.customer = contactToParty(c);
	showContactPicker.value = false;
}
function clearCustomer() {
	inv.value.customer = emptyParty();
}

// Čárka jako text za `<template>` by po formátování (`htmlWhitespaceSensitivity: ignore`) vyšla s mezerou.
function addressLine(address: InvoiceParty['address']): string {
	const place = [address.city, address.zip].filter(Boolean).join(' ');
	return [address.street, place].filter(Boolean).join(', ');
}

const showCustomerDialog = ref(false);

function openCustomerDialog() {
	showCustomerDialog.value = true;
}

async function applyCustomer(entered: Contact, remember: boolean) {
	// Zápis v obchodním rejstříku dialog neukazuje, takže úprava nesmí zahodit ten z importovaného dokladu.
	inv.value.customer = {
		...contactToParty(entered),
		registration: inv.value.customer.registration,
	};
	if (!remember) return;
	try {
		await upsertContact(entered);
	} catch (e) {
		status.error('Odběratele se nepodařilo uložit do Odběratelů', e);
	}
}

const showPricePicker = ref(false);

function openPricePicker() {
	showPricePicker.value = true;
}

function addFromPricelist(p: PriceItem) {
	// Dobropis vrací peníze, takže jeho řádky jsou záporné — kladná cena z ceníku by z něj udělala
	// druhou fakturu.
	let unitPriceCents = p.priceCents;
	if (inv.value.documentType === DocumentKind.CreditNote) unitPriceCents = -Math.abs(p.priceCents);
	inv.value.lines.push({
		id: crypto.randomUUID(),
		description: p.name,
		quantity: 1,
		unit: p.unit,
		unitPriceCents,
		itemId: p.id,
	});
}

// Odznáček jen u položky s ročním stropem, jinak by v tabulce nic nevyčnívalo. Prázdné `icon` proto,
// že `UIcon` bere `name` jako povinný řetězec.
const lineRows = computed<InvoiceLineRow[]>(() =>
	inv.value.lines.map((line) => {
		const item = itemForLine(line, pricelist.value);
		let limited: PriceItem | null = null;
		if (item && hasLimit(item)) limited = item;
		return {
			line,
			badge: limited && {
				label: itemLabel(limited),
				icon: limited.icon,
			},
		};
	}),
);

const limitedOnInvoice = computed(() =>
	recordsFor(inv.value, yearOf(inv.value.issueDate)).flatMap((record) => {
		const item = pricelist.value.find((p) => p.id === record.itemId);
		if (!item || !hasLimit(item) || record.quantity <= 0) return [];
		return [
			{
				id: `${item.id}:${record.year}`,
				year: record.year,
				label: itemLabel(item),
				onInvoice: formatAmount(record.quantity, item.unit),
				remaining: formatAmount(remainingInLimit(inv.value, item, record.year), item.unit),
			},
		];
	}),
);

function remainingFor(p: PriceItem): number {
	return remainingInLimit(inv.value, p, yearOf(inv.value.issueDate));
}

function addLine() {
	inv.value.lines.push(emptyLine());
}
function removeLine(i: number) {
	inv.value.lines.splice(i, 1);
}

// Uložení renderuje PDF stovky ms; druhý souběžný render by se zachyceným `wasNew = true` prošel
// kontrolou kolize a mohl zapsat useknuté PDF.
const saving = ref(false);

// Náhled bez validace a ukládání, aby šel vidět dřív než vystavení. Klon modelu proto, že dopočtený
// variabilní symbol by jinak zůstal ve formuláři a doklad by vypadal jako uložený.
async function showPreview() {
	if (previewing.value) return;
	status.clear();
	previewing.value = true;
	try {
		const draft = structuredClone(toRaw(inv.value));

		if (!draft.variableSymbol) draft.variableSymbol = variableSymbolFor(draft.number);
		previewPages.value = await preview(draft);
	} catch (e) {
		status.error('Náhled se nepodařilo otevřít', e);
	} finally {
		previewing.value = false;
	}
}

function dateLabel(value: Parameters<typeof fromCalendarDate>[0]): string {
	const date = fromCalendarDate(value);
	if (date) return formatDate(date);
	return 'Vybrat datum';
}

function onValidationError(event: FormErrorEvent) {
	// Co nespadne ani do jednoho, jde do stavové lišty — jinak by „Uložit" tiše nic neudělalo.
	const hidden = event.errors
		.filter((issue) => !issue.id && !issue.name?.startsWith('lines.'))
		.map((issue) => issue.message);
	if (hidden.length) status.error(hidden.join(' · '));
	else status.error('Zkontroluj zvýrazněná pole formuláře.');
}

async function onSubmit() {
	// Formulář odešle tlačítko, ⌘S i Enter — zamykat se má zápis, ne jeho spouštěč.
	if (saving.value) return;
	// Odběratel už má původní verzi, takže přepsat odeslaný doklad musí být vědomé rozhodnutí.

	if (sentAt.value) {
		const confirmed = await getUserConfirmation(
			`Doklad ${inv.value.number} už byl odeslaný a odběratel má u sebe původní verzi. Opravdu ho chceš upravit?`,
			{
				title: 'Upravit odeslaný doklad?',
				confirmLabel: 'Upravit',
			},
		);
		if (!confirmed) return;
	}
	saving.value = true;
	if (!inv.value.variableSymbol) inv.value.variableSymbol = variableSymbolFor(inv.value.number);
	status.clear();
	try {
		const wasNew = !number.value;
		savedPath.value = await save(inv.value, wasNew);
		// Uložený doklad už není rozepsaný a hlídka nesmí zdržet přepis adresy níž.
		commit();
		// Od téhle chvíle doklad pojmenovává adresa. Musí se přepsat hned, jinak by druhé „Uložit"
		// spadlo na kolizi čísla.
		if (wasNew) {
			shown.value = inv.value.number;
			await router.replace(`/invoice/${inv.value.number}`);
		}

		// Bez tohohle by panel po vystavení faktury ukazoval stav před ní; čerpání limitů se přepočítá
		// ze stejného čtení archivu.
		await refreshMenuStats();
		status.show('success', 'Uloženo');

		if (wasNew) showEmailModal.value = true;
	} catch (e) {
		status.error('Fakturu se nepodařilo uložit', e);
	} finally {
		saving.value = false;
	}
}

const deleting = ref(false);

async function deleteDocument() {
	deleting.value = true;
	try {
		const deleted = await askRemove(number.value);
		if (!deleted) return;
		// Rozepsané změny zmizely s dokladem; hlídka odchodu by se na ně jinak ptala.
		commit();
		await refreshMenuStats();
		await router.push('/invoice');
	} catch (e) {
		status.error('Doklad se nepodařilo smazat', e);
	} finally {
		deleting.value = false;
	}
}

async function sendEmail() {
	showEmailModal.value = false;
	const { subject, body } = defaultInvoiceMail(inv.value.number, total.value);
	try {
		await emailWithAttachment(inv.value.customer.email, subject, body, savedPath.value);
		sentAt.value = await markSent(inv.value.number);
	} catch (e) {
		status.error('E-mail se nepodařilo připravit', e);
	}
}

const total = computed(() => invoiceTotalCents(inv.value));

watch(dirty, (isDirty) => {
	if (savedPath.value && isDirty) {
		savedPath.value = '';
		status.clear();
	}
});

const lineColumns: TableColumn<InvoiceLineRow>[] = [
	{
		id: 'description',
		header: 'Popis',
		meta: {
			class: {
				td: 'edit',
			},
		},
	},
	{
		id: 'quantity',
		header: 'Množství',
		meta: {
			class: {
				th: 'w-23 text-right',
				td: 'edit',
			},
		},
	},
	{
		id: 'unit',
		header: 'Jednotka',
		meta: {
			class: {
				th: 'w-23',
				td: 'edit',
			},
		},
	},
	{
		id: 'price',
		header: 'Cena/ks',
		meta: {
			class: {
				th: 'w-33 text-right',
				td: 'edit',
			},
		},
	},
	{
		id: 'total',
		header: 'Celkem',
		meta: {
			class: {
				th: 'w-35 text-right',
				td: 'text-right tabular-nums text-ink!',
			},
		},
	},
	{
		id: 'actions',
		header: '',
		meta: {
			class: {
				th: 'w-12',
				td: 'text-center',
			},
		},
	},
];
</script>

<template>
	<UForm
		v-slot="{ loading }"
		:state="inv"
		class="page detail-page invoice-editor"
		:schema="schema"
		data-testid="form"
		@submit="onSubmit"
		@error="onValidationError">
		<header class="detail-header" data-drag-region data-testid="header">
			<span
				class="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line-soft bg-card text-ink-2">
				<UIcon
					:name="
						inv.documentType === DocumentKind.CreditNote ? 'i-lucide-receipt-text' : 'i-lucide-file-text'
					"
					class="size-5" />
			</span>
			<h1
				class="flex min-w-0 flex-wrap items-baseline gap-2 text-stat font-semibold tracking-tight text-ink"
				data-testid="heading">
				{{ inv.documentType === DocumentKind.CreditNote ? 'Dobropis' : 'Faktura' }}
				<span
					class="-mx-1 rounded-micro px-1 py-px data-fresh:motion-safe:animate-number-fresh data-fresh:motion-reduce:bg-accent-soft data-fresh:motion-reduce:text-accent"
					:data-fresh="swapping || undefined"
					data-testid="document-number">
					{{ inv.number }}
				</span>
				<span v-if="inv.documentType === DocumentKind.CreditNote && inv.originalInvoice" class="hint">
					k faktuře {{ inv.originalInvoice }}
				</span>
			</h1>
		</header>

		<div
			ref="bodyEl"
			class="page-body detail-body selectable motion-safe:data-swapping:*:animate-sheet-in"
			:data-swapping="swapping || undefined"
			data-testid="body">
			<EmptyState v-if="missing">Tenhle doklad v evidenci není — nejspíš je smazaný.</EmptyState>

			<div v-else class="mx-auto w-full max-w-5xl" data-testid="invoice-fields">
				<UAlert
					v-if="savedPath"
					icon="i-lucide-check"
					color="primary"
					variant="soft"
					title="Uloženo"
					:description="savedPath"
					:ui="{ description: 'wrap-anywhere text-ink' }"
					data-testid="saved" />
				<section class="card grid grid-cols-1 gap-0 rounded-2xl bg-card/40 p-4 split:grid-cols-2">
					<div class="min-w-0" data-testid="sender">
						<h2 class="section-title">Dodavatel</h2>
						<div
							class="flex min-w-0 flex-col gap-1 text-ink-2 [&_strong]:text-title [&_strong]:font-medium [&_strong]:text-ink">
							<template v-if="inv.supplier.name">
								<strong>{{ inv.supplier.name }}</strong>
								<div v-if="inv.supplier.ico || inv.supplier.dic" class="hint">
									<template v-if="inv.supplier.ico">IČO: {{ inv.supplier.ico }}</template>
									<template v-if="inv.supplier.ico && inv.supplier.dic">·</template>
									<template v-if="inv.supplier.dic">DIČ: {{ inv.supplier.dic }}</template>
								</div>
								<div v-if="inv.supplier.address.street || inv.supplier.address.city" class="hint">
									{{ addressLine(inv.supplier.address) }}
								</div>
								<div v-if="inv.supplier.email" class="hint">
									{{ inv.supplier.email }}
								</div>
							</template>
							<EmptyState v-else>Fakturační údaje zatím nejsou vyplněné.</EmptyState>
						</div>
					</div>

					<div
						class="mt-4 min-w-0 border-t border-line-soft pt-4 split:mt-0 split:ml-6 split:border-t-0 split:border-l split:pt-0 split:pl-6"
						data-testid="customer">
						<h2 class="section-title">Odběratel</h2>
						<UFormField name="customer.name">
							<div v-if="!inv.customer.name" class="row">
								<UButton data-testid="choose-customer" @click="openContactPicker">
									Zvolit odběratele
								</UButton>
								<UButton variant="ghost" data-testid="enter-customer" @click="openCustomerDialog">
									Zadat ručně
								</UButton>
							</div>

							<div v-else class="flex items-start justify-between gap-3" data-testid="customer-summary">
								<div class="flex min-w-0 flex-col gap-1">
									<strong class="text-title font-medium text-ink">{{ inv.customer.name }}</strong>
									<div v-if="inv.customer.ico || inv.customer.dic" class="hint">
										<template v-if="inv.customer.ico">IČO: {{ inv.customer.ico }}</template>
										<template v-if="inv.customer.ico && inv.customer.dic">·</template>
										<template v-if="inv.customer.dic">DIČ: {{ inv.customer.dic }}</template>
									</div>
									<div class="hint">
										{{ addressLine(inv.customer.address) }}
									</div>
									<div v-if="inv.customer.email" class="hint">
										{{ inv.customer.email }}
									</div>
								</div>
								<div class="row">
									<UButton
										size="xs"
										variant="ghost"
										data-testid="edit-customer"
										@click="openCustomerDialog">
										Upravit
									</UButton>
									<UButton
										size="xs"
										variant="ghost"
										data-testid="change-customer"
										@click="openContactPicker">
										Změnit
									</UButton>
									<UButton
										size="xs"
										variant="ghost"
										color="error"
										data-testid="remove-customer"
										@click="clearCustomer">
										Odebrat
									</UButton>
								</div>
							</div>
						</UFormField>
					</div>
				</section>

				<section class="card">
					<h2 class="section-title">Údaje dokladu</h2>
					<div class="form-grid">
						<div class="col-span-full grid grid-cols-2 gap-x-4 gap-y-3">
							<UFormField
								name="number"
								label="Číslo faktury"
								v-bind="number ? { help: 'zamčeno u vystavené faktury' } : {}">
								<UInput v-model="inv.number" :disabled="!!number" data-testid="field-number" />
							</UFormField>
							<UFormField name="variableSymbol" label="Variabilní symbol">
								<UInput v-model="inv.variableSymbol" :placeholder="inv.number" data-testid="field-vs" />
							</UFormField>
						</div>

						<div class="col-span-full grid grid-cols-1 gap-x-4 gap-y-3 split:grid-cols-3">
							<UFormField
								v-for="field in dateFields"
								:key="field.name"
								:name="field.name"
								:label="field.label">
								<UPopover v-model:open="field.open">
									<UButton
										color="neutral"
										variant="subtle"
										class="w-full justify-between"
										trailing-icon="i-lucide-calendar"
										:data-testid="`field-${field.name}`"
										:data-value="fromCalendarDate(field.model)"
										:label="dateLabel(field.model)" />
									<template #content>
										<div class="p-2">
											<UCalendar
												v-model="field.model"
												:min-value="MIN_DATE"
												:max-value="MAX_DATE"
												:week-starts-on="1"
												prevent-deselect
												:prev-month="calendarPrevious"
												:next-month="calendarNext"
												data-testid="date-calendar"
												@update:model-value="field.open = false">
												<template #day="{ day }">
													<span :data-testid="`date-day-${day.toString()}`">
														{{ day.day }}
													</span>
												</template>
											</UCalendar>
											<UButton
												block
												variant="soft"
												:data-testid="`field-${field.name}-today`"
												@click="
													field.model = toCalendarDate(today());
													field.open = false;
												">
												Dnes
											</UButton>
										</div>
									</template>
								</UPopover>
							</UFormField>
						</div>
					</div>
				</section>

				<section class="card">
					<div class="row mb-3 justify-between">
						<h2 class="section-title section-label">Položky</h2>
						<div class="row">
							<UButton
								variant="ghost"
								trailing-icon="i-lucide-list-plus"
								:disabled="!pricelist.length"
								:title="
									pricelist.length ? undefined : 'Ceník je prázdný — položky se zakládají v Ceníku.'
								"
								data-testid="insert-from-pricelist"
								@click="openPricePicker">
								Vložit z ceníku…
							</UButton>
						</div>
					</div>

					<p v-for="l in limitedOnInvoice" :key="l.id" class="hint mb-3" data-testid="limit-watch">
						{{ l.label }} na faktuře: {{ l.onInvoice }} · za {{ l.year }} zbývá {{ l.remaining }}
					</p>

					<div class="items-table">
						<UTable
							:data="lineRows"
							:columns="lineColumns"
							:get-row-id="(row) => row.line.id"
							class="overflow-x-auto"
							data-testid="invoice-items">
							<template
								#description-cell="{
									row: {
										original: { line: l, badge },
										index: i,
									},
								}">
								<div class="relative">
									<UFormField v-slot="{ error }" :name="`lines.${i}.description`" :error="false">
										<UInput
											v-model="l.description"
											variant="none"
											:ui="{ base: badge ? 'cell-input pr-26!' : 'cell-input' }"
											class="w-full"
											data-testid="item-label"
											placeholder="Popis položky"
											:aria-label="`Popis položky ${i + 1}`"
											:title="error" />
									</UFormField>
									<UBadge
										v-if="badge"
										color="primary"
										class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
										data-testid="item-mark">
										<UIcon
											v-if="badge.icon"
											:name="badge.icon"
											class="size-3 shrink-0"
											data-testid="item-mark-icon" />
										{{ badge.label }}
									</UBadge>
								</div>
								<label v-if="badge" class="flex items-center gap-2 px-3 pb-2 text-xs text-ink-2">
									Čerpat z limitu roku
									<UInputNumber
										v-model.optional="l.usageYear"
										variant="none"
										:placeholder="String(yearOf(inv.issueDate))"
										:min="MIN_YEAR"
										:max="MAX_YEAR"
										:format-options="{ useGrouping: false }"
										:increment="false"
										:decrement="false"
										disable-wheel-change
										class="field w-23"
										:data-testid="`item-usage-year-${i}`" />
								</label>
							</template>
							<template
								#quantity-cell="{
									row: {
										original: { line: l },
										index: i,
									},
								}">
								<UFormField v-slot="{ error }" :name="`lines.${i}.quantity`" :error="false">
									<UInputNumber
										v-model="l.quantity"
										:format-options="{ maximumFractionDigits: 2 }"
										:step-snapping="false"
										:increment="false"
										:decrement="false"
										disable-wheel-change
										variant="none"
										:ui="{ base: 'cell-input text-right tabular-nums!' }"
										class="w-full"
										data-testid="item-quantity"
										:aria-label="`Množství u položky ${i + 1}`"
										:title="error" />
								</UFormField>
							</template>
							<template
								#unit-cell="{
									row: {
										original: { line: l },
										index: i,
									},
								}">
								<UFormField v-slot="{ error }" :name="`lines.${i}.unit`" :error="false">
									<UInput
										v-model="l.unit"
										variant="none"
										:ui="{ base: 'cell-input' }"
										class="w-full"
										data-testid="item-unit"
										placeholder="ks"
										:aria-label="`Jednotka u položky ${i + 1}`"
										:title="error" />
								</UFormField>
							</template>
							<template
								#price-cell="{
									row: {
										original: { line: l },
										index: i,
									},
								}">
								<UFormField v-slot="{ error }" :name="`lines.${i}.unitPriceCents`" :error="false">
									<MoneyInput
										v-model="l.unitPriceCents"
										variant="none"
										:ui="{ base: 'cell-input text-right tabular-nums!' }"
										class="w-full"
										data-testid="item-price"
										:aria-label="`Cena za jednotku u položky ${i + 1}`"
										:title="error" />
								</UFormField>
							</template>
							<template
								#total-cell="{
									row: {
										original: { line: l },
										index: i,
									},
								}">
								<Money :cents="lineTotalCents(l)" data-testid="item-total" />
							</template>
							<template
								#actions-cell="{
									row: {
										original: { line: l },
										index: i,
									},
								}">
								<UTooltip text="Odebrat položku">
									<UButton
										size="xs"
										variant="ghost"
										color="error"
										icon="i-lucide-x"
										:disabled="inv.lines.length === 1"
										:aria-label="`Odebrat položku ${i + 1}`"
										:data-testid="`item-remove-${i}`"
										@click="removeLine(i)" />
								</UTooltip>
							</template>
							<template #body-bottom>
								<tr class="add-row">
									<td colspan="6" class="edit">
										<UButton
											variant="ghost"
											color="neutral"
											type="button"
											class="add-line"
											data-testid="add-item"
											@click="addLine">
											<UIcon name="i-lucide-plus" />
											Přidat položku
										</UButton>
									</td>
								</tr>
								<tr
									class="[&>td]:h-13! [&>td]:border-t! [&>td]:border-b-0! [&>td]:border-t-line-soft! [&>td]:bg-card!">
									<td colspan="4" class="text-right text-ink-2">Celkem k úhradě</td>
									<td
										class="text-right text-title! font-semibold text-ink! tabular-nums"
										data-testid="total">
										<Money :cents="total" />
									</td>
									<td></td>
								</tr>
							</template>
						</UTable>
					</div>

					<UFormField name="lines" data-testid="field-lines" />
				</section>

				<section class="card">
					<h2 class="section-title">
						{{ inv.documentType === DocumentKind.CreditNote ? 'Důvod opravy' : 'Poznámka' }}
					</h2>
					<UFormField name="note">
						<UTextarea
							v-model="inv.note"
							:rows="3"
							class="w-full [&_textarea]:w-full"
							:placeholder="
								inv.documentType === DocumentKind.CreditNote
									? 'Proč se faktura opravuje — vrácení, sleva, chyba v položkách'
									: 'Volitelná poznámka na faktuře'
							"
							data-testid="field-note" />
					</UFormField>
				</section>
			</div>
		</div>

		<footer class="detail-footer" data-testid="action-strip">
			<div class="mr-auto min-w-0 text-note text-ink-3" data-testid="statusbar">
				<div>{{ formatCount(inv.lines.length, 'item') }}</div>
				<StatusbarFeedback :status="status.message"><span v-if="savedPath">Uloženo</span></StatusbarFeedback>
			</div>
			<div class="ml-auto flex shrink-0 items-center gap-2">
				<UButton
					v-if="number && !missing"
					variant="ghost"
					color="error"
					class="rounded-full text-meta!"
					trailing-icon="i-lucide-trash-2"
					:loading="deleting"
					data-testid="action-delete"
					@click="deleteDocument">
					Smazat
				</UButton>
				<UButton
					variant="ghost"
					color="neutral"
					class="rounded-full text-meta!"
					trailing-icon="i-lucide-file-plus"
					data-testid="action-new"
					@click="startNew">
					Nová
				</UButton>
				<UButton
					variant="ghost"
					trailing-icon="i-lucide-eye"
					:loading="previewing"
					:disabled="missing"
					data-testid="action-show"
					color="neutral"
					class="rounded-full px-3 text-meta!"
					@click="showPreview">
					Náhled
				</UButton>
				<!-- Loading si bere formulář, ne `saving`: `UForm` ho zvedá už před validací, takže tlačítko
			     i ⌘S, která ho mačká, se zamknou hned. -->
				<UButton
					variant="create"
					trailing-icon="i-lucide-save"
					type="submit"
					:loading="loading"
					:disabled="missing"
					:aria-busy="loading"
					data-save
					data-testid="action-save">
					Uložit
				</UButton>
			</div>
		</footer>

		<InvoiceContactPicker v-model:open="showContactPicker" :contacts="contacts" @pick="pickContact" />

		<InvoiceCustomerDialog v-model:open="showCustomerDialog" :party="inv.customer" @confirm="applyCustomer" />

		<InvoicePricePicker
			v-model:open="showPricePicker"
			:pricelist="pricelist"
			:lines="inv.lines"
			:remaining="remainingFor"
			@add="addFromPricelist" />

		<InvoiceEmailModal
			v-model:open="showEmailModal"
			:number="inv.number"
			:email="inv.customer.email"
			@send="sendEmail" />

		<InvoicePreviewDialog v-if="previewPages" :pages="previewPages" @close="previewPages = null" />
	</UForm>
</template>

<style>
@reference '~/assets/css/main.css';

.items-table {
	@apply overflow-hidden rounded-2xl border border-line-soft;
}
.items-table table {
	@apply w-full min-w-180 table-fixed border-collapse text-ui;
}
.items-table th {
	@apply h-10 border-b border-line-soft bg-card/40 px-3 text-note font-medium tracking-normal text-ink-3 normal-case;
}
.items-table td {
	@apply h-(--row-tbl) border-b border-line-soft px-3 text-ink-2;
}
.items-table td.edit {
	@apply p-0;
}
.cell-input {
	@apply block h-(--row-tbl) w-full px-3 text-ink;
	@apply box-border rounded-lg bg-transparent outline-none [font:inherit];
}
.cell-input::placeholder {
	@apply text-ink-2;
}
.cell-input:hover {
	@apply bg-row-hover;
}
.cell-input:focus {
	@apply shadow-[inset_0_0_0_1px_var(--accent)];
}
.cell-input[aria-invalid='true'] {
	@apply bg-danger-soft;
	@apply shadow-[inset_0_0_0_1px_var(--danger)];
}

.add-row td {
	@apply border-b-0;
}
.add-line {
	@apply flex h-(--row-tbl) w-full items-center gap-2 px-3 text-ink-3;
	@apply bg-transparent [font:inherit];
}
.add-line:hover {
	@apply bg-row-hover text-ink;
}

.invoice-editor .section-title {
	@apply text-ui font-medium tracking-normal text-ink normal-case;
}
</style>
