<script setup lang="ts">
useSeoMeta({
	title: 'Funkce Fakturianu — co appka umí a co vědomě neumí',
	description:
		'Přehled funkcí: faktury a dobropisy v PDF s ISDOC, QR platba, ceník s ročními limity, výdaje, Fio i MCP pro AI agenta.',
});

defineOgImage('Default', {
	title: 'Co Fakturian umí',
	description: 'A co vědomě neumí — obojí je napsané nahlas.',
});

const areas = [
	{
		id: 'doklady',
		heading: 'Doklady',
		items: [
			['Faktury', 'Vystavení, editace, duplikace a smazání do Koše. Číslo se přiděluje z tvé řady, jde přepsat.'],
			['PDF s vloženým ISDOC', 'Doklad je zároveň strojově čitelný — účetní ho naimportuje bez přepisování.'],
			[
				'Čtyři vzhledy dokladu',
				'Sloupec, Částka, Akademik, Dopis. Náhled z tvých údajů, volba platí pro další uložení.',
			],
			['Dobropisy', 'Opravný doklad navázaný na původní fakturu, se zápornými položkami.'],
			['Vlastní číselná řada', 'Formát jako `{RRRR}{NNNN}` i navázání na řadu z jiného softwaru.'],
			['Fakturované období', 'Výchozí minulý měsíc; určuje i rok, do kterého spadne vykázaná položka ceníku.'],
			['Měna', 'CZK výchozí, jde přepnout. Faktura zůstává v češtině.'],
		],
	},
	{
		id: 'penize',
		heading: 'Peníze',
		items: [
			[
				'QR platba',
				'SPAYD kód přímo na dokladu, pro CZK a EUR. U jiných měn se negeneruje — banka by ho odmítla.',
			],
			[
				'Párování plateb z Fia',
				'Podle variabilního symbolu a částky. Token v Klíčence macOS, doporučeně read-only.',
			],
			['Upomínka', 'U faktury po splatnosti připraví e-mail s číslem, částkou a počtem dní po splatnosti.'],
			['Výdaje a přijaté doklady', 'Každý doklad zvlášť. PDF s ISDOC se přetažením vyplní samo.'],
			[
				'Sledování limitu plátcovství',
				'Klouzavých 12 měsíců proti 2 000 000 Kč — počítá se z obratu, ne z marže.',
			],
		],
	},
	{
		id: 'evidence',
		heading: 'Evidence',
		items: [
			['Odběratelé', 'Dotažení z ARESu podle IČO, poznámky (sazby, kontakt na účetní) mimo doklad.'],
			[
				'Ceník',
				'Opakující se položky s jednotkou, cenou a ikonkou; interní poznámka se na doklad nedostane. Po kliknutí je vidět, na kterých fakturách je položka vykázaná.',
			],
			[
				'Roční limit položky',
				'Nepovinné „maximálně ročně" v jednotce položky — dovolená, paušál, školicí dny. Faktura přes limit neprojde validací; smazaná faktura i dobropis množství vrací.',
			],
			['Přehled', 'Obrat i marže zvlášť, zaplaceno/nezaplaceno, po splatnosti, graf období, top dlužníci.'],
		],
	},
	{
		id: 'data',
		heading: 'Data a zálohy',
		items: [
			[
				'Vault = tvoje složka',
				'PDF v `faktury/`, konfigurace a evidence v JSON. Čitelné bez appky, přenositelné kamkoli.',
			],
			['Rotující snímky', 'Posledních zhruba deset verzí datových souborů pro případ omylu.'],
			['Import z jiného softwaru', 'PDF s ISDOC z Fakturoidu, iDokladu a dalších naplní historii i odběratele.'],
			[
				'Převzetí složky',
				'Appka projde složku plnou PDF a nabídne, co vypadá jako tvoje vydané faktury. Sken sám nic nemění.',
			],
			['Atomický zápis', 'Zápis přes dočasný soubor a přejmenování — výpadek uprostřed neporuší data.'],
		],
	},
	{
		id: 'integrace',
		heading: 'Integrace',
		items: [
			['ARES', 'Doplnění názvu, adresy, IČO a DIČ podle IČO.'],
			['Fio banka', 'Stažení transakcí a párování plateb.'],
			[
				'Claude connector (MCP)',
				'Agent čte doklady, výdaje i vykázané položky ceníku a umí vystavit fakturu. Běží proti otevřené appce.',
			],
			[
				'E-mail',
				'Apple Mail a Outlook dostanou rozepsanou zprávu i s přílohou; ostatní klienti `mailto:` a odhalení PDF ve Finderu.',
			],
		],
	},
	{
		id: 'ovladani',
		heading: 'Ovládání',
		items: [
			['⌘P paleta', 'Skok kamkoli a rychlé akce z klávesnice.'],
			['Nativní okno', 'Systémové menu, přetahování za lišty, zapamatovaná pozice okna.'],
			['Světlý a tmavý režim', 'Podle systému i ručně.'],
			['Logo na dokladu', 'Uložené ve vaultu, propíše se do všech vzhledů.'],
		],
	},
];

