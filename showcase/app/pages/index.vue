<script setup lang="ts">
useSeoMeta({
	title: 'Fakturace bez cloudu pro živnostníky',
	description:
		'Desktopová appka pro živnostníky-neplátce DPH: faktury, náklady a vykázané dny pohromadě. Data zůstávají ve tvé složce. macOS, offline.',
	ogTitle: 'Fakturian — vidíš, jak na tom podnikání je',
	ogDescription: 'Faktury, náklady a vykázané dny pohromadě. Lokálně, bez cloudu a bez účtu.',
});

defineOgImage('Default', {
	title: 'Vidíš, jak na tom podnikání je',
	kicker: 'Fakturian',
});

useSchemaOrg([
	defineSoftwareApp({
		name: 'Fakturian',
		applicationCategory: 'BusinessApplication',
		operatingSystem: 'macOS',
		description:
			'Desktopová fakturace pro živnostníky-neplátce DPH. Faktury, náklady a vykázané dny lokálně, bez cloudu.',
	}),
]);

const features = [
	{
		id: 'data',
		title: 'Tvoje data leží ve tvé složce',
		claim: 'Faktury jsou PDF, zbytek jsou JSON soubory. Otevřeš je čímkoli, zálohuješ jak chceš.',
		text: 'Žádná databáze, žádný účet, žádný server. Vault je obyčejná složka: `faktury/2026001.pdf`, `.fakturian/vydaje.json`, `.fakturian/platby.json`. Zálohu a synchronizaci řešíš tím, kam ji dáš — iCloud, Dropbox, Time Machine, Git nebo USB. Odejít od appky znamená prostě si tu složku nechat.',
		shot: 'feature-vault',
		alt: 'Datová složka Fakturiana: PDF faktury a JSON soubory s výdaji a platbami',
		video: 'vault',
		duration: '12 s',
		wide: true,
	},
	{
		id: 'limit-ceniku',
		title: 'Dovolená, kterou fakturuješ, se hlídá sama',
		claim: 'Roční limit u položky ceníku. Faktura, která ho překročí, se neuloží.',
		text: 'Máš dohodnutých dvacet dní ročně a vykazuješ je jako odpracovaný čas. Položka ceníku dostane roční limit a palmu, Fakturian pak ví, kolik jsi jich vybral, na kterých fakturách, a nepustí přes limit. Stejně hlídá paušál nebo počet školicích dnů.',
		shot: 'feature-limit-ceniku',
		alt: 'Položka ceníku s ročním limitem: vykázané hodiny a faktury, na kterých byly',
		video: 'dovolena',
		duration: '15 s',
	},
	{
		id: 'platby',
		title: 'Zaplacené faktury si odškrtne banka',
		claim: 'Fio API spáruje platbu podle variabilního symbolu a částky.',
		text: 'Token zadáš jednou (ideálně read-only) a uloží se do Klíčenky macOS. Pak stačí tlačítko: co sedí na symbol i částku, se označí jako zaplacené i s datem. Co nesedí, uvidíš zvlášť — appka si nic nedomýšlí.',
		shot: 'feature-platby',
		alt: 'Seznam faktur se stavy zaplaceno a po splatnosti',
		video: 'platby',
		duration: '12 s',
	},
	{
		id: 'mcp',
		title: 'AI agent nad tvým účetnictvím',
		claim: 'Claude connector čte i vystavuje doklady přes běžící appku.',
		text: 'Zeptáš se „kolik mi letos dluží Studio Kolmá" nebo necháš vystavit fakturu podle minulé. Funguje to proto, že data jsou soubory na disku — agent nepotřebuje cloudové API, mluví s appkou přes lokální socket.',
		shot: 'feature-mcp',
		alt: 'Stránka Integrace s příkazem pro registraci Claude connectoru',
		video: 'mcp',
		duration: '15 s',
	},
];

const facts = [
	{
		k: 'macOS',
		v: 'Nativní okno, systémové menu, ⌘P paleta',
	},
	{
		k: 'Offline',
		v: 'Online jsou jen dvě volitelné funkce: ARES a Fio',
	},
	{
		k: 'Formát dat',
		v: 'PDF s vloženým ISDOC + JSON, čitelné bez appky',
	},
	{
		k: 'Bez účtu',
		v: 'Žádná registrace, žádné přihlašování, žádná telemetrie',
	},
];

