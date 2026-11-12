# Prezentační web Fakturianu

Statický web (Nuxt 4 + @nuxt/content + @nuxtjs/seo) nasazovaný na **Vercel**.
Obrázky a videa v něm nejsou mockupy — vznikají
spuštěním skutečné appky s demo daty (`capture/`).

Je to samostatný projekt uvnitř repa: vlastní `package.json`, vlastní
`node_modules`, vlastní `bun.lock` (žádný workspace s kořenem). Do kódu appky nesahá.

## Rychlý start

```bash
cd showcase
bun install
bun run dev         # http://localhost:3900
```

## Struktura

```
showcase/
├── PLAN.md              rozhodnutí o obsahu (pozicování, hlavní funkce, use-casy)
├── app/                 stránky, komponenty, styly
├── content/             use-case stránky a nápověda v Markdownu
├── capture/             toolkit na screenshoty a videa (ze skillu app-showcase)
├── harness/             demo data + náhrada nativní vrstvy pro focení
├── scenes/              scénáře videí
├── shots.config.ts      seznam obrázků
├── stage.ts             sdílené nastavení focení
├── public/media/        hotové obrázky a videa (verzované)
└── media/raw/           snímky videí (do gitu nepatří)
```

## Vzhled

Tailwind v4 jako Vite plugin, žádný Nuxt modul — web nemá `@nuxt/ui`, který ho
v appce přináší s sebou. Komponenty ani stránky **nemají `<style>` blok**: vzhled
se píše utilitami do `class`.

Jediný soubor s CSS je `app/assets/css/main.css` a jsou v něm tři věci:

- **tokeny** (`@theme` pro písmo, stupně a poloměry; `:root` pro plochy, které
  se v tmavém režimu přepínají naráz),
- **základ dokumentu** ve vrstvě `base` — nadpisy, odstavce, odkazy a seznamy,
  protože text nápovědy kreslí `@nuxt/content` z markdownu, kam se `class`
  nedostane (vrstva `base` je tam proto, aby utilita v šabloně přebila výchozí
  stupeň: `text-h2` na nadpisu návodu, `no-underline` na odkazu v liště),
- **slovník** (`.page`, `.section`, `.btn`, `.shot`, `.prose`) — tvary, které se
  opakují, psané přes `@apply`.

`.prose` a jeho modifikátory (`--case`, `--help`) jsou vzhled markdownu; všechno
ostatní, co má `class`, se stylizuje v šabloně.

## Obrázky a videa

Vizuální baseline všech stránek prezentačního webu jsou v `visual-baselines/desktop/`.
Po změně vzhledu spusť `bun run generate`, potom `bun run preview` a v druhém terminálu
`bun run baselines:pages`. Skript zachytí pět hlavních stránek a všechny články v `content/`
v šířce 1440 px.

Předpoklad: **sestavená appka** a běžící statický server.

```bash
cd ..                       # kořen repa
bun run generate            # build appky do .output/public
cd showcase
bun run serve:app &         # servíruje appku na :3902

bun run shots                                                # všechny obrázky
node capture/shoot.ts --config shots.config.ts --only hero-prehled

node capture/record.ts --scene scenes/main.ts --out media/raw
node capture/encode.ts --frames media/raw/hlavni --out public/media --width 1440 --crf 26
cp media/raw/hlavni/hlavni.vtt public/media/           # titulky k videu
```

Detaily toolkitu jsou v [capture/README.md](capture/README.md).

**Demo data** jsou v `harness/demo-data.ts`: jeden živnostník, pět odběratelů,
rok 2026 do poloviny srpna. Firmy, IČO i částky jsou vymyšlené (IČO mají jen
platnou kontrolní číslici, aby prošla validací appky).

Appka nemá v kódu `data-shot` kotvy a mít je nemusí — prvky pro výřezy se
označují až v prohlížeči podle textu (viz `mark()` v `shots.config.ts`).
Když se UI přejmenuje, selže focení, ne appka.

## Nasazení na Vercel

Projekt na Vercelu má jako Root Directory `showcase`. Preset Nuxt spustí
`bun run build` (= `nuxt generate`) a Nitro na Vercelu vyrobí statický výstup
sám, žádná konfigurace v repu není potřeba. Po přidání vlastní domény se musí
změnit `site.url` v `nuxt.config.ts`, protože z něj se berou canonical,
sitemapa i OG obrázky.

## Kontrola před nasazením

```bash
bun run generate
bun run audit:web           # title/description, H1, alt, odkazy, sitemap, velikosti
```

## Až bude co stahovat

Stav produktu drží jediná komponenta: `app/components/StatusNote.vue`. Až bude
podepsaný a notarizovaný build, přepíše se ona (a doplní se cena na
`app/pages/cena.vue`). Nikde jinde se o dostupnosti nemluví.
