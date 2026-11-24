# Model kvality

Jediný popis toho, jak se ve Fakturianu ověřuje kvalita: pravidla testů, brány,
prahy a co se před vydáním musí doložit. [AGENTS.md](../AGENTS.md) z něj drží
jen krátká pravidla s odkazem sem. Chybějící testy a otevřenou práci na
bránách vede [09-BACKLOG](09-BACKLOG.md) v oblastech `TEST` a `NAST`.

## Proč 100 % pokrytí nestačí

Pokrytí říká „řádek se vykonal", ne „někdo ověřil, co udělal". Sada může mít
plné pokrytí řádků, a přesto v ní nikdo nezmáčkne „Uložit", schémata souborů
vaultu neběží ani jednou a druhý argument `save()` nemá jedinou aserci. Proto
platí:

1. **Aserce míří na hodnotu, ne na to, že se něco stalo.** `toHaveBeenCalled()`
   bez argumentů projde i s nesmyslem, `toBeTruthy()` projde na `"0"`. Kde na
   hodnotě záleží, patří `toHaveBeenCalledWith(…)` nebo `toEqual` nad tím, co
   uvidí uživatel.
2. **Nikdy `vi.mock` modulu, jehož kontrakt zrovna testuješ.** Schémata souborů
   vaultu (`vaultDataSchema`, `paymentsFileSchema`, `expensesFileSchema` …)
   musí v testech běžet doopravdy, včetně cesty „poškozený JSON".
3. **Každé volání `commands.*` má test odmítavé cesty.** IPC selhává (zamčený
   vault, plný disk, chybějící soubor) a chování při odmítnutí je součást
   kontraktu.
4. **Dnešek je `today()` z `utils/date`, ne `new Date()`.** Appka počítá
   v místní zóně; UTC v testu znamená test, který padne kolem půlnoci. Datum ve
   fixture se píše přes `date('2026-03-01')` a období přes `period('2026-03')`
   z `test/setup/dates.ts`.
5. **Hlavní proces (`desktop/`):** každé odmítnutí příkazu má test (grep hlášky
   ≠ test); dočasné složky nesou v názvu PID a test je po sobě smaže; externí
   nástroje a služby systému (veraPDF, klíčenka) musí při nedostupnosti
   **padnout nahlas**, nikdy skončit zeleným přeskočením.