const steps = [
	{
		n: '01',
		t: 'Zvolíš složku',
		d: 'Při prvním spuštění vybereš, kde mají data ležet. Když v ní už doklady jsou — třeba export z jiného programu — appka je nabídne převzít.',
	},
	{
		n: '02',
		t: 'Vyplníš své údaje',
		d: 'Jméno, IČO, účet, formát čísla faktury. Odběratele si dotáhneš z ARESu podle IČO, ceník si založíš, jak potřebuješ.',
	},
	{
		n: '03',
		t: 'Fakturuješ',
		d: 'Doklad se uloží jako PDF s vloženým ISDOC a QR platbou. Odeslání otevře tvůj mailový klient s přiloženým souborem.',
	},
];

const useCases = [
	{
		to: '/pro/programatory',
		t: 'Programátoři',
		d: 'Desetinné hodiny se sazbou z ceníku',
	},
	{
		to: '/pro/konzultanty',
		t: 'Konzultanti',
		d: 'Fakturovaná dovolená pod kontrolou',
	},
	{
		to: '/pro/remeslniky',
		t: 'Řemeslníci',
		d: 'Ceník, QR platba, tisk',
	},
	{
		to: '/pro/male-firmy',
		t: 'Malé firmy',
		d: 'Sdílená složka a záloha na jedno kliknutí',
	},
	{
		to: '/prechod/z-fakturoidu',
		t: 'Přechod z Fakturoidu',
		d: 'Import historie i číselné řady',
	},
	{
		to: '/prechod/z-idokladu',
		t: 'Přechod z iDokladu',
		d: 'Převzetí složky plné PDF',
	},
	{
		to: '/reseni/bez-cloudu',
		t: 'Bez cloudu',
		d: 'Data nikam neodcházejí',
	},
	{
		to: '/reseni/offline',
		t: 'Offline provoz',
		d: 'Funguje bez internetu',
	},
	{
		to: '/reseni/ai-agent',
		t: 'S AI agentem',
		d: 'MCP nad vlastním vaultem',
	},
];

const questions = [
	{
		q: 'Je Fakturian pro plátce DPH?',
		a: 'Není a nebude. Počítá s neplátcem: na dokladu je věta „Nejsem plátce DPH“, nikde se nezadávají sazby ani se nedělá přiznání. Pokud jsi plátce, tahle appka ti nesedne.',
	},
	{
		q: 'Co když Fakturian skončí nebo appku přestanu používat?',
		a: 'Zůstane ti složka s daty. Faktury jsou samostatná PDF s vloženým ISDOC, zbytek jsou čitelné JSON soubory. Nic se neexportuje, protože nic není zamčené.',
	},
	{
		q: 'Jak se zálohuje?',
		a: 'Tím, kam složku dáš — iCloud Drive, Dropbox, Time Machine, Git nebo USB. Navíc appka drží rotující snímky posledních verzí, ze kterých se dá vrátit omyl.',
	},
	{
		q: 'Můžu s daty pracovat na dvou počítačích?',
		a: 'Střídavě ano, souběžně ne. Vault v cloudové složce používej v jednu chvíli z jednoho stroje — dvě appky nad jedním souborem znamenají tichou ztrátu dat.',
	},
	{
		q: 'Funguje to na Windows?',
		a: 'Zatím ne. První verze je jen pro macOS, protože nativní dotažení je hlavní část hodnoty a dělat ho pro dva systémy naráz znamená nedodělat ani jeden.',
	},
	{
		q: 'Posílá appka něco na internet?',
		a: 'Jen když si o to řekneš: dotažení firmy z ARESu a stažení plateb z Fia. Žádná telemetrie, žádné přihlašování, žádné ověřování licence.',
	},
];
</script>

