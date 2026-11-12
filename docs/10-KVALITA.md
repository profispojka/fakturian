# Model kvality

Jediný popis toho, jak se ve Fakturianu ověřuje kvalita: pravidla testů, brány,
prahy a co se před vydáním musí doložit. [AGENTS.md](../AGENTS.md) z něj drží
jen krátká pravidla s odkazem sem. Chybějící testy a otevřenou práci na
bránách vede [05-BACKLOG](05-BACKLOG.md) v oblastech `TEST` a `NAST`.

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

| Krok             | Co ověřuje                                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lint:check`     | oxlint (vlastní pravidla v `tools/lint/oxlint-fakturian.ts`) a ESLint nad `<script>` a šablonou `.vue` (type-aware pravidla, `data-testid`, nescoped `<style>`) |
| `lint:scales`    | Tailwind používá projektové stupnice, tokeny a zlomy `split:`/`wide:`; žádné no-op utility na obyčejném elementu                                                |
| `lint:dead-css`  | tvar v `main.css` nosí víc souborů, mrtvý tvar nenosí nikdo, `<style>` blok začíná `@reference`                                                                 |
| `format:check`   | formát přes oxfmt                                                                                                                                               |
| `typecheck`      | typy frontendu, hlavního procesu (`desktop/tsconfig.json`), nástrojů a skriptů showcase; Vitest testy se netypují                                               |
| `typecheck:e2e`  | typy E2E scénářů a jejich podpory (`e2e/tsconfig.json`)                                                                                                         |
| `test:coverage`  | Vitest projekty `unit`, `nuxt` a `desktop` a 100% prahy pro každý zahrnutý soubor                                                                               |
| `test:contracts` | kontrakty mezi hlavním procesem a frontendem nad skutečnými moduly `desktop/` (`test/contracts/README.md`)                                                      |
| `generate`       | statický Nuxt build                                                                                                                                             |
| `desktop:build`  | esbuild hlavního procesu, validátoru ISDOC a preloadu do `.output/desktop/`                                                                                     |
| `audit:js`       | advisories JS závislostí                                                                                                                                        |

Vitest používá `tools/testing/required-tests-reporter.ts`. Prázdná nebo
přeskočená sada, skip/todo, neúspěšný hook, neošetřená chyba i úspěch až po
retry znamenají selhání. `allowOnly: false` zakazuje `.only`.

### Mimo `check`

Pomalejší kroky nebo kroky, které potřebují prostředí, jaké běžná lokální brána
nemá:

| Příkaz                       | Co ověřuje                                                             |
| ---------------------------- | ---------------------------------------------------------------------- |
| `bun run test:gates`         | chování bran úmyslnými poruchami v oddělených procesech                |
| `bun run test:fuzz`          | generativní testy vstupů zvenku s vyšším počtem případů                |
| `bun run mutants:ts`         | mutační testování frontendu i hlavního procesu                         |
| `bun run test:e2e`           | scénáře nad skutečným oknem Electronu včetně vizuální sady (viz „E2E") |
| `bun run test:release-smoke` | start zabaleného `.app` a most MCP (viz „Smoke test balíčku")          |

## Pokrytí

`vitest.config.ts` používá `thresholds: { 100: true, perFile: true }`. Sto
procent příkazů, větví, funkcí a řádků musí splnit každý zahrnutý soubor, ne
jen globální průměr. Pokrytí zahrnuje `src/**` i `desktop/**/*.ts`; vyloučená
jsou data fixtures, testy a ukázky v `desktop/test/` a `desktop/examples/`
a soubory, které nenesou spustitelný kód (`*.d.ts`).

`src/bindings.ts` je součástí měření. Testy Vue vrstvy nahrazují až most
`globalThis.fakturian` (`test/setup/backend.ts`), takže obaly `commands.*` se
spouštějí doopravdy. Testy hlavního procesu nahrazují jen modul `electron`
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
každému mutantovi stavěl Nuxt runtime. Testy `desktop` sahají na klíčenku,
sockety a veraPDF, mutační běh proto potřebuje macOS s veraPDF a běh mimo
sandbox.

`thresholds` mají `break: 100`: žádný přeživší mutant, mutant bez pokrytí ani
timeout. Wrapper `tools/mutation/mutants-ts.ts` navíc vyžaduje úspěšnou
baseline a úplný report. Výstupy jsou v `reports/mutation/`.

Mutační brána stojí na Vitestu 4: `vitest` a `@vitest/coverage-v8` jsou
v `package.json` zamknuté přesně na `4.1.12`. Vitest 5 porovnává
`testNamePattern` s celým řetězcem suite a testu spojeným `>`, zatímco
`@stryker-mutator/vitest-runner` 10.0.0 skládá jméno mezerou; nad mutantem pak
neběží žádný test a každý pokrytý mutant přežije, skóre padá na jednotky procent
(stryker-js#6210). Vitest 5 se zvedne, až vyjde runner s opravou (stryker-js#6214).

Ignorované mutanty (deklarativní konstrukce zod schémat, jejichž vstupy ověřují
přímé testy kontraktů) report vede zvlášť a do skóre se nepočítají.

Volby `Intl` stojí na modulu jako data (`satisfies Intl.DateTimeFormatOptions`)
a formátovač se staví až v těle funkce: mutant v řetězci volby pak shodí volání
v testu, ne import modulu. `as const` by tu byl chyba — pod ním Stryker
objektový literál nemutuje. Výjimkou je `czechPercent` v `utils/locales.ts`,
který zůstává na úrovni modulu; jeho hodnotu hlídá aserce v `test/plural.spec.ts`.

V CI mutace neběží, celý rozsah trvá desítky minut. Pouští se lokálně
(`bun run mutants:ts`), u dotčeného souboru před merge a celé před vydáním.

## Generativní testování vstupů zvenku

```sh
bun run test:fuzz
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
pouští 64 případů na cíl, `bun run test:fuzz` víc; počet určuje proměnná
`FUZZ_CASES`.