6. **U dotčeného souboru se před merge změří mutační skóre** (viz „Mutační
   testování"). Přeživší mutant je věta „tenhle řádek můžu rozbít a sada zůstane
   zelená". Skóre dotčeného souboru nesmí klesnout.
7. **Prahy pokrytí jsou podlaha a jdou jen nahoru** (viz „Ráčna").
   Nedosažitelná větev se nevyvažuje snížením prahu, ale smaže (obranné `?? ''`
   tam, kde hodnotu garantuje typ, `default:` v úplné mapě).

Každá nalezená chyba dostane regresní test a prověří se i rodina vstupů, do
které patří.

## Brány v `bun run check`

`bun run check` je jeden řetěz kroků; přesné pořadí je skript `check`
v `package.json`. Každý krok musí projít, jinak řetěz skončí.

| Krok                          | Co ověřuje                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `lint`                        | Oxlint, ESLint nad Vue skripty a šablonami, statické guardraily a kontroly CSS; podrobnosti v [test/tooling](../test/tooling/README.md) |
| `format:check`                | formát přes oxfmt                                                                                                                       |
| `typecheck`                   | typy frontendu, hlavního procesu (`desktop/tsconfig.json`), nástrojů, skriptů showcase a Vitest testů                                   |
| `typecheck:e2e`               | typy E2E scénářů a jejich podpory (`test/e2e/tsconfig.json`)                                                                            |
| `bun run test -- --coverage`  | Vitest projekty `unit`, `nuxt` a `desktop` a 100% prahy pro každý zahrnutý soubor                                                       |
| `generate`                    | statický Nuxt build                                                                                                                     |
| `desktop:build`               | esbuild hlavního procesu, validátoru ISDOC a preloadu do `.output/desktop/`                                                             |
| `bun audit --audit-level=low` | advisories JS závislostí                                                                                                                |

Vitest používá `tools/testing/required-tests-reporter.ts`. Prázdná nebo
přeskočená sada, skip/todo, neúspěšný hook, neošetřená chyba i úspěch až po
retry znamenají selhání. `allowOnly: false` zakazuje `.only`.
Čisté unit testy jsou v `test/unit/` a jejich soubory jsou
pojmenované podle testovaného tématu. V `test/tooling/` jsou `RuleTester` testy
pravidel Oxlintu, statické guardraily aplikace a testy bran kvality, které ověřují selhání Vitestu při
úmyslných poruchách v oddělených procesech. Vše běží v projektu `unit` a v `lint`.

`bun run lint` rovnou opravuje, co oxlint, ESLint a oxfmt opravit umějí; CI pak hlídá,
že oprava nic nezměnila. Typy frontendu a testů `test/` vybírá kořenový `tsconfig.json`
nad generovaným Nuxt configem; E2E má vlastní `test/e2e/tsconfig.json`.

### Mimo `check`

Kontroly `scripts/check-tailwind-scales.ts` (stupnice, tokeny, zlomy a zbytečné utility)
a `scripts/check-dead-css.ts` (použití tvarů z `main.css` a `@reference` v blocích `<style>`)
jsou součástí `lint`, tedy i `check`.

Pomalejší kroky nebo kroky, které potřebují prostředí, jaké běžná lokální brána
nemá:

| Příkaz                                                                                                                       | Co ověřuje                                                             |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `FUZZ_CASES=2000 bun run test -- --config vitest.mutation.config.ts --project desktop desktop/test/input-robustness.test.ts` | generativní testy vstupů zvenku s vyšším počtem případů                |
| `bun run mutants:ts`                                                                                                         | mutační testování frontendu i hlavního procesu                         |
| `bun run test:e2e`                                                                                                           | scénáře nad skutečným oknem Electronu včetně vizuální sady (viz „E2E") |
| `bun run test:release-smoke`                                                                                                 | start zabaleného `.app` a most MCP (viz „Smoke test balíčku")          |

## Pokrytí

`vitest.config.ts` skládá projekty `unit`, `nuxt` a `desktop` stejným způsobem
jako ostatní Nuxt projekty: konfigurace projektů jsou pohromadě ve
`vitest.projects.ts`. Samostatný běh `desktop` a Stryker používají
`vitest.mutation.config.ts`, který Nuxt projekt záměrně nenačítá.

`vitest.config.ts` používá `thresholds: { 100: true, perFile: true }`. Sto
procent příkazů, větví, funkcí a řádků musí splnit každý zahrnutý soubor, ne
jen globální průměr. Pokrytí zahrnuje `src/**` i `desktop/**/*.ts`; vyloučená
jsou data fixtures, testy a ukázky v `desktop/test/` a `desktop/examples/`
a soubory, které nenesou spustitelný kód (`*.d.ts`).

`src/bindings.ts` je součástí měření. Testy Vue vrstvy volají přes most
`globalThis.fakturian` (`test/setup/backend.ts`) skutečný `desktop/commands.ts`
nad dočasnou složkou, takže okno i hlavní proces běží doopravdy spolu. Projekt
`nuxt` k tomu přesměruje modul `electron` na `test/setup/electron.ts` (dialogy,
Finder, Koš, oznámení, vzhled okna) a síť ARES a Fio na rejstřík testu; token
Fio drží hlavní proces jen v paměti (`keepTokenInMemory`) a Mail.app se místo
`osascript` jen zapíše. Testy hlavního procesu nahrazují jen modul `electron`
(`vi.mock('electron', …)`); moduly `desktop/` běží v Node doopravdy, nad
skutečným souborovým systémem v dočasné složce.

Síťová logika (Fio, ARES) se testuje proti lokálnímu mock serveru
(`desktop/test/http.ts`), včetně chybových odpovědí, přesměrování
a odmítnutého spojení.

V8 neumí z pokrytí šablony odvodit všechny uživatelské stavy. Sto procent větví
proto nenahrazuje aserce nad vykresleným výsledkem a interakcemi.

## Ráčna

Práh je podlaha a smí se jen zvýšit. Když změna práh podstřelí, doplní se test
nebo se odstraní nedosažitelná větev. Snížit práh smí jen člověk se zapsaným
důvodem. Platí to pro pokrytí i mutační skóre.

## Mutační testování

Mutant provede malou změnu zdrojáku a spustí testy. Přeživší mutant dokazuje,
že danou změnu žádná aserce nezachytí.

```sh
bun run mutants:ts
bun run mutants:ts --mutate src/utils/expenses.ts
bun run mutants:ts --mutate desktop/numbering.ts
```

Výchozí rozsah je seznam `mutate` ve `stryker.config.ts`: vyjmenované soubory
`src/` a celý `desktop/` kromě testů, ukázek a `*.d.ts`. Runner dostává
`vitest.mutation.config.ts` s projekty `unit` a `desktop`; projekt `nuxt` by ke
každému mutantovi stavěl Nuxt runtime. Konfigurace znovu používá definice z
`vitest.projects.ts`. Testy `desktop` sahají na klíčenku,
sockety a veraPDF, mutační běh proto potřebuje macOS s veraPDF a běh mimo
sandbox.

`thresholds` mají `break: 100`: žádný přeživší mutant, mutant bez pokrytí ani
timeout. Wrapper `tools/mutation/mutants-ts.ts` navíc vyžaduje úspěšnou
baseline a úplný report. Výstupy jsou v `reports/mutation/`.

Mutační brána používá Vitest 5. `vitest` i `@vitest/coverage-v8` jsou
v `package.json` zamknuté přesně na `5.1.0`; runner
`@stryker-mutator/vitest-runner` podle verze Vitestu skládá názvy testů
oddělovačem, který odpovídá jeho `testNamePattern`. Díky tomu může `perTest`
analýza vybrat testy pro jednotlivé mutanty.

Ignorované mutanty (deklarativní konstrukce zod schémat, jejichž vstupy ověřují
přímé testy kontraktů) report vede zvlášť a do skóre se nepočítají.

Volby `Intl` stojí na modulu jako data (`satisfies Intl.DateTimeFormatOptions`)
a formátovač se staví až v těle funkce: mutant v řetězci volby pak shodí volání
v testu, ne import modulu. `as const` by tu byl chyba — pod ním Stryker
objektový literál nemutuje. Výjimkou je `czechPercent` v `utils/locales.ts`,
který zůstává na úrovni modulu; jeho hodnotu hlídá aserce v `test/unit/plural.spec.ts`.

V CI mutace neběží, celý rozsah trvá desítky minut. Pouští se lokálně
(`bun run mutants:ts`), u dotčeného souboru před merge a celé před vydáním.

## Generativní testování vstupů zvenku

```sh
FUZZ_CASES=2000 bun run test -- --config vitest.mutation.config.ts --project desktop desktop/test/input-robustness.test.ts
```

`desktop/test/input-robustness.test.ts` (`fast-check`) kontroluje hranice
s nedůvěryhodným obsahem:

1. ISDOC/XML parser, projekci do faktury a zpětnou serializaci,
2. načtení PDF, hledání ISDOC příloh a detekci podpisu,
3. JSON odpověď Fio a řádkový MCP protokol,
4. atomický zápis a nové načtení datového souboru vaultu,
5. Unicode čísla dokladů používaná jako názvy souborů.

Běh používá pevný seed; generované vstupy vycházejí z vzorků
v `desktop/test/fixtures/`. Přijatý ISDOC musí jít znovu serializovat a načíst,
PDF smí vrátit jen čitelnou ISDOC přílohu, MCP odpověď musí zůstat jedním
platným JSON řádkem, úspěšný zápis vaultu musí jít znovu načíst a přijaté
číslo dokladu musí tvořit jedinou relativní komponentu cesty. Běžná sada
spouští 64 případů na cíl, uvedený příkaz víc; počet určuje proměnná
`FUZZ_CASES`.

## Property testy proti modelu

Peníze, kalendář, číslování a čerpání limitů mají vedle tabulkových testů
generované vstupy porovnané s nezávislým modelem — model nesahá na testovaný
kód ani na jeho knihovnu:

| oblast    | model                                                    | kde                                                                |
| --------- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| peníze    | přesná aritmetika v `BigInt`, půlka od nuly, strop       | `test/unit/money.spec.ts`, `desktop/test/invoice/template.test.ts` |
| kalendář  | pořadové číslo dne (`days_from_civil`), měsíc jako index | `test/unit/date.spec.ts`                                           |
| číslování | množina použitých pořadí, další = max + 1 nebo start     | `test/unit/numbering.spec.ts`, `desktop/test/numbering.test.ts`    |
| limity    | součet množství po položce a roce, dobropis se znaménkem | `test/unit/pricelist.spec.ts`                                      |

Generuje se přes `fast-check` s pevným seedem (`test/setup/properties.ts`),
takže Stryker i opakovaný běh vidí stejné vstupy; hlubší běh pustí
`FAKTURIAN_PROPTEST_CASES`. Zmenšený protipříklad, který model najde, patří
i do sdílené tabulky (`test/fixtures/money-parity.json`,
`document-number-parity.json`), kterou čtou testy frontendu i hlavního procesu.

Souběh hlídá `test/nuxt/integration/concurrency.spec.ts`. `backend.scheduler` (scheduler
z `fast-check`) rozhoduje, kdy se asynchronní příkaz skutečného hlavního procesu
spustí a kdy jeho odpověď dojde do okna — mezi tím může doběhnout jiný, jako
v appce, kde příkaz čeká na disk, síť nebo jiný proces. Čtení a zápis datových souborů (`write_data_file`,
`read_data_file`) hlavní proces řadí za sebe (fronta `exclusive`
v `desktop/store.ts`), takže je scheduler nepřeskládává. `backend.fault` nechá
selhat jen vybraná volání. Seznam `ASYNC_COMMANDS` v `test/setup/backend.ts`
musí sedět s příkazy, které v `desktop/` doběhnou v libovolném pořadí.

## E2E

```sh
bun run test:e2e
bun run test:e2e:visual
```

Sada Playwright (`_electron`, `test/e2e/app.ts`) pouští postavenou appku ve
skutečném okně Electronu. Každý test dostane vlastní dočasný domov a kopii
syntetického vaultu z `test/e2e/fixtures/vault`; průchody aplikací jsou v
`test/e2e/workflows/`, krátký start aplikace v `test/e2e/smoke/` a vizuální
scénáře v `test/e2e/visual/` fotí ukázkový vault z
`desktop/examples/demo-vault.ts` proti snímkům v `test/e2e/visual-baselines/`.

Job `e2e` v CI pouští sadu s `--ignore-snapshots`: snímky vznikly na vývojovém
Macu a systémové písmo runneru se vykreslí jinak. Vizuální sadu proto ověřuje
jen lokální běh.

## Smoke test balíčku

Job `package` v CI na macOS postaví frontend, hlavní proces a nepodepsaný
balíček přes electron-builder (`electron-builder.yml`, výstup
`.output/release/`) a ověří, že `Fakturian.app` nese `app.asar`, licence
třetích stran (`THIRD-PARTY-NOTICES.txt`), rozbalený validátor ISDOC
i `xmllint-wasm` a že vznikly DMG a ZIP. Tutéž `Fakturian.app`
pak spustí přes `bun run test:release-smoke -- --prebuilt` a jeho hlášení
(`.output-release-smoke/`) nahraje k artefaktům.

`bun run test:release-smoke` (`test/smoke/release-smoke.ts`) spustí
`Fakturian.app` z `.output/release/` v dočasném domově, počká na socket MCP
a přes connector zavolá `list_invoices`. Bez `--prebuilt` si nepodepsaný balíček
nejdřív sám postaví; tak se pouští ručně na macOS. Podpis balíčku neověřuje
(`NAST-1` v [09-BACKLOG](09-BACKLOG.md)).

## Co musí zůstat pravdou

Vlastnosti, na kterých stojí použitelnost pro účetnictví. Žádná oprava je nesmí
obětovat.

- **Peníze v celých haléřích.** Součet řádků na papíře, v ISDOC i v SPAYD se
  nikdy nerozejde; parita frontendu a hlavního procesu stojí na
  `test/fixtures/money-parity.json`.
- **ISDOC 6.0.2 validovaný proti oficiálnímu XSD** přes `xmllint-wasm`
  (libxml2) ve workeru `desktop/isdoc/validator.ts`. Deterministické UUIDv5.
- **Datumy bez pásmových chyb.** `today()` čte datum v místní zóně, `addDays`
  počítá nad datem bez času.
- **Účet pro QR a ISDOC:** české číslo účtu se ověřuje a převádí do příslušného
  formátu; testy pokrývají účty s předčíslím i bez něj.
- **Escapování** do Typstu a do XML (včetně řídicích znaků nepovolených v XML
  1.0). Text zprávy jde do AppleScriptu přes `argv`, ne jako zdroják
  (`desktop/mail.ts`).
- **Utažený Typst sandbox** — překladač vidí jen soubory namapované v paměti
  (`compileTypst` v `desktop/pdf.ts`), žádnou cestu na disku.
- **Nulová plocha pro XSS** — v `src/` není `v-html`, `innerHTML`, `eval` ani
  `new Function`.
- **Minimální entitlements** — `apple-events` kvůli Mail.app a `allow-jit`, bez
  kterého V8 v hardened runtime nespustí JavaScript (`desktop/entitlements.plist`).
- **Path traversal ošetřený v hlavním procesu** všude, kde z čísla dokladu
  vzniká název souboru.
- **`useVaultFile.save()` odmítá zapsat doménu, kterou se nepodařilo načíst.**
- **Sdílené fixtures jako jediný zdroj pravdy** (`test/fixtures/*.json`)
  čtené testy frontendu i hlavního procesu — vzor pro všechno, kde si obě strany
  musí sedět.
- **Typová hygiena:** žádné `any` a `@ts-*` v `src/` ani `desktop/`, žádné
  `console.*` v `src/`, žádné `as` a `!` v `src/**/*.ts` ani v `desktop/`.

## Vydávací brány

Vydání je možné, až je doloženo:

- `bun run check` je zelené nad vydávanou revizí;
- mutace frontendu i hlavního procesu jsou zelené bez přeživších mutantů
  a timeoutů;
- E2E nad oknem Electronu projde na podporovaných systémech včetně vizuální
  sady;
- vzdálené CI (`.github/workflows/quality.yml`) proběhlo nad revizí a povinné
  kontroly jsou aktivní, jakmile to dovolí nastavení repozitáře;
- ruční import vzorových ISDOC do cizího účetního programu je zapsaný (vzorky
  jsou `samples()` v `desktop/test/invoices.ts`, `UCT-40`) — XSD validita sama
  kompatibilitu importéru nedokazuje;
- podepsaný a notarizovaný instalační balíček projde čistou instalací, prvním
  spuštěním, vytvořením vaultu, vystavením a opětovným načtením dokladu.

## Co brány nepokrývají

- podpis, notarizaci a instalaci distribučního buildu z DMG,
- showcase (kromě typů jeho skriptů),
- spuštění zabaleného `.app` v `bun run check` (`bun run test:release-smoke`
  pouští jen job `package` v CI),
- vizuální sadu E2E v CI,
- type-aware pravidla v šablonových částech `.vue`,
- právní a produktovou správnost účetních pravidel.

## Testy se systémovými nároky

Některé testy projektu `desktop` potřebují přístup mimo omezený sandbox:
veraPDF spouští Javu (`pdfa.test.ts`), mock HTTP server naslouchá na lokálním
portu (`fio.test.ts`, `ares.test.ts`), MCP používá unixový socket
(`mcp/*.test.ts`) a `keyring.test.ts` sahá do systémové klíčenky macOS.
Instalace závislostí a mutační běhy používají vlastní cache nebo lokální server.
Nedostupný povinný externí validátor nesmí skončit zeleným přeskočením.
