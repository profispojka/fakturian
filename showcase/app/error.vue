<script setup lang="ts">
const props = defineProps<{ error: { statusCode: number; statusMessage?: string } }>();

useSeoMeta({
	title: props.error.statusCode === 404 ? 'Stránka nenalezena' : 'Něco se pokazilo',
	robots: 'noindex',
});

const hub = [
	{
		to: '/',
		t: 'Hlavní stránka',
		d: 'Co Fakturian je a pro koho',
	},
	{
		to: '/funkce',
		t: 'Funkce',
		d: 'Co appka umí a co vědomě neumí',
	},
	{
		to: '/pouziti',
		t: 'Pro koho',
		d: 'Devět situací, ve kterých dává smysl',
	},
	{
		to: '/napoveda',
		t: 'Nápověda',
		d: 'Návody podle toho, co potřebuješ udělat',
	},
];
</script>

<template>
	<div>
		<SiteHeader />
		<main class="page pt-22 pb-14">
			<p class="eyebrow">Chyba {{ error.statusCode }}</p>
			<h1 class="mb-4 max-w-[18ch]">
				{{ error.statusCode === 404 ? 'Tahle stránka tu není' : 'Něco se pokazilo' }}
			</h1>
			<p class="lede">
				{{
					error.statusCode === 404
						? 'Odkaz je nejspíš starý nebo překlep v adrese. Zkus některou z těchhle cest:'
						: 'Zkus to prosím znovu, nebo pokračuj odsud:'
				}}
			</p>

			<!-- Rozcestník je výpis řádků, ne odrážky: každý řádek nese název a k němu
			     popis, v širokém okně vedle sebe. -->
			<ul class="list-none mt-9 mx-0 mb-0 p-0 max-w-none border-t border-(--line)">
				<li v-for="r in hub" :key="r.to">
					<NuxtLink
						:to="r.to"
						class="grid gap-[0.2rem] py-4 px-0 border-b border-(--line) no-underline min-[760px]:grid-cols-[minmax(0,0.6fr)_minmax(0,1.4fr)] min-[760px]:gap-6 min-[760px]:items-baseline">
						<strong>{{ r.t }}</strong>
						<span class="muted text-note">{{ r.d }}</span>
					</NuxtLink>
				</li>
			</ul>
		</main>
		<SiteFooter />
	</div>
</template>
