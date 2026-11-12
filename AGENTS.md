# Fakturian — pravidla pro agenty

Co hlídá nástroj (oxlint, ESLint, `tsc`, `lint:scales`, `lint:dead-css`), tady stojí jednou větou
se jménem pravidla a důvodem. Postupy pro konkrétní práci jsou ve skillech v `.claude/skills/`:

| skill          | kdy                                                                |
| -------------- | ------------------------------------------------------------------ |
| `zod-validace` | schéma, kontrola vstupu, odpověď IPC, soubor vaultu, argumenty MCP |
| `vue-testy`    | test komponenty, stránky nebo composable (`test/nuxt/`)            |
| `test-ids`     | hledání prvků v testu a `data-testid` v šabloně                    |
| `styly`        | `class`, `<style>` blok, `main.css`, `app.config.ts`               |

Model kvality (pokrytí, mutace, kontrakty, E2E) popisuje `docs/10-KVALITA.md`, úkoly vede
`docs/05-BACKLOG.md`. Nálezy, o kterých je rozhodnuto, že se neřeší, vede sekce „Rozhodnuto
neřešit" v `docs/13-ZNAME-OMEZENI.md` — při revizi kódu ji přečti dřív, než něco nahlásíš, a co
v ní stojí, znovu nezakládej bez nového scénáře, který uživatele poškodí.

## Dovnitř jen kvalitní data

Každý údaj, který do appky přichází zvenku, projde na hranici celou kontrolou a dopadne jedním ze
dvou způsobů:

- **je úplný a platný** — vstoupí do evidence a kód uvnitř mu věří;
- **není** — odmítne se celý, s větou, která říká co a proč.

Třetí možnost neexistuje: žádné „částka neznámá", „doplň později", tichá náhrada nulou, prázdným
řetězcem nebo dneškem, ani rozbor, který nečitelnou část zahodí a zbytek pustí dál.

Hranice jsou soubory ve vaultu (`.fakturian/*.json`, PDF ve `faktury/` a `prijate/`), import
a převzetí dokladů, odpovědi hlavního procesu přes IPC a v něm argumenty příkazů ze stránky, Fio,
ARES, argumenty od agenta přes MCP a formuláře.

- **Odmítnuté nesmí zmizet potichu.** Uživatel se to dozví hláškou u akce, nebo trvale, když data
  leží ve složce (vadné doklady ukazuje Přehled).
- **Uvnitř se nebrání.** Co hranice zaručila, se znovu neověřuje ani nezáplatuje (`?? ''`, `|| 0`,
  `?? []` nad povinnou hodnotou). Obranná větev uvnitř znamená, že kontrola na hranici chybí —
  patří tam.
- Ruční zadání bez dokladu je platný vstup, pokud ho validuje formulář. Neplatí to jako výmluva pro
  doklad, ze kterého nejde přečíst povinný údaj (`UCT-38` v `docs/13-ZNAME-OMEZENI.md`).

## Žádné migrace dat

Fakturian nemá uživatele ani produkční data. Kód nikde neřeší data zapsaná jiným tvarem: žádné
migrace, verze schématu, čtení starého pole vedle nového (`raw.newKey ?? raw.oldKey`) ani
`transform` starého klíče. Když se tvar dat změní, změní se schéma a generátory ukázkových dat
(`desktop/examples/demo-vault.ts`, `showcase/harness/demo-data.ts`, `e2e/fixtures/vault/`).
Soubor v jiném tvaru spadne na validaci a to je v pořádku. Migraci nenavrhuj ani se na ni neptej.

## Názvy

Kód je pojmenovaný **anglicky**: proměnné, funkce, typy, `data-testid`, CSS třídy, soubory,
složky a adresy stránek. **Česky** jsou komentáře, popisky `describe`/`it`,
texty v UI a hlášky. Česky zůstávají i jména, která jsou data nebo veřejná adresa:

- složky a soubory vaultu na disku (`faktury/`, `prijate/`, `platby.json`, `vydaje.json` …);
- adresy a média prezentačního webu (`showcase/content/**`, `/napoveda/…`, `showcase/public/media/`);
- doménové zkratky `ico`, `dic`, `vs`.

