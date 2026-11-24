# Lint a guardraily

`bun run lint` opraví kód i formát, pak spustí kontroly CSS a projekt `unit` jen
nad touto složkou, bez přípravy Nuxtu. Stejná brána běží v CI (opravitelný nález
ji shodí přes `git diff --exit-code`) a v `.claude/hooks/verify.sh`.

## Konvence sdílené s DENem

Pravidla jsou přizpůsobená struktuře a kontraktům Fakturianu. Přísnější zdejší
pravidlo má přednost, zejména samostatný `await`, validace, testovací značky a objekty.

| Kde                     | Co hlídá                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `tools/lint/rules/*.ts` | Každé pravidlo ve vlastním souboru: řádkování, validace konvencí, struktura kódu a rozhodovací složitost.                        |
| `eslint.config.ts`      | PascalCase komponent, zákaz mutace props, nejvýš sedm props, události na konci atributů, zákaz nativního `<a>` a `@vue:*` hooků. |
| `.oxlintrc.json`        | Zákaz `defineExpose`, script URL, nepřímého `eval` a zbytečných typových asercí; stávající pravidla Fakturianu.                  |

`tools/lint/oxlint-fakturian.ts` pouze registruje pravidla.
Společné typy a skutečně sdílené AST pomocníky drží `tools/lint/rules/shared/`. Testy
importují jednotlivá pravidla přímo.

Složitost nepočítá `?.`, `??`, výchozí parametry ani `&&`/`||` při skládání hodnot.
Každá vnořená funkce má vlastní počet. Prázdné řádky doplňuje Oxlint po formátování.

Kontrola composables rozpozná přejmenované importy. Celá složka `src/plugins/`
dovoluje i vnořená volání; `useOverlay` je povolený také v obsluze dialogů.

Podmínky v testech hlídá vestavěné `vitest/no-conditional-in-test` ve všech `*.spec.*`
a `*.test.*`. Generovaný model souběhu lze deklarovat samostatně a ověřit přes `assert`;
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
| `no-javascript.spec.ts`           | V repu není `.js`, `.mjs`, `.cjs` ani `.jsx`; zdrojáky, konfigurace i nástroje jsou v TypeScriptu.                 |

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
