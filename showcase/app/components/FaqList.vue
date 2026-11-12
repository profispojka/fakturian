<script setup lang="ts">
/**
 * Časté dotazy. Text je vždy vidět (rozbalovací, ale v HTML přítomný) —
 * strukturovaná data `FAQPage` se musí shodovat s viditelným obsahem.
 */
const props = defineProps<{ items: { q: string; a: string }[]; title?: string }>();

useSchemaOrg(
	props.items.map((i) =>
		defineQuestion({
			name: i.q,
			acceptedAnswer: i.a,
		}),
	),
);
</script>

<template>
	<section>
		<h2 v-if="title" class="mb-6">{{ title }}</h2>
		<dl class="m-0 border-t border-(--line)">
			<!-- Otázka vlevo, odpověď vpravo — jako řádek výpisu. V úzkém okně pod sebe:
			     dva sloupce po 40 % šířky by z odpovědi udělaly sloupek. -->
			<div
				v-for="i in items"
				:key="i.q"
				class="grid gap-[0.35rem] grid-cols-[minmax(0,1fr)] py-4 px-0 border-b border-(--line) min-[860px]:grid-cols-[0.9fr_1.4fr] min-[860px]:gap-6">
				<dt class="font-[620]">{{ i.q }}</dt>
				<dd class="m-0 text-(--ink-2) max-w-(--measure)">{{ i.a }}</dd>
			</div>
		</dl>
	</section>
</template>
