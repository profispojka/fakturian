import type { Nuxt } from 'nuxt/schema';

// Build přepisuje `definePageMeta()` na `false && definePageMeta()`; větev, která se nikdy neprovede,
// by stránce kazila pokrytí. Seznam je pole, takže ho `overrides` umí jen prodloužit, ne zkrátit.
export default function keepPageMeta(_options: unknown, nuxt: Nuxt): void {
	const { client } = nuxt.options.optimization.treeShake.composables;
	client['#app'] = client['#app']?.filter((name) => name !== 'definePageMeta') ?? [];
}