<template>
	<div>
		<!-- Hero -->
		<section
			class="page grid gap-9 pt-14 pb-9 min-[980px]:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)] min-[980px]:items-center min-[980px]:gap-14 min-[980px]:pt-22 min-[980px]:pb-14">
			<div>
				<p class="eyebrow">Fakturace pro živnostníky · macOS</p>
				<h1 class="mb-4">
					Vidíš, jak na tom podnikání je.
					<br />
					Ne jen kolik jsi vyfakturoval.
				</h1>
				<p class="lede">
					Fakturian drží faktury, náklady a vykázané dny pohromadě — v obyčejných souborech ve složce, kterou
					si zvolíš. Bez cloudu, bez účtu, offline.
				</p>
				<StatusNote class="block mt-6" />
			</div>

			<ProductShot
				name="hero-prehled"
				window
				priority
				alt="Přehled Fakturiana: vyfakturováno tento měsíc, zaplaceno a nezaplaceno, graf fakturace za období a sledování limitu plátce DPH"
				caption="Přehled s ukázkovými daty — skutečná appka, ne návrh." />
		</section>

		<!-- Důkaz místo social proofu -->
		<section class="page section">
			<!-- Čísla místo referencí. Sloupce dělí vlásečnice, ne mezera; v úzkém okně
			     jdou pod sebe a levý okraj mřížky zmizí i s nimi. -->
			<div class="grid gap-0 border-t border-(--line) min-[760px]:grid-cols-4 min-[760px]:border-l">
				<div v-for="f in facts" :key="f.k" class="grid gap-1 p-4 border-b border-(--line) min-[760px]:border-r">
					<span class="font-[640]">{{ f.k }}</span>
					<span class="text-note text-(--ink-2)">{{ f.v }}</span>
				</div>
			</div>
		</section>

		<!-- Hlavní klip -->
		<section class="page section">
			<p class="eyebrow">Za půl minuty</p>
			<h2>Od prázdné obrazovky k hotovému dokladu</h2>
			<p class="lede">
				Nová faktura, odběratel z ARESu podle IČO, položky z ceníku, uložení do PDF s QR platbou.
			</p>
			<VideoDemo
				name="hlavni"
				title="Fakturian za třicet vteřin"
				caption="Nahráno v appce s ukázkovými daty. Titulky jsou součástí videa."
				class="block mt-6" />
		</section>

		<!-- Hlavní funkce -->
		<section id="funkce" class="page section">
			<p class="eyebrow">Čtyři věci, kvůli kterým to stojí za přechod</p>
			<h2>Co Fakturian umí jinak</h2>

			<!-- Text a obrázek vedle sebe, strany se u každé funkce střídají; široká
			     funkce dostane jeden sloupec a obrázek přes celou šířku. -->
			<div class="grid gap-14 mt-9">
				<article
					v-for="f in features"
					:id="f.id"
					:key="f.id"
					class="grid gap-6 items-center min-[900px]:gap-9"
					:class="
						f.wide
							? 'min-[900px]:grid-cols-[minmax(0,1fr)]'
							: 'min-[900px]:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] min-[900px]:even:[&>div:first-child]:order-2'
					">
					<div>
						<h3>{{ f.title }}</h3>
						<p class="mb-3 text-lede font-[560]">{{ f.claim }}</p>
						<p class="muted">{{ f.text }}</p>
					</div>
					<FeatureMedia
						:shot="f.shot"
						:alt="f.alt"
						:video="f.video"
						:video-title="f.title"
						:duration="f.duration" />
				</article>
			</div>
		</section>

		<!-- Jak to funguje -->
		<section class="page section">
			<p class="eyebrow">Od instalace k první faktuře</p>
			<h2>Tři kroky, žádná registrace</h2>
			<ol class="list-none mt-9 mx-0 mb-0 p-0 grid gap-6 max-w-none min-[760px]:grid-cols-3">
				<li v-for="k in steps" :key="k.n" class="pt-4 border-t-2 border-(--accent)">
					<span class="num text-note text-(--ink-3)">{{ k.n }}</span>
					<h3 class="mt-[0.35rem] mx-0 mb-2 text-lede">{{ k.t }}</h3>
					<p class="muted">{{ k.d }}</p>
				</li>
			</ol>
		</section>

		<!-- Use-casy -->
		<section class="page section">
			<p class="eyebrow">Pro koho to je</p>
			<h2>Devět situací, ve kterých dává smysl</h2>
			<!-- Dva sloupce řádků, ne dlaždice: je to rozcestník, ne nabídka produktů. -->
			<ul
				class="list-none mt-6 mx-0 mb-0 p-0 grid gap-0 max-w-none border-t border-(--line) min-[760px]:grid-cols-2 min-[760px]:gap-x-9">
				<li v-for="p in useCases" :key="p.to">
					<NuxtLink
						:to="p.to"
						class="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-4 items-baseline py-4 px-0 border-b border-(--line) no-underline [&:hover_strong]:text-(--accent-ink)">
						<strong>{{ p.t }}</strong>
						<span class="muted text-note">{{ p.d }}</span>
					</NuxtLink>
				</li>
			</ul>
		</section>

		<!-- Námitky -->
		<section class="page section">
			<p class="eyebrow">Než se rozhodneš</p>
			<FaqList :items="questions" title="Co se ptají nejčastěji" />
		</section>

		<!-- Cena a stav -->
		<section class="page section">
			<p class="eyebrow">Cena a dostupnost</p>
			<h2>Jednorázová platba, žádné předplatné</h2>
			<p class="lede">
				Za appku se platí jednou. Žádné ověřování licence, žádné DRM, žádný účet — ochranou je pohodlí, ne
				zámek. Konkrétní cena bude na téhle stránce, jakmile bude vydání připravené.
			</p>
			<StatusNote />
			<p class="muted mt-4">
				Podrobnosti o licenci a distribuci najdeš na stránce
				<NuxtLink to="/cena">Cena a dostupnost</NuxtLink>
				.
			</p>
		</section>
	</div>
</template>
