<script setup lang="ts">
import { systemServices } from '~/services/system';
import { formatDate } from '~/utils/date';
import { errorText } from '~/utils/errors';
import { czechList, formatCount, formatCountOutOf } from '~/utils/locales';

import type { DropdownMenuItem, TableColumn, TableRow } from '@nuxt/ui';
import type { Expense } from '~/schemas/expenses';

const {
	expenses,
	upsertMany,
	remove,
	importDocument,
	discardImported,
	documentPath,
	loadError: fileError,
} = useExpenses();

const paletteOpen = useState<boolean>('paletteOpen', () => false);
const selectedId = ref('');

const {
	filtered,
	search,
	error: loadError,
} = useTable(() => expenses.value.slice(), {
	key: 'expenses',
	filters: {},
	watch: [expenses],
	searchFields: ['supplier', 'description', 'supplierIco'],
	compare: (a, b) => b.date.localeCompare(a.date),
});

const dropActive = ref(false);
const status = usePageStatus();
const selected = computed(() => filtered.value.find((e) => e.id === selectedId.value) ?? filtered.value[0]);

function selectExpense(event: Event, row: TableRow<Expense>) {
	selectedId.value = row.original.id;
	const doubleClick = event instanceof MouseEvent && event.detail === 2;
	if (event.type === 'keydown' || doubleClick) void navigateTo(`/expense/${row.original.id}`);
}

function expenseActions(e: Expense): DropdownMenuItem[] {
	return [
		...(e.documentFile
			? [
					{
						label: 'Ukázat doklad ve Finderu',
						icon: 'i-lucide-paperclip',
						onSelect: () => openDocument(e),
						'data-testid': 'expense-document',
					},
				]
			: []),
		{
			label: 'Smazat výdaj',
			icon: 'i-lucide-trash-2',
			color: 'error',
			onSelect: () => void askDelete(e),
			'data-testid': 'expense-delete',
		},
	];
}

async function askDelete(e: Expense) {
	let question = `Opravdu chceš smazat výdaj „${e.supplier}“?`;
	if (e.documentFile) question = `Opravdu chceš smazat výdaj „${e.supplier}“? Doklad ve složce prijate/ zůstane.`;
	const confirmed = await getUserConfirmation(question, { title: 'Smazat výdaj?' });
	if (!confirmed) return;
	try {
		await remove(e.id);
	} catch (err) {
		// Bez hlášky by řádek zůstal ve výpisu a vypadalo by to, že se nekliklo.
		status.error('Výdaj se nepodařilo smazat', err);
	}
}

const importing = ref(false);

async function importFiles(paths: string[]) {
	// Souběžná dávka by neviděla doklady té první a duplicitu by nepoznala.
	if (importing.value) {
		status.error('Předchozí import ještě běží. Doklady přetáhni znovu, až doběhne.');
		return;
	}
	importing.value = true;
	status.clear();

	const done: string[] = [];
	const warnings: string[] = [];
	// Všechny: u dávky by poslední hláška přebila zprávu o dokladu odmítnutém na začátku.
	const errors: string[] = [];

	const newItems: Expense[] = [];
	const copies: string[] = [];
	for (const path of paths) {
		try {
			const { expense, file, warning } = await importDocument(path, newItems);
			newItems.push(expense);
			copies.push(file);
			done.push(expense.supplier || 'doklad');
			if (warning && !warnings.includes(warning)) warnings.push(warning);
		} catch (e) {
			errors.push(errorText(e));
		}
	}
	// Jedním zápisem: týdenní záloha drží stav před posledním zápisem a po dávce by v ní zůstal mezistav.
	// Selhání musí být vidět, jinak by drop vypadal, že neudělal vůbec nic.
	try {
		await upsertMany(newItems);
	} catch (e) {
		await discardImported(copies);
		status.error('Výdaje se nepodařilo uložit', e);
		return;
	} finally {
		importing.value = false;
	}

	const messages: string[] = [];
	if (done.length) messages.push(`Naimportováno: ${czechList.format(done)}.`);
	messages.push(...warnings);

	const details = [...messages, ...errors].join(' ');
	if (errors.length) status.error(details);
	else status.show('info', details);
}

async function pickDocument() {
	let paths: string[];
	try {
		paths = await systemServices.pickFiles('PDF', ['pdf'], true);
	} catch (e) {
		status.error('Výběr dokladu se nepodařilo otevřít', e);
		return;
	}
	if (!paths.length) return;
	await importFiles(paths);
}

async function openDocument(e: Expense) {
	if (!e.documentFile) return;
	try {
		const path = await documentPath(e.documentFile);
		await systemServices.revealPath(path);
	} catch (err) {
		status.error('Doklad se nepodařilo ukázat ve Finderu', err);
	}
}

// `dragleave` přijde i při přechodu na potomka, takže zónu zhasne až odchod z posledního prvku.
let dragDepth = 0;

// Tažený text nebo odkaz soubory nenese a importovat nemá co.
function draggedFiles(event: DragEvent): DataTransfer | null {
	const transfer = event.dataTransfer;
	if (transfer?.types.includes('Files')) return transfer;
	return null;
}

function dragEnter(event: DragEvent) {
	if (!draggedFiles(event)) return;
	dragDepth += 1;
	dropActive.value = true;
}

function dragLeave(event: DragEvent) {
	if (!draggedFiles(event)) return;
	dragDepth -= 1;
	if (dragDepth === 0) dropActive.value = false;
}

