<script setup lang="ts">
import { useClipboard, whenever } from '@vueuse/core';

import { MENU } from '~/constants/palette';
import { QUICK_NEW_ITEMS } from '~/constants/quicknew';

const createOpen = ref(false);
const paletteOpen = useState<boolean>('paletteOpen', () => false);
whenever(paletteOpen, () => {
	createOpen.value = false;
});

const route = useRoute();

// Bez datové složky se místo stránky vykreslí nabídka průvodce — jedna podmínka na jednom místě,
// jinak by ji nesla každá sekce zvlášť.
const { vaultPath, ready } = useVault();
const pageNeedsVault = computed(() => !route.meta.vaultOptional);

const { supplier } = useSettings();
// `legacy` odmítnutí schránky obslouží náhradní cestou přes textarea, takže `copy()` nehází.
const { copy: icoCopy, copied: icoCopied } = useClipboard({
	legacy: true,
	copiedDuring: 1600,
});

// IČO se čte až při kliknutí: čip může zachytit klik ve chvíli, kdy už IČO zmizelo.
async function copyIco() {
	const ico = supplier.value?.ico;
	if (!ico) return;
	await icoCopy(ico);
}

// Seznam dokladů se čte po otevření datové složky a pak jen po zásahu do dokladů: panel je na každé
// stránce, takže číst ho při každém přechodu by znamenalo otevírat trezor pořád dokola.
const { stats, refresh: refreshMenuStats } = useMenuStats();
onMounted(refreshMenuStats);
</script>

<template>
	<div class="grid h-screen grid-cols-[var(--sidebar)_1fr] overflow-hidden">
		<aside class="flex min-h-0 flex-col border-r border-line bg-chrome backdrop-blur-xl backdrop-saturate-[1.8]">
			<div class="h-(--topbar) shrink-0" data-drag-region />

			<div v-if="supplier" class="flex shrink-0 items-center gap-2.5 px-5 pt-3 pb-4.5">
				<UAvatar
					:alt="supplier.name"
					class="size-7.25 shrink-0 rounded-avatar! border border-white/11 bg-linear-140 from-[#626566] to-[#333637] text-[#e3e8e6] shadow-[0_2px_3px_#0002]"
					:ui="{ fallback: 'text-note font-semibold' }"
					data-testid="menu-avatar" />
				<div class="flex min-w-0 flex-col gap-0.5">
					<span class="truncate text-meta font-medium text-ink" :title="supplier.name">
						{{ supplier.name }}
					</span>
					<UButton
						v-if="supplier.ico"
						variant="ghost"
						color="neutral"
						class="group/ico -ml-1 inline-flex min-h-0! max-w-full items-center gap-1 self-start rounded-micro px-1 text-micro! leading-[1.4] font-normal whitespace-nowrap tabular-nums"
						data-testid="menu-ico"
						:class="{
							'bg-accent-soft text-accent': icoCopied,
							'bg-transparent text-ink-3 hover:bg-field hover:text-ink-2': !icoCopied,
						}"
						type="button"
						:title="`Zkopírovat IČO ${supplier.ico}`"
						@click="copyIco">
						<span v-if="icoCopied">Zkopírováno</span>
						<span v-else>IČO {{ supplier.ico }}</span>
						<UIcon
							:name="icoCopied ? 'i-lucide-check' : 'i-lucide-copy'"
							class="size-3 shrink-0 opacity-0 group-hover/ico:opacity-80 group-focus-visible/ico:opacity-80"
							:class="{ 'opacity-80': icoCopied }" />
					</UButton>
					<span v-else class="truncate text-micro text-ink-3">Osobní pracovní prostor</span>
				</div>
			</div>

			<UDropdownMenu
				v-model:open="createOpen"
				:items="QUICK_NEW_ITEMS"
				:content="{ align: 'start', side: 'bottom', sideOffset: 8 }">
				<UButton
					class="mx-3 mt-px h-9 w-[calc(100%-24px)] shrink-0 justify-start gap-2.5 rounded-lg border border-white/10 bg-brand px-2.5 text-meta! font-medium whitespace-nowrap text-white shadow-[inset_0_1px_0_#ffffff1c,0_2px_4px_#0002] hover:bg-brand/90"
					:ui="{ leadingIcon: 'size-4' }"
					variant="solid"
					icon="i-lucide-plus"
					data-testid="menu-new">
					Vytvořit
					<template #trailing>
						<span
							class="ml-auto flex gap-0.5 [&>kbd]:bg-white/5 [&>kbd]:text-white/75 [&>kbd]:ring-white/20">
							<UKbd value="meta" />
							<UKbd>N</UKbd>
						</span>
					</template>
				</UButton>
				<template #content-top>
					<p class="px-3 pt-2 pb-2.5 text-meta font-medium text-ink-3">Vytvořit</p>
				</template>
			</UDropdownMenu>

			<UNavigationMenu
				:items="MENU"
				orientation="vertical"
				class="mt-4 min-h-0 flex-1 pb-2"
				:ui="{
					list: 'first:min-h-0 first:flex-1 first:scrollbar-none first:overflow-y-auto first:pb-2 first:[&::-webkit-scrollbar]:hidden last:shrink-0',
					separator: 'hidden',
				}">
				<template #item-trailing="{ item, ui }">
					<UBadge
						v-if="item.type !== 'label' && item.stat && stats[item.stat.name]"
						variant="outline"
						:label="stats[item.stat.name]"
						:title="item.stat.title"
						:class="ui.linkTrailingBadge()"
						data-testid="menu-badge" />
				</template>
			</UNavigationMenu>
		</aside>

		<main class="h-screen min-w-0 overflow-hidden bg-pane">
			<slot v-if="vaultPath || !pageNeedsVault" />
			<!-- `ready` proto, že zapamatovanou složku načte `app.vue` až v `onMounted`; bez něj by při
			     startu probliklo „není zvolena složka". Shell nese i nabídka průvodce, protože horní lišta
			     je zároveň tahací zóna okna. -->
			<div v-else-if="ready" class="page">
				<header class="page-header" data-drag-region>
					<h1
						class="text-ui font-semibold tracking-normal whitespace-nowrap text-ink"
						data-testid="vault-page-title">
						Datová složka
					</h1>
				</header>
				<div class="page-body">
					<VaultEmptyState />
				</div>
			</div>
		</main>
	</div>
</template>
