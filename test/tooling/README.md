# Lint a guardraily

`bun run lint` a `bun run lint:check` jen kontrolují. `bun run lint:fix` opraví
kód i formát a znovu spustí celou lint bránu. `bun run lint:guardrails` spouští
kontroly CSS a projekt `unit` jen nad touto složkou, bez přípravy Nuxtu.
Stejná brána běží v CI a v `.claude/hooks/verify.sh` přes `lint:check`.

## Konvence sdílené s DENem

Pravidla jsou přizpůsobená struktuře a kontraktům Fakturianu. Přísnější zdejší
pravidlo má přednost, zejména samostatný `await`, validace, testovací značky a objekty.

| Kde                      | Co hlídá                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `tools/lint/rules/*.ts`  | Každé pravidlo ve vlastním souboru: řádkování, validace konvencí, struktura kódu a rozhodovací složitost.                        |
| `tools/lint/rules/*.mjs` | Samostatná pravidla pro počet událostí, kořen composables a podmíněné testové kroky.                                             |
| `eslint.config.ts`       | PascalCase komponent, zákaz mutace props, nejvýš sedm props, události na konci atributů, zákaz nativního `<a>` a `@vue:*` hooků. |
| `.oxlintrc.json`         | Zákaz `defineExpose`, script URL, nepřímého `eval` a zbytečných typových asercí; stávající pravidla Fakturianu.                  |

`tools/lint/oxlint-fakturian.ts` a `tools/lint/guardrails.mjs` pouze registrují pravidla.
Společné typy a skutečně sdílené AST pomocníky drží `tools/lint/rules/shared/`. Testy
importují jednotlivá pravidla přímo.

Složitost nepočítá `?.`, `??`, výchozí parametry ani `&&`/`||` při skládání hodnot.
Každá vnořená funkce má vlastní počet. Prázdné řádky doplňuje Oxlint po formátování.

Kontrola composables rozpozná přejmenované importy. Celá složka `src/plugins/`
dovoluje i vnořená volání; `useOverlay` je povolený také v obsluze dialogů.

Kontrola testů rozpozná importové aliasy, `each`, vnořené funkce a předčasný návrat
přeskakující aserce. Výpočty hodnot, implementace mocků a callbacky bez testových kroků
jsou povolené. Callback prohlížeče smí podmíněně pracovat s DOM, nesmí podmínit aserci.
Generovaný model souběhu lze deklarovat samostatně a ověřit přes `assert`;
`vitest/no-standalone-expect` zná `asyncProperty` a `property` jako testové bloky.

## Statické kontroly aplikace

| Soubor                            | Co hlídá                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `no-dead-buttons.spec.ts`         | Tlačítka mají akci, navigaci nebo submit. Spouštěče Nuxt UI včetně zavíracího slotu modálu obsluhuje jejich rodič. |
| `required-aria.spec.ts`           | Povinnost na `UFormField` odpovídá `aria-required` vstupu nebo `required` výběru.                                  |
| `required-label-asterisk.spec.ts` | Ruční hvězdičky povinnosti mají barvu `text-danger`.                                                               |
| `skeleton-aria-hidden.spec.ts`    | Skeletony jsou skryté pro čtečku.                                                                                  |
| `no-infinite-animation.spec.ts`   | Dekorativní animace mají konec; indikátory načítání mohou běžet nepřetržitě.                                       |
| `icons.spec.ts`                   | Statická jména ikon v šablonách, konfiguraci a TypeScriptu existují v kolekci Lucide.                              |
| `no-native-date.spec.ts`          | Nativní `Date` není ani ve Vue šablonách a HTML skriptech v `src/` a `public/`.                                    |
| `no-orphan-files.spec.ts`         | Na soubory aplikačních modulů vede import nebo auto-import.                                                        |
| `no-unused-exports.spec.ts`       | Export má použití i mimo svou deklaraci.                                                                           |

Hledání použití zahrnuje frontend, hlavní proces, nástroje, podporu testů a showcase harness,
protože sdílená schémata a výpočty mají platné konzumenty i tam. Samotný spec použitím není.
Nuxt vstupy a typové deklarace nejsou kandidáti na osiřelé soubory. Kontrola exportů hledá
jména syntakticky; neprokazuje dosažitelnost celého grafu importů.

Detektory mají ověřovací scénáře pro porušení i povolené tvary. Skriptová pravidla běží
přes skutečný `RuleTester` Oxlintu. Statické kontroly šablon nic nemountují.

Konvence specifické pro DEN se neuplatňují: jeho OpenAPI a objekty služeb, registr mocků,
vládní ikony, rozměry tématu, stránkové titulky, demo režim a SignalR. Fakturian má vlastní
IPC, Lucide a designové škály. Zákaz prázdného kořenového `v-if` se nepřebírá:
komponenty jako `FieldError` se záměrně vykreslují jen při chybě. Pravidla zapnutá v DENu
jen na zkušebním souboru (podmíněný spread a nenulový `v-model`) se plošně nezapínají.
`nextTick` slouží ve Fakturianu i zaměření nového řádku.
