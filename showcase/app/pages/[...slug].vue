<script setup lang="ts">
/**
 * Stránky psané v Markdownu: use-case landing pages a nápověda.
 * Šablona se vybírá podle `kind` ve frontmatteru.
 */
const route = useRoute();

const { data: page } = await useAsyncData(`content:${route.path}`, () =>
	queryCollection('content').path(route.path).first(),
);

// Chybějící stránka skončí 404 už tady, typ to o `page` ale neví — proto šablona `v-else-if="page"`.
if (!page.value) {
	throw createError({
		statusCode: 404,
		statusMessage: 'Stránka neexistuje',
		fatal: true,
	});
}

const { data: related } = await useAsyncData(`related:${route.path}`, async () => {
	const paths = page.value?.related ?? [];
	if (!paths.length) return [];
	return await queryCollection('content').where('path', 'IN', paths).select('path', 'title', 'description').all();
});

useSeoMeta({
	title: page.value.title,
	description: page.value.description,
	ogTitle: page.value.title,
	ogDescription: page.value.description,
});

defineOgImage('Default', {
	title: page.value.title,
	description: page.value.description,
	kicker: page.value.kind === 'help' ? 'Nápověda Fakturianu' : 'Fakturian',
});
</script>

<template>
	<HelpArticle v-if="page?.kind === 'help'" :page="page" :related="related ?? []" />
	<UseCasePage v-else-if="page" :page="page" :related="related ?? []" />
</template>
