<script setup lang="ts">
useSchemaOrg([
	defineWebSite({
		name: 'Fakturian',
		inLanguage: 'cs-CZ',
	}),
	defineWebPage(),
]);
</script>

<template>
	<div>
		<a class="skip" href="#obsah">Přeskočit na obsah</a>
		<SiteHeader />
		<main id="obsah">
			<NuxtPage />
		</main>
		<SiteFooter />
	</div>
</template>
