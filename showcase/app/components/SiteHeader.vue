<script setup lang="ts">
const open = ref(false);
const colorMode = useColorMode();

const nav = [
	{
		to: '/funkce',
		label: 'Funkce',
	},
	{
		to: '/pouziti',
		label: 'Pro koho',
	},
	{
		to: '/napoveda',
		label: 'Nápověda',
	},
];
</script>

<template>
	<header
		class="sticky top-0 z-20 bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] backdrop-blur-[10px] backdrop-saturate-[1.4] border-b border-(--line)">
		<!-- Lišta zůstává nahoře a obsah se pod ni odrolovává — proto průsvit
		     a rozostření. Vlásečnice na spodní hraně je ostrá, ta plochy dělí. -->
		<div class="page flex items-center gap-6 min-h-14.5">
			<NuxtLink
				to="/"
				class="inline-flex items-center gap-[0.55rem] mr-auto no-underline font-[660] tracking-[-0.02em]"
				@click="open = false">
				<!-- Značka: čtverec s vlásečnicí a účtařskou linkou — motiv celého webu.
				     Linku kreslí `linear-gradient` v pozadí, na to utilita není. -->
				<span
					class="size-5 border-[1.5px] border-(--accent) rounded-sm [background:linear-gradient(var(--accent),var(--accent))_no-repeat_center_bottom/100%_6px]"
					aria-hidden="true" />
				<span>Fakturian</span>
			</NuxtLink>

			<button
				class="hidden max-[720px]:inline-block py-[0.35rem] px-3 border border-(--line-strong) rounded-ctl bg-transparent text-(--ink) [font:inherit] text-note cursor-pointer"
				type="button"
				:aria-expanded="open"
				aria-controls="nav"
				@click="open = !open">
				{{ open ? 'Zavřít' : 'Menu' }}
			</button>

			<!-- Pod 720 px se nabídka schová pod tlačítko a vyjede přes celou šířku
			     zpod lišty (58 px = její výška). -->
			<nav
				id="nav"
				class="flex items-center gap-6 text-note max-[720px]:absolute max-[720px]:inset-x-0 max-[720px]:top-14.5 max-[720px]:bottom-auto max-[720px]:flex-col max-[720px]:items-start max-[720px]:gap-4 max-[720px]:pt-4 max-[720px]:px-5 max-[720px]:pb-6 max-[720px]:bg-(--bg) max-[720px]:border-b max-[720px]:border-(--line)"
				:class="open ? 'max-[720px]:flex' : 'max-[720px]:hidden'"
				aria-label="Hlavní">
				<NuxtLink
					v-for="i in nav"
					:key="i.to"
					:to="i.to"
					class="no-underline font-[560] text-(--ink-2) hover:text-(--ink) [&.router-link-active]:text-(--ink)"
					@click="open = false">
					{{ i.label }}
				</NuxtLink>
				<button
					class="py-[0.35rem] px-3 border border-(--line-strong) rounded-ctl bg-transparent text-(--ink-2) [font:inherit] text-note cursor-pointer hover:text-(--ink)"
					type="button"
					@click="colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'">
					{{ colorMode.value === 'dark' ? 'Světlý režim' : 'Tmavý režim' }}
				</button>
			</nav>
		</div>
	</header>
</template>
