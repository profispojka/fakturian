<script setup lang="ts">
useSeoMeta({
	title: 'Pro koho je Fakturian — devět situací',
	description:
		'Programátoři, konzultanti, řemeslníci, malé firmy, přechod z Fakturoidu nebo iDokladu, provoz bez cloudu, offline a s AI agentem.',
});

defineOgImage('Default', {
	title: 'Devět situací, ve kterých dává smysl',
	description: 'Vyber tu svou — každá má vlastní postup i obrázky.',
});

const { data: pages } = await useAsyncData('use-cases', () =>
	queryCollection('content').where('kind', '=', 'use-case').select('path', 'title', 'description', 'eyebrow').all(),
);

const groups = computed(() => {
	const list = pages.value ?? [];
	return [
		{
			heading: 'Podle profese',
			prefix: '/pro/',
		},
		{
			heading: 'Přecházím odjinud',
			prefix: '/prechod/',
		},
		{
			heading: 'Podle způsobu práce',
			prefix: '/reseni/',
		},
	].map((s) => ({
		...s,
		items: list.filter((p) => p.path.startsWith(s.prefix)),
	}));
});
</script>

<template>
	<div>
		<header class="page pt-14 pb-6">
			<p class="eyebrow">Pro koho</p>
			<h1 class="mb-4 max-w-[20ch]">Devět situací, ve kterých Fakturian dává smysl</h1>
			<p class="lede">
				Každá stránka popisuje jednu situaci: co je na ní dnes nepříjemné, co s tím appka udělá a jak začít.
				Obrázky na nich jsou z appky s daty daného oboru.
			</p>
		</header>

		<section v-for="s in groups" :key="s.heading" class="page section">
			<h2>{{ s.heading }}</h2>
			<ul class="list-none mt-6 mx-0 mb-0 p-0 max-w-none border-t border-(--line)">
				<li v-for="p in s.items" :key="p.path">
					<NuxtLink
						:to="p.path"
						class="grid gap-1 py-4 px-0 border-b border-(--line) no-underline min-[800px]:grid-cols-[minmax(0,0.7fr)_minmax(0,1.6fr)] min-[800px]:gap-6 min-[800px]:items-baseline [&:hover_strong]:text-(--accent-ink)">
						<strong>{{ p.title }}</strong>
						<span class="muted text-note">{{ p.description }}</span>
					</NuxtLink>
				</li>
			</ul>
		</section>
	</div>
</template>
