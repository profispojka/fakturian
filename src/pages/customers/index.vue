<script setup lang="ts">
import { formatCount, formatCountOutOf } from '~/utils/locales';

import type { DropdownMenuItem, TableColumn, TableRow } from '@nuxt/ui';
import type { Contact } from '~/schemas/customers';

const { contacts, remove, loadError: fileError } = useContacts();
const paletteOpen = useState<boolean>('paletteOpen', () => false);
const selectedId = ref('');
const status = usePageStatus();

const {
	filtered,
	filters,
	search,
	loading,
	error: loadError,
} = useTable(() => contacts.value.slice(), {
	key: 'customers',
	filters: {
		ascending: true,
	},
	watch: [contacts],
	searchFields: ['name', 'ico', 'address.city', 'email'],
	compare: (a, b, f) => (f.ascending ? a.name.localeCompare(b.name, 'cs') : b.name.localeCompare(a.name, 'cs')),
});

const selected = computed(() => filtered.value.find((c) => c.id === selectedId.value) ?? filtered.value[0]);

function selectCustomer(event: Event, row: TableRow<Contact>) {
	selectedId.value = row.original.id;
	const doubleClick = event instanceof MouseEvent && event.detail === 2;
	if (event.type === 'keydown' || doubleClick) void navigateTo(`/customers/${row.original.id}`);
}

function customerActions(c: Contact): DropdownMenuItem[] {
	return [
		{
			label: 'Smazat odběratele',
			icon: 'i-lucide-trash-2',
			color: 'error',
			onSelect: () => void askDelete(c),
			'data-testid': 'customer-delete',
		},
	];
}

async function askDelete(c: Contact) {
	const confirmed = await getUserConfirmation(`Opravdu chceš smazat odběratele „${c.name}“?`, {
		title: 'Smazat odběratele?',
	});

	if (!confirmed) return;
	try {
		await remove(c.id);
	} catch (e) {
		status.error('Odběratele se nepodařilo smazat', e);
	}
}

const columns: TableColumn<Contact>[] = [
	{
		id: 'name',
		header: 'Odběratel / IČO',
	},
	{
		id: 'city',
		header: 'Město',
		meta: {
			class: {
				th: 'hidden w-32 wide:table-cell',
				td: 'hidden truncate wide:table-cell',
			},
		},
	},
	{
		id: 'email',
		header: 'E-mail',
		meta: {
			class: {
				th: 'w-44',
				td: 'truncate',
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
	<div class="flex h-full min-h-0 flex-col bg-pane">
		<header class="flex h-15 shrink-0 items-center gap-3 border-b border-line-soft px-5" data-drag-region>
			<UInput
				v-model="search"
				class="min-w-0 flex-1"
				variant="search"
				icon="i-lucide-search"
				data-testid="customer-search"
				aria-label="Hledat odběratele"
				placeholder="Hledat odběratele, IČO nebo e-mail…" />
			<UButton
				variant="ghost"
				color="neutral"
				class="shrink-0 gap-1"
				aria-label="Otevřít paletu příkazů"
				data-testid="customer-palette"
				@click="paletteOpen = true">
				<UKbd value="meta" />
				<UKbd>P</UKbd>
			</UButton>
		</header>
		<div class="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-3">
			<div>
				<h1 class="text-stat leading-tight font-semibold tracking-tight text-ink">Odběratelé</h1>
				<p class="mt-1 text-note text-ink-3">Firmy a kontakty na jednom místě.</p>
			</div>
			<div class="flex items-center gap-2">
				<UButton
					variant="ghost"
					color="neutral"
					icon="i-lucide-arrow-down-up"
					class="text-note! text-ink-3"
					data-testid="customer-sort"
					@click="filters.ascending = !filters.ascending">
					{{ filters.ascending ? 'A–Z' : 'Z–A' }}
				</UButton>
			</div>
		</div>
		<RecordTable
			:items="contacts"
			:data="filtered"
			:columns="columns"
			:row-id="(c) => c.id"
			:loading="loading"
			loading-text="Načítám odběratele…"
			:error="fileError || loadError"
			data-testid="customer-table"
			@select="selectCustomer">
			<template #empty>Zatím žádní odběratelé.</template>
			<template #name-cell="{ row: { original: c } }">
				<div :data-testid="`customer-entry-${c.id}`" :data-selected="selected?.id === c.id || undefined">
					<UButton
						variant="ghost"
						color="neutral"
						class="row-link max-w-full gap-3 text-ink!"
						data-testid="customer-edit"
						:avatar="{ alt: c.name }"
						:ui="{ leadingAvatar: 'size-8', label: 'min-w-0 text-left' }"
						:to="`/customers/${c.id}`">
						<span class="min-w-0 text-left">
							<span class="block truncate">{{ c.name }}</span>
							<span class="mt-1 block truncate text-micro font-normal text-ink-3">
								IČO {{ c.ico }}
								<span class="wide:hidden">· {{ c.address.city }}</span>
							</span>
						</span>
					</UButton>
				</div>
			</template>
			<template #city-cell="{ row: { original: c } }">
				<span :title="c.address.city">{{ c.address.city }}</span>
			</template>
			<template #email-cell="{ row: { original: c } }">
				<span :title="c.email">{{ c.email || '—' }}</span>
			</template>
			<template #actions-cell="{ row: { original: c } }">
				<UDropdownMenu
					:items="customerActions(c)"
					:content="{ side: 'left', align: 'center', sideOffset: 8, collisionPadding: 8 }">
					<UButton
						variant="ghost"
						color="neutral"
						icon="i-lucide-ellipsis"
						class="size-7 justify-center p-0 text-ink-3"
						:aria-label="`Akce odběratele ${c.name}`"
						:data-testid="`customer-actions-${c.id}`"
						@click="selectedId = c.id" />
					<template #content-top>
						<p class="truncate px-3 pt-2 pb-2.5 text-meta text-ink-3">{{ c.name }}</p>
					</template>
				</UDropdownMenu>
			</template>
		</RecordTable>
		<footer
			class="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-3"
			data-testid="customers-footer">
			<div class="min-w-0 flex-1 self-end pb-1 text-note text-ink-3">
				<p>
					{{
						search
							? formatCountOutOf(filtered.length, contacts.length, 'customer')
							: formatCount(contacts.length, 'customer')
					}}
				</p>
			</div>
			<div class="ml-auto flex shrink-0 items-center gap-2">
				<UButton variant="create" icon="i-lucide-plus" to="/customers/new" data-testid="customer-add">
					Přidat odběratele
				</UButton>
			</div>
		</footer>
	</div>
</template>
