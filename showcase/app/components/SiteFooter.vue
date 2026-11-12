<script setup lang="ts">
const year = new Date().getFullYear();

const groups = [
	{
		heading: 'Produkt',
		links: [
			{
				to: '/funkce',
				label: 'Všechny funkce',
			},
			{
				to: '/funkce#data',
				label: 'Kde leží data',
			},
			{
				to: '/cena',
				label: 'Cena a dostupnost',
			},
		],
	},
	{
		heading: 'Pro koho',
		links: [
			{
				to: '/pouziti',
				label: 'Přehled použití',
			},
			{
				to: '/pro/programatory',
				label: 'Programátoři',
			},
			{
				to: '/prechod/z-fakturoidu',
				label: 'Přechod z Fakturoidu',
			},
		],
	},
	{
		heading: 'Nápověda',
		links: [
			{
				to: '/napoveda',
				label: 'Rozcestník',
			},
			{
				to: '/napoveda/prvni-spusteni',
				label: 'První spuštění',
			},
			{
				to: '/napoveda/zalohovani',
				label: 'Zálohování',
			},
			{
				to: '/napoveda/caste-dotazy',
				label: 'Časté dotazy',
			},
		],
	},
];
</script>

<template>
	<footer class="mt-22 pt-14 pb-6 border-t border-(--line)">
		<!-- Značka vlevo v širším sloupci, tři sloupce odkazů vedle ní; v úzkém okně
		     dva sloupce, na telefonu jeden. -->
		<div
			class="page grid gap-9 items-start grid-cols-[1fr] min-[521px]:grid-cols-[1fr_1fr] min-[861px]:grid-cols-[1.4fr_repeat(3,1fr)]">
			<div>
				<span class="font-[660] tracking-[-0.02em]">Fakturian</span>
				<p class="muted">
					Desktopová fakturace pro živnostníky-neplátce DPH. Data zůstávají ve složce, kterou si zvolíš.
				</p>
				<p class="muted text-note">macOS · jednorázová platba · bez účtu a bez cloudu</p>
			</div>

			<nav v-for="s in groups" :key="s.heading" :aria-label="s.heading">
				<h2 class="mb-3 text-note font-[620] tracking-[0.09em] uppercase text-(--ink-3)">{{ s.heading }}</h2>
				<ul class="list-none m-0 p-0 grid gap-[0.45rem] text-note">
					<li v-for="o in s.links" :key="o.to">
						<NuxtLink :to="o.to" class="no-underline text-(--ink-2) hover:text-(--ink) hover:underline">
							{{ o.label }}
						</NuxtLink>
					</li>
				</ul>
			</nav>
		</div>

		<div class="page flex flex-wrap justify-between gap-4 pt-6 mt-9 border-t border-(--line)">
			<span class="muted text-note">© {{ year }} Fakturian</span>
			<span class="muted text-note">Web ani appka nesbírají osobní údaje.</span>
		</div>
	</footer>
</template>