const missing = [
	['DPH a plátcovství', 'Fakturian je pro neplátce. Sazby, přiznání ani kontrolní hlášení nepřidáme.'],
	[
		'Vlastní cloud a sync',
		'Zálohu i synchronizaci řeší to, kam si složku dáš. Stavět cloud by popřelo smysl produktu.',
	],
	[
		'Odesílání e-mailů (SMTP)',
		'Appka otevře tvého klienta. Vlastní odesílání znamená účet, heslo a starost o doručitelnost.',
	],
	[
		'Měření času',
		'Hodiny se zadávají jako běžná položka, sazba z ceníku. Timer je vyřešený problém a řeší ho jiné nástroje líp.',
	],
	['Windows a mobil', 'Zatím ne. Windows je v plánu, mobil ne — vault na iOS je jiný problém než appka.'],
	['Souběžná práce ze dvou strojů', 'Vault používej v jednu chvíli z jednoho počítače.'],
];
</script>

<template>
	<div>
		<header class="page pt-14 pb-6">
			<p class="eyebrow">Funkce</p>
			<h1 class="mb-4 max-w-[18ch]">Co appka umí — a co vědomě neumí</h1>
			<p class="lede">
				Seznam je úplný, ne výběrový. Co v něm není, Fakturian neumí; co je v něm, funguje v hotové appce.
			</p>
			<StatusNote compact class="block mt-6" />
		</header>

		<section v-for="o in areas" :id="o.id" :key="o.id" class="page section">
			<h2>{{ o.heading }}</h2>
			<!-- Řádek výpisu: název vlevo, popis vpravo; v úzkém okně pod sebou. -->
			<ul class="list-none mt-6 mx-0 mb-0 p-0 max-w-none border-t border-(--line)">
				<li
					v-for="[name, description] in o.items"
					:key="name"
					class="grid items-baseline py-4 px-0 border-b border-(--line) grid-cols-[minmax(0,1fr)] gap-1 min-[800px]:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)] min-[800px]:gap-6">
					<span class="font-[620]">{{ name }}</span>
					<span class="muted text-note">{{ description }}</span>
				</li>
			</ul>
		</section>

		<section class="page section">
			<h2>Co Fakturian nedělá</h2>
			<p class="lede">
				Tohle nejsou nedodělky, ale rozhodnutí. Když potřebuješ něco z toho, je lepší vědět to teď než po
				měsíci.
			</p>
			<!-- Řádek výpisu: název vlevo, popis vpravo; v úzkém okně pod sebou. -->
			<ul class="list-none mt-6 mx-0 mb-0 p-0 max-w-none border-t border-(--line)">
				<li
					v-for="[name, description] in missing"
					:key="name"
					class="grid items-baseline py-4 px-0 border-b border-(--line) grid-cols-[minmax(0,1fr)] gap-1 min-[800px]:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)] min-[800px]:gap-6">
					<span class="font-[620]">{{ name }}</span>
					<span class="muted text-note">{{ description }}</span>
				</li>
			</ul>
		</section>
	</div>
</template>