## Lint, typy a formát

- **Lokální vypínání neexistuje.** `oxlint-disable`, `eslint-disable`, `@ts-ignore`,
  `@ts-expect-error` a spol. hlídá `no-warning-comments` v oxlintu a `noInlineConfig` v ESLintu.
  Když pravidlo nesedí na kontrakt knihovny, řeší se jednou v `overrides` konfigurace s komentářem
  platným pro celý projekt. Jinak se opraví typ, signatura, schéma nebo struktura kódu.
- **Pojmenované výjimky z mutačního testování.** `// Stryker disable next-line <Mutátor>: <proč>`
  jen tam, kde mutant nejde zabít testem: ekvivalentní mutant (`DATE` v `utils/date.ts`) nebo
  mutant, který shodí import dřív, než se spustí test (`czechPercent` v `utils/locales.ts`).
  `// Stryker disable all` stojí nad deklarativními schématy odpovědí IPC v `schemas/invoices.ts`
  a `schemas/import.ts`; nová výjimka se přidává jen s důvodem v komentáři.
- **Po úpravě souboru** ho hook naformátuje (`oxfmt`), na konci tahu pustí lint, typecheck (i nad
  `desktop/tsconfig.json`) a u změny v `desktop/` testy projektu `desktop`, které na ni dosáhnou
  (`.claude/hooks/`). Codex hooky nespouští — ověř to výslovně: `bun run lint:check`,
  `bun run typecheck`, `bun run test`.

## Kód

**Funkce vzniká, jen když přidává chování.** Nezakládej funkci, jejíž tělo je jediné volání jiné
funkce: `settle = () => flushPromises()` jen přejmenuje, co se volá, a čtenář to musí dohledat.
Pomocník, který spojí víc kroků nebo přidá kontrolu, je v pořádku. Novou pomocnou funkci zakládej,
až když se stejná logika opravdu opakuje. Hlídá `fakturian/no-alias-function`.

**Standardní řešení má přednost před deduplikací.** Když jde věc napsat tvarem, který projekt už
má (zod schéma, `if … throw` na hranici, existující composable), použije se ten — i když tím vzniknou
dvě kopie. Vlastní pomocník jen kvůli sdílení pár řádků se nezakládá: `saveInvoice` volá
`invoiceSchema()` stejně jako formulář a `checkSource` v `desktop/import.ts` drží své kontroly
znaménka vedle něj, ne přes společnou funkci vracející kus hlášky.

**`try` jen kolem toho, co může selhat.** Vyhodit umí odchod z appky ven — IPC (`commands.*`),
síť, souborový systém, schránka, `JSON.parse`, rozbor neověřeného data. Naše `async` funkce, které
vracejí odpověď, nehází: `getUserConfirmation()` se vyřeší kliknutím, Escapem i klikem mimo, takže
úklid po ní je obyčejný řádek za `await`em (`useForm.ts`):

```ts
const confirmed = await getUserConfirmation(message, { title, confirmLabel: 'Zahodit' });
options.afterConfirm?.(confirmed, exit);
```

Když se nedá rozhodnout, jestli volání hází, dohledej to — neobaluj „pro jistotu".

**Chybu na text převádí jedině `errorText()`** z `utils/errors.ts`. Do `catch` přiletí řetězec
z hlavního procesu, `Error` i `ZodError` a `String(e)` z každého udělá jinou hlášku.
`issuesText(zodError)` vydá první tři problémy schématu. Předat chybu dál (`status.error('…', e)`,
`throw e`) je v pořádku. Hlídá `fakturian/error-text`.

