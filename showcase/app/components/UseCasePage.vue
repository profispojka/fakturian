<script setup lang="ts">
import type { ContentCollectionItem } from '@nuxt/content';

/** Šablona landing page pro jeden use-case. Obsah je z Markdownu. */
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
				name: 'Pro koho',
				item: '/pouziti',
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
	<article>
		<header class="page max-w-(--page) pt-14 pb-6">
			<p class="eyebrow">{{ page.eyebrow ?? 'Pro koho' }}</p>
			<h1 class="mb-4 max-w-[20ch]">{{ page.title }}</h1>
			<p class="lede">{{ page.lede ?? page.description }}</p>
			<StatusNote compact class="block mt-6" />
		</header>

		<div v-if="page.shot" class="page pb-6">
			<ProductShot :name="page.shot" window :alt="page.shotAlt ?? page.title" />
		</div>

		<div class="page prose prose--case py-6">
			<ContentRenderer :value="page" />
		</div>

		<div v-if="page.video" class="page section">
			<VideoDemo :name="page.video" :title="page.title" caption="Appka s ukázkovými daty." />
		</div>

		<section v-if="page.faq?.length" class="page section">
			<FaqList :items="page.faq" title="Časté dotazy" />
		</section>

		<section v-if="related.length" class="page section">
			<p class="eyebrow">Podobné situace</p>
			<ul class="list-none mt-4 mx-0 mb-0 p-0 max-w-none border-t border-(--line)">
				<li v-for="r in related" :key="r.path">
					<NuxtLink
						:to="r.path"
						class="grid gap-[0.2rem] py-4 px-0 border-b border-(--line) no-underline [&:hover_strong]:text-(--accent-ink)">
						<strong>{{ r.title }}</strong>
						<span class="muted text-note">{{ r.description }}</span>
					</NuxtLink>
				</li>
			</ul>
		</section>
	</article>
</template>