## Property testy proti modelu

Peníze, kalendář, číslování a čerpání limitů mají vedle tabulkových testů
generované vstupy porovnané s nezávislým modelem — model nesahá na testovaný
kód ani na jeho knihovnu:

| oblast    | model                                                    | kde                                                           |
| --------- | -------------------------------------------------------- | ------------------------------------------------------------- |
| peníze    | přesná aritmetika v `BigInt`, půlka od nuly, strop       | `test/money.spec.ts`, `desktop/test/invoice/template.test.ts` |
| kalendář  | pořadové číslo dne (`days_from_civil`), měsíc jako index | `test/date.spec.ts`                                           |
| číslování | množina použitých pořadí, další = max + 1 nebo start     | `test/numbering.spec.ts`, `desktop/test/numbering.test.ts`    |
| limity    | součet množství po položce a roce, dobropis se znaménkem | `test/pricelist.spec.ts`                                      |

Generuje se přes `fast-check` s pevným seedem (`test/setup/properties.ts`),
takže Stryker i opakovaný běh vidí stejné vstupy; hlubší běh pustí
`FAKTURIAN_PROPTEST_CASES`. Zmenšený protipříklad, který model najde, patří
i do sdílené tabulky (`src/utils/fixtures/money-parity.json`,
`document-number-parity.json`), kterou čtou testy frontendu i hlavního procesu.

Souběh hlídá `test/nuxt/concurrency.spec.ts`. `backend.scheduler` (scheduler
z `fast-check`) rozhoduje, kdy se asynchronní příkaz provede a kdy odpoví —
mezi tím může doběhnout jiný, jako v hlavním procesu, kde příkaz čeká na disk,
síť nebo jiný proces. Čtení a zápis datových souborů (`write_data_file`,
`read_data_file`) hlavní proces řadí za sebe (fronta `exclusive`
v `desktop/store.ts`), takže je scheduler nepřeskládává. `backend.fault` nechá
selhat jen vybraná volání. Seznam `ASYNC_COMMANDS` v `test/setup/backend.ts`
musí sedět s příkazy, které v `desktop/` doběhnou v libovolném pořadí.

## E2E

```sh
bun run test:e2e
bun run test:e2e:visual
```

Sada Playwright (`_electron`, `e2e/app.ts`) pouští postavenou appku ve
skutečném okně Electronu. Každý test dostane vlastní dočasný domov a kopii
syntetického vaultu z `e2e/fixtures/vault`; vizuální scénáře
(`e2e/specs/visual-*.spec.ts`) fotí ukázkový vault
z `desktop/examples/demo-vault.ts` proti snímkům v `e2e/visual-baselines/`.

Job `e2e` v CI pouští sadu s `--ignore-snapshots`: snímky vznikly na vývojovém
Macu a systémové písmo runneru se vykreslí jinak. Vizuální sadu proto ověřuje
jen lokální běh.

## Smoke test balíčku

Job `package` v CI na macOS postaví frontend, hlavní proces a nepodepsaný
balíček přes electron-builder (`electron-builder.yml`, výstup
`.output/release/`) a ověří, že `Fakturian.app` nese `app.asar`, rozbalený
validátor ISDOC i `xmllint-wasm` a že vznikly DMG a ZIP. Balíček nespouští
(`NAST-19` v [05-BACKLOG](05-BACKLOG.md)).

`bun run test:release-smoke` (`tools/e2e/release-smoke.ts`) postaví nepodepsaný
balíček, spustí `Fakturian.app` z `.output/release/` a ověří most MCP přes
socket. Pouští se ručně na macOS.

## Co musí zůstat pravdou

Vlastnosti, na kterých stojí použitelnost pro účetnictví. Žádná oprava je nesmí
obětovat.

- **Peníze v celých haléřích.** Součet řádků na papíře, v ISDOC i v SPAYD se
  nikdy nerozejde; parita frontendu a hlavního procesu stojí na
  `src/utils/fixtures/money-parity.json`.
- **ISDOC 6.0.2 validovaný proti oficiálnímu XSD** přes `xmllint-wasm`
  (libxml2) ve workeru `desktop/isdoc/validator.ts`. Deterministické UUIDv5.
- **Datumy bez pásmových chyb.** `today()` čte datum v místní zóně, `addDays`
  počítá nad datem bez času.
- **IBAN mod-97** s testem přes nezávislou implementaci.
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
- **Sdílené fixtures jako jediný zdroj pravdy** (`src/utils/fixtures/*.json`)
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
- spuštění zabaleného `.app` (`bun run test:release-smoke` není v `check` ani
  v CI),
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