**Hláška je česká věta pro živnostníka, ne pro vývojáře.** Říká, co se stalo a co s tím, slovy
z rozhraní („Doklad 20260013 nejde přečíst… Oprav nebo obnov PDF ze zálohy."). Text cizí chyby
(pdf-lib, libxml2, Node), anglická slova ani jména polí z kódu (`customer.ico`, `dueDate`) do nové
hlášky nepatří; technická příčina jde do `{ cause: error }`.

**`await` stojí samostatně** (`const x = await …;`), ne uvnitř podmínky, argumentu nebo `return`.
Vnořený `await` schová bod, kde funkce čeká a stav může utéct. Hlídá `fakturian/await-standalone`.

**Datum je validovaný string.** Model drží `DateString` (`RRRR-MM-DD`) a `YearMonthString`
(`RRRR-MM`) z `utils/date`, nepovinné datum je `undefined`, rozsah roků 1000–9999. Každý výpočet
jde přes funkce v `utils/date.ts` nad `@internationalized/date`; manipulaci po znacích odmítne
typ, import knihovny mimo modul `no-restricted-imports`. Dnešek je `today()`, ne `new Date()` —
appka počítá v místní zóně; `Date` v appce ani v testech nestojí (`no-restricted-globals`).
`CalendarDate` žije jen ve výpočtech a v Nuxt UI, datumové pole propojuje `useDateModel`. Formulář
kopíruje model přes `structuredClone(toRaw(model))`.

**Validace přes zod** — hláška se píše rovnou do schématu (`.trim().min(1, 'Povinné pole.')`), `z`
z `~/utils/zod`, cizí data přes `safeParse`, povinná hodnota bez `.default()`. Hlídá
`no-restricted-properties` (`.parse()` mimo `JSON`, `Date` a `URL`) a `no-restricted-imports`;
postup je ve skillu `zod-validace`.

**Zkratky** registruje `defineShortcuts()` přímo stránka, která příkaz vlastní. `app.vue` drží
⌘P, ⌘N, ⌘, a ⌘S; ta mačká tlačítko s `data-save`, takže stránka jen označí své „Uložit" a jeho
`disabled` platí i pro zkratku. Každý příkaz má `usingInput: true`, protože ⌘S se mačká uprostřed psaní,
a začíná `if (document.querySelector('[data-slot="overlay"]')) return;` — `defineShortcuts()`
poslouchá na dokumentu, takže bez toho ⌘S uloží doklad pod otevřenou otázkou „Zahodit?". Hlídá
`fakturian/shortcut-guard`; `:overlay="false"` na `UModal` hlídá `vue/no-restricted-v-bind`.

## Komentáře

Vysvětlení nese název; když nestačí, přejmenuj. Komentář se píše jen tam, kde kód sám neřekne
**proč** — nejvýš na dva řádky; souvislý výklad patří do `docs/`. Píše se:

- proč zrovna takhle — „Zaokrouhlení od nuly — ne k +∞: `Math.round(-0.5)` je v JS `-0`.";
- co se rozbije, když to někdo změní — „Musí sedět s `deriveDueDays` v `desktop/adopt.ts`.";
- past knihovny nebo platformy — „`rename` na Unixu cíl mlčky přepíše."

Nepíše se, co kód dělá, doc komentář nad testem ani úvod modulu a dekorativní banery. Délku
a banery hlídá `fakturian/comment-style`.

**Komentáře a dokumentace popisují jen současný stav.** Žádné „dřív si každá stránka držela…",
„bývalo to ve službě". Důvod opřený o minulost jde vždycky přepsat na tvrzení o současnosti
(„Selhání se zaloguje a vrátí nenulový kód, ne panika"). „Dřív" ve smyslu pořadí kroků je
v pořádku, stejně jako zákaz do budoucna („`test/setup/ui-stubs.ts` se nemá vracet"). Platí to
i na `docs/05-BACKLOG.md`: položka popisuje, co je v kódu teď, vyřešená se maže.

## Kde co bydlí

| kde            | co tam patří                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `constants/`   | pevná tabulka a typ, který ji popisuje; zvenčí dané hodnoty (zákonné limity, výchozí nastavení) |
| `utils/`       | výpočet nad typy — `vatLevelOf`, `sectionBadge`, `creditNotesOf`, `expenseFromReceived`         |
| `schemas/`     | zod schéma (uložený tvar, formulář, odpověď IPC), typ, `empty*()`, `newInvoice()`               |
| `services/`    | krok ven z frontendu: `commands.*`, rozbor odpovědi, `toWire`                                   |
| `composables/` | stav domény nad `useVaultFile` — `upsert`, `remove`, `upsertMany`                               |
| `desktop/`     | hlavní proces Electronu: příkazy IPC, čtení a zápis vaultu, ISDOC a PDF, Fio, ARES, MCP, okno   |

`src/` je frontend v okně appky, `desktop/` hlavní proces v Node. Kontrakt mezi nimi je
`src/bindings.ts`: `CommandArgs`/`CommandResults` a `commands.*`, které `desktop/commands.ts`
naplňuje přes `satisfies Contract` a jejichž argumenty v hlavním procesu ověří. Hlavní proces bere
z `src/` jen sdílené typy, schémata a výpočty (`~/bindings`, `~/schemas`, `~/utils`, `~/constants`).

- `constants/` a `utils/` mají stejná jména souborů (`constants/numbering.ts` vedle
  `utils/numbering.ts`): hodnota se hledá v `constants`, chování v `utils`. Funkce v `constants/`
  nestojí (`fakturian/constants-data-only`). Konstanta, kterou používá jediný algoritmus a mimo něj
  nedává smysl, bydlí u něj (`MIN_DATE` v `utils/date.ts`, `ARES_BASE` v `desktop/ares.ts`).
- **`commands.*` (IPC) se volá ve `services/` nebo v composable domény, nikde jinde.** Stránka
  a komponenta jdou přes ně. Hlídá `no-restricted-imports`. Most z preloadu (`globalThis.fakturian`)
  čtou jen `bindings.ts`, `services/system.ts` a `utils/desktop.ts` (`no-restricted-properties`).
- **Zápis do vaultu službou není.** Soubor domény drží `useVaultFile` a mění ho composable té domény
  přímo (`useExpenses` sáhne na `data.value.expenses` a zavolá `save()`). Služba, která jen
  přerovná cizí store, je průchoďák.
- **Schéma se nestěhuje ke svému volání.** Závisel by na službě každý, kdo potřebuje jen typ.
  Dotaz „projde tohle schéma?" patří ke schématu (`supplierReadyForInvoicing` v
  `schemas/suppliers.ts`).

**Komponenty:** `src/components/` má podsložku pro sekci, která komponentu vlastní (`invoice/`,
`dashboard/`, `settings/`, `vault/`), a plochý kořen pro to, co používá celá appka
(`EmptyState`, `Money`, `MoneyInput`, `FieldError`, `SectionHeader`, `StatusbarFeedback`,
`ConfirmDialog`, `CommandPalette`, `RecordTable`). Nuxt vlepí složku do názvu, takže
`invoice/PricePicker.vue` je `<InvoicePricePicker>` — jméno souboru předponu neopakuje a hloubka je
nejvýš jedna úroveň (`fakturian/component-path`). Do kořene se komponenta vrací, když ji začne
vykreslovat druhá sekce; rozhoduje, kdo ji vlastní (`VaultAdoptOffer` visí na dvou stránkách, ale
mluví o datové složce).

**Stránky:** každá sekce je složka v `src/pages/`: výpis `<sekce>/index.vue`, formulář
`<sekce>/[id].vue`; ploché soubory mají jen sekce bez záznamů (`settings.vue`, `integrations.vue`).
Který záznam se upravuje, říká jedině adresa (`useRouteId()`), nikdy sdílený stav — hluboký odkaz
by jinak otevřel cizí doklad.

- `…/new` je alias bez parametru, `useRouteId()` na něm vrátí `''`, takže „zakládá se" je
  `!id.value`, ne ref.
- Faktura se adresuje číslem dokladu, jako v hlavním procesu (`delete_invoice`, `mark_invoice_sent`).
- Předvyplněný dobropis i duplikát jdou na `/invoice/new` s obsahem v `pendingInvoice`.
- Uložení nového záznamu adresu hned přepíše (`replace: true`), jinak druhé „Uložit" založí
  dvojníka.
- Sekce s formulářem má rodiče `<sekce>.vue` s jediným `<NuxtPage />`: výpis i formulář jsou jeho
  děti, takže router rozsvítí sekci v panelu i na `…/new`. Panel sám nic nehlídá.

## Testy

Postup je ve skillech `vue-testy` a `test-ids`, celý model v `docs/10-KVALITA.md`. Vždy:

- Vue vrstva se testuje proti skutečnému Nuxt UI, routeru a potvrzovacímu dialogu — žádné stuby.
- **Vitest testy se netypují a jejich matchery se nezakazují** (rozhodnutí z 17. 10. 2026).
  `bun run typecheck` je nepouští, typová pravidla lintu na `test/**` neplatí a `toBeTruthy`,
  `toMatch`, `toBeGreaterThan` a spol. jsou povolené.
  `test/tsconfig.json` zůstává jen kvůli editoru. Desktopové E2E dál hlídá `fakturian/exact-text`.
- Kontrakt, který testuješ, se nemockuje — schémata vaultu běží doopravdy
  (`fakturian/no-contract-mock`).
- Každé volání `commands.*` má test odmítavé cesty, každé odmítnutí příkazu v `desktop/` taky.
- Prahy pokrytí (100 % na soubor v `src/` i `desktop/`) jdou jen nahoru; nedosažitelná větev se
  maže, ne vyvažuje.
- U dotčeného souboru z `stryker.config.ts` (vyjmenované soubory `src/` a celý `desktop/` bez testů
  a ukázek) se před merge pustí `bun run mutants:ts --mutate <soubor>`; přeživší mutant nesmí zůstat.

## Showcase

Prezentační web ve `showcase/` je marketing, ne appka. Laťka výše (hranice dat, lint bez výjimek,
100 % pokrytí, mutace, kontrakty) platí pro appku, frontend i hlavní proces. Showcase stačí, že
se postaví a stránky vypadají správně; testy, typecheck ani přísnější lint se mu nepřidávají a jeho
nedostatky nejdou do `docs/05-BACKLOG.md`.

## Prostředí

**Dev server a testy Nuxt vrstvy nepouštěj naráz** — obojí staví do `.nuxt`. Běží-li server
(`lsof -nP -iTCP:1420 -sTCP:LISTEN`), pusť jen `vitest run --project unit` a o celé sadě se zeptej.
`ps`/`pgrep` jsou v sandboxu zakázané. Ve složce mohou současně pracovat i jiné session — dev server,
běh testů nebo změnu v indexu gitu, kterou jsi neudělal, neruš a zmiň ji.

`bun run typecheck` bere typy z `.nuxt/`, které generuje `postinstall` a dev server. Po změně
`nuxt.config.ts` nebo nové stránce pusť nejdřív `bunx nuxt prepare`.

V sandboxu Claude Code tohle potřebuje `dangerouslyDisableSandbox: true` (není to chyba testu):

| co                                                        | proč                                                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `bun run test`, `bun run test:contracts` (projekt `nuxt`) | v sandboxu se překlad zasekne na desítky minut a testy padnou na `Hook timed out`; mimo něj běží sekundy |
| `desktop/test/pdfa.test.ts`                               | veraPDF (Java) si zakládá temp mimo povolené cesty                                                       |
| `desktop/test/fio.test.ts`, `ares.test.ts`                | mock HTTP server binduje port                                                                            |
| `desktop/test/mcp/*.test.ts`                              | unixový socket                                                                                           |
| `desktop/test/keyring.test.ts`                            | skutečná klíčenka macOS                                                                                  |
| `bun run test:desktop`, `bun run test:coverage`           | pouští všechno výše                                                                                      |
| `bun run mutants:ts`                                      | Stryker otvírá lokální server (`listen EPERM`) a pouští i testy `desktop`                                |
| `bun run dev`, `bun start`                                | spouští okno Electronu                                                                                   |
| `bun install`, `bun add …`                                | zápis do globální cache Bunu (`~/.bun/install/cache`)                                                    |

## Git a spolupráce s Codexem

Pracuje se přímo v této složce na aktuální větvi. Worktree jen na výslovné vyžádání. V hlavním
repozitáři se do gitu nezapisuje (`add`, `commit`, `checkout`, `push` …) — hlídají to `deny`
pravidla v `.claude/settings.json`. Zachovej rozpracované změny, lokální konfiguraci a `.env`.
Codex čte skilly přes symlinky v `.agents/skills/`.
