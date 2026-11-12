---
name: styly
description: Jak se ve Fakturianu píše vzhled — Tailwind utility v class, kdy tvar patří do main.css a kdy do <style> bloku komponenty, tokeny jménem, zlomy split/wide, společný vzhled Nuxt UI v app.config.ts. Použij při každé úpravě class, <style> bloku, src/assets/css/main.css nebo src/app.config.ts.
---

# Vzhled

Vzhled se píše utilitami přímo do `class`. Co z pravidel níž hlídá nástroj, je u pravidla
napsané; `bun run lint:scales` a `bun run lint:dead-css` pouští i Stop hook.

## Kam tvar patří

Když utilita nestačí (kombinátor, pseudoelement, `:not()`), rozhoduje **kolik souborů tvar nosí**:

- **víc než jeden** → `src/assets/css/main.css`, slovník designu (`.page`, `.ftable`,
  `.form-grid`, `.state`);
- **právě jeden** → `<style>` blok v tom souboru (`lint:dead-css` hlásí tvar z `main.css`, který
  nosí jediný soubor, i tvar, který nenosí nikdo).

Blok v SFC je **nescoped** a začíná `@reference '~/assets/css/main.css';`. Scoped styl dá atribut
jen kořeni dítěte, takže na `<input>` uvnitř `UInput` nedosáhne; bez `@reference` `@apply`
nezná tokeny appky a překlad spadne. Hlídá `vue/enforce-style-attribute` a `lint:dead-css`.

**Tvar, který přebíjí jiný pořadím, se nestěhuje.** `.figures--compact > *` vyhrává nad
`.figures > *` jen tím, že v `main.css` stojí níž; v SFC by se pořadí ztratilo. Stejně
`.state--overdue` nad `.state`. Tvar, který vyhrává specificitou (`.cell-input.invalid`), se
stěhovat může. Výjimky drží `STAYS` v `tools/lint/check-dead-css.ts` i s důvodem.

**Než tvar dostane jméno, musí být co pojmenovat.** Třída, jejíž tělo je jedna utilita, je
přezdívka (`.overdue` za `text-danger`) a nezakládá se. Výjimka: jméno skládané za běhu
(`` `state--${stateOf(i)}` ``).

Do `main.css` patří jen tokeny (`@theme`, `:root`, `.dark`), základ dokumentu (`html`, `body`,
`:focus-visible`, rolovátko) a slovník designu. Píše se přes `@apply`; syrová deklarace jen tam,
kde utilita neexistuje (`@keyframes`, data-URI šipka v `@utility chevron`).

## Tokeny, zlomy, preflight

- **Role jménem, ne proměnnou:** `text-ink-2`, `bg-card`, `border-line-soft`. Ztlumení nese
  modifikátor krytí (`text-ink-2/80`), ne `color-mix`. `bg-(--bg)` zbyl jen v `main.css`.
- **Arbitrary hodnota tam, kde je token, je chyba** (`lint:scales` čte stupně z `@theme`). Nová
  hodnota mimo škálu znamená, že chybí stupeň.
- **Zlomy jsou dva: `split:` (820 px) a `wide:` (960 px).** Okno se nezmenší pod 760 px
  (`MIN_WINDOW_SIZE` v `desktop/window-size.ts`), takže `min-[561px]:` je mrtvý kód. `sm:`, `md:` …
  zůstávají zapnuté kvůli Nuxt UI, v našem markupu se nepíšou. Hlídá `lint:scales`.
- **Preflight už nuluje `margin`, `padding`, `border` a odrážky.** `m-0`, `py-0`, `border-0`,
  `list-none` na obyčejném elementu nic nedělají; smysl mají jen s `!` proti Nuxt UI nebo tvaru ze
  slovníku (`m-0!`). Hlídá `lint:scales`.
- **Pravidla v `main.css` stojí mimo `@layer`**, takže přebijí každou utilitu z markupu — jinak by
  třídy Nuxt UI přerazily metriku ovládacích prvků. Přebít tvar ze slovníku na jednom místě jde
  jen utilitou s vykřičníkem (`grid-cols-1!`).

## Nuxt UI

Společný vzhled komponent patří do `src/app.config.ts` (`ui.*.slots`, varianty,
`compoundVariants`). Lokální `:ui` jen pro specifický vnitřní slot nebo dynamický stav. Rozměry
kořene patří do `class`. Sdílené styly se nekopírují do stránek a nevznikají obalové komponenty jen
kvůli schování `:ui`.

## Stav a šablona

- Stav, na kterém závisí vzhled (vybraný řádek, rozepsaná položka), se veze na `data-*` atributu
  (`:data-selected`, `:data-draft`). Vue ho při `false` nevykreslí, Tailwind na něj má variantu
  (`data-selected:…`) a test se ptá na atribut, ne na třídu.
- Komentář nesmí být prvním uzlem `<template>`: Vue z komponenty udělá fragment, přestane dědit
  atributy (`class`, `data-testid` od rodiče) a `wrapper.element` v testu ukáže na komentář.
  Komentář patří dovnitř kořenového prvku nebo za něj.

## Kanonické třídy

Tailwind IntelliSense hlásí `suggestCanonicalClasses`; v repu na to lint není a `lint:scales` je
v jednom přísnější — chce roli jménem (`stroke-line`) tam, kde kanonizace skončí u
`stroke-(--line)`. Fixtures v `tools/lint/check-tailwind-scales.ts` a
`test/check-tailwind-scales.spec.ts` jsou nekanonické schválně.
