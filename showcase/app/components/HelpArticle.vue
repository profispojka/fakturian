<script setup lang="ts">
import type { ContentCollectionItem } from '@nuxt/content';

/** Šablona článku nápovědy: užší sazba, obsah po straně, navigace zpět. */
const props = defineProps<{
	page: ContentCollectionItem;
	related: { path: string; title: string; description: string }[];
}>();

useSchemaOrg([
	defineBreadcrumb({
		itemListElement: [
			{
				name: 'Fakturian',
				item: '/',
			},
			{
				name: 'Nápověda',
				item: '/napoveda',
			},
			{
				name: props.page.title,
				item: props.page.path,
			},
		],
	}),
]);
</script>

<template>
	<article class="page pt-9 pb-14">
		<nav class="flex gap-2 mb-6 text-note text-(--ink-3)" aria-label="Drobečková navigace">
			<NuxtLink to="/napoveda" class="no-underline text-(--ink-2)">Nápověda</NuxtLink>
			<span aria-hidden="true">/</span>
			<span>{{ page.group ?? 'Článek' }}</span>
		</nav>

		<header>
			<h1 class="mb-3 max-w-[22ch] text-h2">{{ page.title }}</h1>
			<p class="lede">{{ page.description }}</p>
		</header>

		<!-- Obsah stránky stojí vedle textu, dokud je na něj místo; níž se zařadí
		     pod něj. Zůstává přilepený, aby se dalo skákat i uprostřed návodu. -->
		<div class="grid gap-9 mt-9 min-[960px]:grid-cols-[minmax(0,1fr)_220px] min-[960px]:items-start">
			<div class="prose prose--help">
				<ContentRenderer :value="page" />
			</div>

			<aside v-if="page.body?.toc?.links?.length" class="sticky top-19.5 pl-4 border-l border-(--line) text-note">
				<h2 class="mb-3 text-note uppercase tracking-[0.08em] text-(--ink-3)">Na téhle stránce</h2>
				<ul class="list-none m-0 p-0 grid gap-[0.4rem]">
					<li v-for="l in page.body.toc.links" :key="l.id">
						<a :href="`#${l.id}`" class="no-underline text-(--ink-2) hover:text-(--ink)">{{ l.text }}</a>
					</li>
				</ul>
			</aside>
		</div>

		<section v-if="related.length" class="mt-14 pt-6 border-t border-(--line)">
			<h2 class="mb-3 text-lede">Souvisí</h2>
			<ul class="list-none m-0 p-0 grid gap-[0.4rem]">
				<li v-for="r in related" :key="r.path">
					<NuxtLink :to="r.path">{{ r.title }}</NuxtLink>
				</li>
			</ul>
		</section>
	</article>
</template>