function drop(event: DragEvent) {
	const transfer = draggedFiles(event);
	if (!transfer) return;
	dragDepth = 0;
	dropActive.value = false;
	const paths = [...transfer.files].map((file) => systemServices.pathForFile(file));
	const pdf = paths.filter((p) => p.toLowerCase().endsWith('.pdf'));
	if (pdf.length) void importFiles(pdf);
	else status.error('Přetáhni PDF s přijatou fakturou.');
}

const columns: TableColumn<Expense>[] = [
	{
		id: 'supplier',
		header: 'Dodavatel / popis',
	},
	{
		id: 'date',
		header: 'Datum',
		meta: {
			class: {
				th: 'w-24',
				td: 'text-note text-ink-3',
			},
		},
	},
	{
		id: 'amount',
		header: 'Částka',
		meta: {
			class: {
				th: 'w-32 text-right',
				td: 'text-right tabular-nums text-ink',
			},
		},
	},
	{
		id: 'actions',
		header: '',
		meta: {
			class: {
				th: 'w-13',
				td: 'text-right',
			},
		},
	},
];
</script>

<template>
	<div
		class="flex h-full min-h-0 flex-col bg-pane"
		@dragenter="dragEnter"
		@dragleave="dragLeave"
		@dragover.prevent
		@drop.prevent="drop">
		<header class="flex h-15 shrink-0 items-center gap-3 border-b border-line-soft px-5" data-drag-region>
			<UInput
				v-model="search"
				class="min-w-0 flex-1"
				variant="search"
				icon="i-lucide-search"
				data-testid="expense-search"
				aria-label="Hledat výdaje"
				placeholder="Hledat dodavatele, popis nebo IČO…" />
			<UButton
				variant="ghost"
				color="neutral"
				class="shrink-0 gap-1"
				aria-label="Otevřít paletu příkazů"
				data-testid="expense-palette"
				@click="paletteOpen = true">
				<UKbd value="meta" />
				<UKbd>P</UKbd>
			</UButton>
		</header>
		<div class="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-3">
			<div>
				<h1 class="text-stat leading-tight font-semibold tracking-tight text-ink">Výdaje</h1>
				<p class="mt-1 text-note text-ink-3">Přijaté doklady a ručně zapsané výdaje.</p>
			</div>
		</div>
		<RecordTable
			:items="expenses"
			:data="filtered"
			:columns="columns"
			:row-id="(e) => e.id"
			:error="fileError || loadError"
			data-testid="expense-table"
			@select="selectExpense">
			<template #empty>
				Zatím žádné výdaje. Přetáhni sem PDF přijaté faktury — když má vložený ISDOC, vyplní se sám.
			</template>
			<template #supplier-cell="{ row: { original: e } }">
				<span :data-testid="`expense-entry-${e.id}`" :data-selected="selected?.id === e.id || undefined">
					<UButton
						variant="ghost"
						color="neutral"
						class="row-link max-w-full gap-3 text-ink!"
						icon="i-lucide-receipt"
						data-testid="expense-edit"
						:to="`/expense/${e.id}`"
						:ui="{ label: 'min-w-0 text-left' }">
						<span class="min-w-0">
							<span class="block truncate text-meta font-medium">
								{{ e.supplier || 'Doplnit údaje' }}
							</span>
							<span v-if="e.description" class="mt-1 block truncate text-micro font-normal text-ink-3">
								{{ e.description }}
							</span>
						</span>
					</UButton>
				</span>
			</template>
			<template #date-cell="{ row: { original: e } }">
				{{ formatDate(e.date) }}
			</template>
			<template #amount-cell="{ row: { original: e } }">
				<Money :cents="e.amountCents" />
			</template>
			<template #actions-cell="{ row: { original: e } }">
				<UDropdownMenu
					:items="expenseActions(e)"
					:content="{ side: 'left', align: 'center', sideOffset: 8, collisionPadding: 8 }">
					<UButton
						variant="ghost"
						color="neutral"
						icon="i-lucide-ellipsis"
						class="size-7 justify-center p-0 text-ink-3"
						:aria-label="`Akce výdaje ${e.supplier}`"
						:data-testid="`expense-actions-${e.id}`"
						@click="selectedId = e.id" />
					<template #content-top>
						<p class="truncate px-3 pt-2 pb-2.5 text-meta text-ink-3" data-testid="expense-actions-heading">
							{{ e.supplier || 'Doplnit údaje' }}
						</p>
					</template>
				</UDropdownMenu>
			</template>
		</RecordTable>

		<footer
			class="flex min-h-16 shrink-0 flex-wrap items-center gap-2 px-4 py-3 text-note text-ink-3"
			data-testid="expenses-footer">
			<span v-if="search">
				{{ formatCountOutOf(filtered.length, expenses.length, 'expense') }}
			</span>
			<span v-else>{{ formatCount(expenses.length, 'expense') }}</span>
			<span class="min-w-0 flex-1">
				<StatusbarFeedback :status="status.message" />
			</span>
			<div class="ml-auto flex shrink-0 items-center gap-2">
				<UButton
					variant="ghost"
					trailing-icon="i-lucide-file-down"
					class="text-meta!"
					:loading="importing"
					data-testid="expense-import"
					@click="pickDocument">
					Načíst doklad
				</UButton>
				<UButton variant="create" data-testid="expense-add" icon="i-lucide-plus" to="/expense/new">
					Přidat výdaj
				</UButton>
			</div>
		</footer>

		<div
			v-if="dropActive"
			class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center border border-dashed border-accent bg-accent/8 font-medium text-accent"
			data-testid="expense-dropzone">
			Pusť PDF sem — uloží se do prijate/
		</div>
	</div>
</template>
