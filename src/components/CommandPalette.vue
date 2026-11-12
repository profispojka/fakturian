<script setup lang="ts">
import { useMutationObserver } from '@vueuse/core';

import { MENU } from '~/constants/palette';
import { errorText } from '~/utils/errors';

// Vlastní seznam s ručním `selected` by neuměl scroll na vybraný řádek, `aria-activedescendant` ani
// zvýraznění shody; Combobox pod `UCommandPalette` ano.
interface PaletteItem {
	label: string;
	icon: string;
	'data-testid': string;
	onSelect: () => void;
}

// `UCommandPalette` ořezává skupinu na 12 řádků, takže by po dvanácté faktuře tiše přestala nabízet
// zbytek. Strop zůstává konečný: `processGroupItems` běží na každý stisk i nad tisíci doklady.
const FUSE = {
	resultLimit: 200,
	fuseOptions: {
		keys: ['label'],
		ignoreDiacritics: true,
	},
};

const open = useState<boolean>('paletteOpen', () => false);
const { archived } = useInvoices();
const { contacts } = useContacts();
const { pricelist } = usePricelist();

const query = ref('');
const highlighted = shallowRef<HTMLElement>();
const paletteRoot = useTemplateRef('paletteRoot');

useMutationObserver(
	paletteRoot,
	() => {
		if (highlighted.value && !highlighted.value.isConnected) highlighted.value = undefined;
	},
	{
		childList: true,
		subtree: true,
	},
);

watch(query, () => {
	highlighted.value = undefined;
});

const paletteInput = {
	'data-testid': 'palette-search',
	'aria-label': 'Hledat akci nebo doklad',
	ui: {
		base: 'bg-transparent! text-ui! pl-12 pr-5 ring-0',
		leading: 'pl-5',
		leadingIcon: 'size-5 text-ink-3',
	},
};

function go(path: string) {
	open.value = false;
	void navigateTo(path);
}

const invoiceItems = ref<PaletteItem[]>([]);
const invoicesError = ref('');

async function loadInvoices() {
	query.value = '';
	invoicesError.value = '';
	try {
		const invoices = await archived();
		invoiceItems.value = invoices.map((i) => {
			const label = `${i.number} · ${i.customer}`;
			return {
				label,
				icon: 'i-lucide-file-text',
				'data-testid': `palette-invoice-${i.number}`,
				onSelect: () => go(`/invoice/${i.number}`),
			};
		});
	} catch (e) {
		invoiceItems.value = [];
		invoicesError.value = errorText(e);
	}
}

// Zavření seznam zahodí, jinak by appka držela souhrn každé faktury až do konce běhu.
function clearInvoices() {
	invoiceItems.value = [];
	highlighted.value = undefined;
}

const groups = computed(() => [
	{
		id: 'akce',
		label: 'Akce',
		items: [
			...MENU.flat()
				.filter((row) => row.type !== 'label')
				.map((sec) => ({
					label: sec.label,
					icon: sec.icon,
					onSelect: () => go(sec.to),
				})),
			{
				label: 'Nová faktura',
				icon: 'i-lucide-file-plus',
				onSelect: () => go('/invoice/new'),
			},
		],
	},
	{
		id: 'faktury',
		label: 'Faktury',
		items: invoiceItems.value,
	},
	{
		id: 'odberatele',
		label: 'Odběratelé',
		items: contacts.value.map((c) => ({
			label: c.name,
			avatar: {
				alt: c.name,
			},
			onSelect: () => go(`/customers/${c.id}`),
		})),
	},
	{
		id: 'cenik',
		label: 'Ceník',
		items: pricelist.value.map((p) => ({
			label: p.name,
			icon: p.icon || 'i-lucide-tag',
			onSelect: () => go(`/pricelist/${p.id}`),
		})),
	},
]);
</script>

<template>
	<UModal
		v-model:open="open"
		title="Paleta příkazů"
		description="Hledání akcí a dokladů"
		:ui="{
			content:
				'max-w-2xl! overflow-hidden rounded-3xl! border border-line bg-palette! ring-0 shadow-[inset_0_1px_0_#ffffff12,0_24px_80px_#0005,0_4px_12px_#0002]! backdrop-blur-2xl backdrop-saturate-150',
		}"
		@enter="loadInvoices"
		@after:leave="clearInvoices">
		<template #content>
			<div ref="paletteRoot" class="contents">
				<UCommandPalette
					v-model:search-term="query"
					:groups="groups"
					placeholder="Hledat akci nebo doklad…"
					data-testid="command-palette"
					:input="paletteInput"
					:fuse="FUSE"
					@highlight="highlighted = $event?.ref">
					<template #empty>
						<UIcon name="i-lucide-search-x" class="size-8 text-ink-3" />
						<span>Nic nenalezeno</span>
					</template>
					<template #footer>
						<footer
							class="flex min-h-16 shrink-0 items-center justify-between gap-3 px-4 py-3 text-note text-ink-3"
							data-testid="palette-footer">
							<span v-if="invoicesError" class="min-w-0 text-danger" data-testid="palette-invoices-error">
								Faktury se nepodařilo načíst: {{ invoicesError }}
							</span>
							<span v-else class="flex items-center gap-2">
								<span class="inline-flex items-center gap-1">
									Procházet
									<UKbd>↑</UKbd>
									<UKbd>↓</UKbd>
								</span>
							</span>
							<span
								class="pointer-events-auto flex items-center gap-1 rounded-full border border-line px-1.5 py-1">
								<UButton
									variant="ghost"
									color="neutral"
									class="gap-2 rounded-full px-2 py-1 text-title! text-ink"
									data-testid="palette-open"
									:disabled="!highlighted"
									@click="highlighted?.click()">
									Otevřít
									<UKbd>↵</UKbd>
								</UButton>
								<span class="h-4 w-px bg-line-soft" />
								<UButton
									variant="ghost"
									color="neutral"
									class="gap-2 rounded-full px-2 py-1 text-title! text-ink-2"
									data-testid="palette-close"
									@click="open = false">
									Zavřít
									<UKbd>esc</UKbd>
								</UButton>
							</span>
						</footer>
					</template>
				</UCommandPalette>
			</div>
		</template>
	</UModal>
</template>
