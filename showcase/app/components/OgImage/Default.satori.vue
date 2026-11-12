<script setup lang="ts">
/**
 * Náhledový obrázek pro sdílení (1200×630). Kreslí se při buildu z týhle
 * šablony, takže se nemusí nikde exportovat ručně a drží vzhled webu.
 */
withDefaults(defineProps<{ title?: string; kicker?: string; description?: string }>(), {
	title: 'Fakturian',
	kicker: 'Fakturian',
	description: 'Faktury, náklady a vykázané dny pohromadě. Lokálně, bez cloudu.',
});
</script>

<template>
	<div
		style="
			width: 1200px;
			height: 630px;
			display: flex;
			flex-direction: column;
			justify-content: space-between;
			padding: 72px;
			background: #fbfbfb;
			color: #1d1d1d;
			font-family: ui-sans-serif, system-ui, sans-serif;
			border-bottom: 14px solid #2b7f4f;
		">
		<div style="display: flex; align-items: center; gap: 14px; font-size: 26px; font-weight: 600; color: #5f5f5f">
			<div style="width: 26px; height: 26px; border: 3px solid #2b7f4f; border-radius: 6px" />
			{{ kicker }}
		</div>

		<div style="display: flex; flex-direction: column; gap: 22px">
			<div style="font-size: 68px; font-weight: 680; line-height: 1.08; letter-spacing: -2px; max-width: 900px">
				{{ title }}
			</div>
			<div style="font-size: 28px; color: #5f5f5f; max-width: 820px; line-height: 1.4">
				{{ description }}
			</div>
		</div>

		<div style="font-size: 24px; color: #8f8f8f">macOS · offline · data ve tvé složce</div>
	</div>
</template>
