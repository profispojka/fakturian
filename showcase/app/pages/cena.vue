<script setup lang="ts">
useSeoMeta({
	title: 'Cena a dostupnost Fakturianu',
	description:
		'Jednorázová platba za build pro macOS, žádné předplatné, žádné ověřování licence. Konkrétní cena bude doplněna před vydáním.',
});

defineOgImage('Default', {
	title: 'Jednorázová platba, žádné předplatné',
	description: 'Bez účtu, bez DRM, bez ověřování licence.',
});

const model = [
	['Platí se jednou', 'Za hotový build, ne měsíčně. Žádné předplatné, žádné funkce zamčené za vyšší tarif.'],
	[
		'Žádné ověřování licence',
		'Appka se nikam nehlásí a nic si neověřuje. Ochranou je pohodlí — podepsaný build, který se sám aktualizuje.',
	],
	[
		'Veřejný zdrojový kód',
		'Kód je pod licencí FSL-1.1-MIT: můžeš ho číst, upravovat a sám si appku sestavit a používat. Prodávat ji jako konkurenční produkt nejde; každá verze po dvou letech přechází na MIT. Platí se za pohodlí podepsaného buildu s aktualizacemi.',
	],
	['Prodej přes merchant of record', 'DPH v EU odvádí prodejce (Paddle nebo Lemon Squeezy), ne autor.'],
];

const questions = [
	{
		q: 'Kolik to bude stát?',
		a: 'Cena bude uvedená tady, jakmile bude vydání připravené. Model je jistý: jednorázová platba, žádné předplatné.',
	},
	{
		q: 'Kdy to vyjde?',
		a: 'Termín zatím neslibujeme. Funkce jsou hotové, zbývá podepsaný a notarizovaný build a automatické aktualizace.',
	},
	{
		q: 'Bude zkušební verze?',
		a: 'O podobě zkušební verze zatím není rozhodnuto. Až bude, bude to napsané tady.',
	},
	{
		q: 'Můžu si to zkompilovat sám?',
		a: 'Ano. Licence FSL-1.1-MIT dovoluje appku přeložit, upravit a používat pro vlastní práci, zdarma. Nedovoluje jen prodávat ji nebo nabízet jako konkurenční produkt.',
	},
	{
		q: 'Platí se za aktualizace?',
		a: 'Model aktualizací bude upřesněný spolu s cenou.',
	},
];
</script>

<template>
	<div>
		<header class="page pt-14 pb-6">
			<p class="eyebrow">Cena a dostupnost</p>
			<h1 class="mb-4 max-w-[18ch]">Jednorázová platba. Žádné předplatné.</h1>
			<p class="lede">
				Fakturian se kupuje jednou a pak je tvůj — včetně dat, která leží ve tvé složce a fungují i bez něj.
			</p>
			<StatusNote class="block mt-6" />
		</header>

		<section class="page section">
			<h2>Jak to bude fungovat</h2>
			<!-- Řádek výpisu: název vlevo, popis vpravo; v úzkém okně pod sebou. -->
			<ul class="list-none mt-6 mx-0 mb-0 p-0 max-w-none border-t border-(--line)">
				<li
					v-for="[name, description] in model"
					:key="name"
					class="grid items-baseline py-4 px-0 border-b border-(--line) grid-cols-[minmax(0,1fr)] gap-1 min-[800px]:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)] min-[800px]:gap-6">
					<span class="font-[620]">{{ name }}</span>
					<span class="muted text-note">{{ description }}</span>
				</li>
			</ul>
		</section>

		<section class="page section">
			<FaqList :items="questions" title="Časté dotazy k ceně" />
		</section>
	</div>
</template>
