<script setup lang="ts">
useSeoMeta({
	title: 'Nápověda k Fakturianu',
	description:
		'Návody podle toho, co potřebuješ udělat: první spuštění, vystavení faktury, přechod z jiného softwaru, zálohování, ceník s limity, Fio a Claude connector.',
});

defineOgImage('Default', {
	title: 'Nápověda',
	description: 'Návody podle toho, co potřebuješ udělat.',
});

const { data: articles } = await useAsyncData('help', () =>
	queryCollection('content')
		.where('kind', '=', 'help')
		.select('path', 'title', 'description', 'group', 'order')
		.all(),
);

const order = ['Začínáme', 'Každodenní práce', 'Data a zálohy', 'Integrace', 'Když se něco nedaří'];

const groups = computed(() => {
	const list = (articles.value ?? []).toSorted((a, b) => (a.order ?? 99) - (b.order ?? 99));
	return order
		.map((heading) => ({
			heading,
			items: list.filter((c) => c.group === heading),
		}))
		.filter((s) => s.items.length);
});
</script>

<template>
	<div>
		<header class="page pt-14 pb-6">
			<p class="eyebrow">Nápověda</p>
			<h1 class="mb-4">Co potřebuješ udělat?</h1>
			<p class="lede">
				Návody jsou řazené podle úloh, ne podle částí appky. Obrázky v nich jsou z appky s ukázkovými daty.
			</p>
		</header>

		<section v-for="s in groups" :key="s.heading" class="page section">
			<h2>{{ s.heading }}</h2>
			<ul class="list-none mt-6 mx-0 mb-0 p-0 max-w-none border-t border-(--line)">
				<li v-for="c in s.items" :key="c.path">
					<NuxtLink
						:to="c.path"
						class="grid gap-1 py-4 px-0 border-b border-(--line) no-underline min-[800px]:grid-cols-[minmax(0,0.7fr)_minmax(0,1.6fr)] min-[800px]:gap-6 min-[800px]:items-baseline [&:hover_strong]:text-(--accent-ink)">
						<strong>{{ c.title }}</strong>
						<span class="muted text-note">{{ c.description }}</span>
					</NuxtLink>
				</li>
			</ul>
		</section>
	</div>
</template>
