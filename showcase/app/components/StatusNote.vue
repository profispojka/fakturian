<script setup lang="ts">
/**
 * Stav produktu místo tlačítka „Stáhnout".
 *
 * Appka je funkčně hotová, ale build zatím není podepsaný ani notarizovaný,
 * takže se nedistribuuje. Web to říká rovnou — slíbit stažení, které
 * nefunguje, je horší než neslíbit nic.
 *
 * Až bude co stahovat, přepíše se **jen tahle komponenta**.
 */
withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });
</script>

<template>
	<aside
		class="border border-(--line) border-l-[3px] border-l-(--accent) rounded-ctl bg-(--surface)"
		:class="compact ? 'py-3 px-4 text-note' : 'py-4 px-6'">
		<p class="m-0 max-w-[74ch]">
			<!-- Puntík je značka stavu, ne odrážka — proto inline za textem, ne v seznamu. -->
			<span class="inline-block size-1.75 rounded-full bg-(--accent) mr-2 align-middle" aria-hidden="true" />
			<strong>Fakturian se dokončuje.</strong>
			Funkce jsou hotové, zbývá podepsaný a notarizovaný build pro macOS. Než bude, web nic nenabízí ke stažení a
			nesbírá e-maily.
		</p>
		<p v-if="!compact" class="muted text-note mt-[0.4rem] mx-0 mb-0">
			Co je na obrázcích a ve videích, je skutečná appka s ukázkovými daty — ne návrh ani mockup.
		</p>
	</aside>
</template>
