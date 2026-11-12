# Fakturian — Backlog

Jediný seznam toho, co **zbývá udělat**: otevřené vady, chybějící testy, dluhy
v nástrojích a architektuře a nápady mimo současný rozsah. Nic jiného sem
nepatří — co appka umí, je v [01-FUNKCE](01-FUNKCE.md); jak je postavená,
v [02-TECHNOLOGIE](02-TECHNOLOGIE.md); model kvality a vydávací brány
v [10-KVALITA](10-KVALITA.md); vědomě přijaté kompromisy, co se záměrně nemění
a nálezy, o kterých je rozhodnuto, že se neřeší, v
[13-ZNAME-OMEZENI](13-ZNAME-OMEZENI.md); zamítnuté funkce v sekci „Mimo rozsah"
v [01-FUNKCE](01-FUNKCE.md).

## Jak se s tímhle souborem pracuje

- **Vyřešená položka se smaže**, nepřeškrtává. Důkazem opravy je kód a jeho
  test. Historii drží git.
- **Každá položka má stabilní ID.** Na ID se odkazuje v commitech a v diskuzi;
  po smazání se číslo znovu nepoužije.
- **Každá položka má místo v kódu:** soubor a jméno funkce, symbolu nebo
  `data-testid`. Čísla řádků se nepíšou. Bez místa v kódu nebo bez konkrétního
  scénáře to není položka backlogu, ale dojem.
- **Nová položka patří do oblasti podle následku**, ne podle vrstvy, ve které
  bydlí. Ztráta dokladu je `DATA`, i když ji způsobí Vue komponenta.
- **Položka má scénář, který uživatele poškodí nebo zdrží.** Úklid kódu,
  duplicita, styl a „šlo by to jednodušší" sem nepatří. Než nález přidáš,
  podívej se do sekce „Rozhodnuto neřešit" v
  [13-ZNAME-OMEZENI](13-ZNAME-OMEZENI.md): co tam stojí, se znovu nezakládá,
  dokud k tomu nepřibude nový scénář.

### Oblasti

| Prefix  | Oblast                                  |
| ------- | --------------------------------------- |
| `DATA`  | trvanlivost a integrita účetních dat    |
| `UCT`   | účetnictví a legislativa ČR             |
| `BEZP`  | bezpečnost a soukromí                   |
| `LOG`   | chyby v aplikační logice                |
| `UI`    | ovládání, rozsah funkcí, výkon rozhraní |
| `TEST`  | mezery v testech a v jejich hygieně     |
| `NAST`  | nástroje, build, release engineering    |
| `DOC`   | dokumentace a komentáře proti kódu      |
| `ARCH`  | architektura, duplicity a přísnost typů |
| `NAPAD` | nápady mimo současný rozsah             |

### Závažnost

| Stupeň      | Znamená                                                                |
| ----------- | ---------------------------------------------------------------------- |
| **BLOKUJE** | bez opravy se nesmí vydat — ztráta účetních dat nebo porušení předpisu |
| **VYSOKÁ**  | uživatel dostane špatný výsledek a nepozná to                          |
| **STŘEDNÍ** | viditelná vada nebo chybějící ochrana, kterou lze obejít               |
| **NÍZKÁ**   | drobnost, kosmetika, úklid                                             |

---

## Před vydáním

Co musí být hotové, aby šly doložit vydávací brány z
[10-KVALITA](10-KVALITA.md). Položky na sobě nezávisí.

`NAST-1` podpis, notarizace, updater · `NAST-19` smoke balíčku · `NAST-21`
doložené CI, úplné mutace a E2E s vizuální sadou · `NAST-23` licence třetích
stran v balíčku · `UCT-40` ruční import ISDOC.

---

## Účetnictví a legislativa — `UCT`

Právní podklad je v [07-PRAVO](07-PRAVO.md).

### UCT-40 · Ruční import ISDOC do cizího programu není doložený — STŘEDNÍ

Vzorky dokladů jsou `samples()` v `desktop/test/invoices.ts` (faktura,
dobropis, faktura na zálohu, minimální doklad); PDF z nich staví jen
`desktop/test/pdfa.test.ts` do dočasné složky, kterou po sobě smaže. Vzorky
uložit, importovat do Pohody nebo Money S3 a ověřit číslo, částku, odběratele,
příznak neplátce a vazbu dobropisu. Program, verzi a výsledek zapsat do
[10-KVALITA](10-KVALITA.md) k vydávacím branám.

### UCT-36 · Otázky pro účetního — NÍZKÁ

- `crossingDay` a `stageOf` (`src/utils/dashboard.ts`): dobropis stáhne roční
  součet pod 2 536 500 Kč, hranice ale v průběhu roku padla — karta hlásí
  „plátcem od 1. 1.". Ověřit, jestli dobropis zpětně ruší okamžité plátcovství.
- `readReceived` (`desktop/received.ts`) bere `TaxInclusiveAmount` bez ohledu
  na `DocumentType=2`, takže kladně zapsaný přijatý dobropis se započte jako
  výdaj kladně. U vydaných dokladů kladný dobropis odmítne `checkSource`
  (`desktop/import.ts`), `intoInvoice` znaménko sám nenormalizuje. Rozhodnout
  nad vzorkem z Pohody nebo iDokladu: normalizovat, nebo odmítnout.

---

## Bezpečnost a soukromí — `BEZP`

### BEZP-17 · Vadné logo se tiše vynechá — NÍZKÁ

`invoiceFiles` (`desktop/invoice/mod.ts`) logo, které nejde dekódovat, v prázdném
`catch` vynechá, takže doklad vyjde bez loga a uživatel se to nedozví;
`vaultHasLogo` (`desktop/vault.ts`) přitom Nastavení hlásí, že logo je. Stane se
to i logu, které iCloud na tenhle Mac nestáhl. Vadné logo ve vaultu ohlásit.

---

## Chyby v aplikační logice — `LOG`

### LOG-36 · Odpověď ARES přepíše formulář i po změně IČO — STŘEDNÍ

`fillFromAres` v `src/pages/customers/[id].vue` i
`components/invoice/CustomerDialog.vue` přepíše formulář, i když se mezitím
změnilo IČO (`vault/Wizard.vue` to hlídá přes `lastLookupIco`). Tlačítko
i funkce jsou zkopírované. Sjednotit a přidat kontrolu IČO.

### LOG-28 · Integrace hlásí běžící most bez ověření — NÍZKÁ

`integrations.vue` hlásí „Most běží" podle `mcpSocketPath` (`desktop/mcp/mod.ts`),
který jen skládá cestu a běh mostu neověřuje. Selhání `serveMcp` zná jen log
(`openMcp` v `desktop/window.ts`). Stav mostu ověřovat skutečně.

### LOG-30 · Změna data vystavení nepřepočítá splatnost — NÍZKÁ

Setter `issueDate` v `dateFields` (`src/pages/invoice/[id].vue`) mění jen
`issueDate` a je to ruční `computed` s `toCalendarDate`/`fromCalendarDate`,
kdežto `dueDate` používá `useDateModel`. Posun dopředu skončí „Splatnost před
vystavením", posun dozadu splatnost tiše prodlouží. Převést na `useDateModel`
a u nového dokladu posouvat splatnost o stejný počet dní, dokud se na ni
nesáhlo.

### LOG-31 · Jeden vadný soubor vypadá jako přesunutá složka — NÍZKÁ

`app.vue` při jakékoli chybě `init()`/`load()` (`useVaultData.load` slučuje
chyby všech souborů) ukáže „Datová složka není na svém místě" a nabídne „Začít
načisto" (`start-error-fresh`), i když jde o jeden vadný JSON. Chybějící složku
odlišit od vadného souboru.

---

## Ovládání, rozsah funkcí a výkon — `UI`

### UI-28 · Dnešek zamrzá v setupu — NÍZKÁ

`todayDate` v `invoice/index.vue` a `pages/index.vue`, `year` a `years`
v `pricelist/index.vue` se počítají jednou při otevření stránky. Stránka
otevřená přes půlnoc ukazuje stav „Po splatnosti", `dueSoon` i výchozí rok ke
včerejšku, dokud uživatel nepřejde jinam.

### UI-32 · V nabídce faktury chybí „Zapsat platbu" — NÍZKÁ

`invoiceActions` v `invoice/index.vue` položku nemá; `InvoicePaymentsDialog`
otevře jen klik na štítek stavu. Kdo nepáruje přes Fio, musí na to přijít sám.

---

## Nástroje, build a release — `NAST`

### NAST-1 · Appka není podepsaná ani notarizovaná a nemá updater — BLOKUJE

`electron-builder.yml` má `hardenedRuntime: true` a entitlements, ale
`notarize: false`, žádnou podpisovou identitu a žádný `publish`; job `package`
v `quality.yml` balí s `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`. `electron-updater`
v `package.json` není. Nepodepsanou appku laik nespustí a bez updateru se
k uživateli nedostane žádná oprava. Patří sem Developer ID certifikát
a notarizace v CI, hosting podepsaného buildu s feedem pro updater na vlastní
doméně a záloha podpisového klíče mimo tento disk. Entitlement
`automation.apple-events` (`desktop/entitlements.plist`) začne platit až
s podpisem, takže přílohu mailu přes Mail.app je potřeba ověřit na podepsaném
buildu.

### NAST-19 · Balíček se nespouští a podpis se neověřuje — VYSOKÁ

Job `package` v `.github/workflows/quality.yml` postaví DMG a ZIP a ověří jen,
že v `.app` leží `app.asar`, rozbalený `validator.mjs` a `xmllint-wasm`; appku
z balíčku nespustí. `bun run test:release-smoke` (`tools/e2e/release-smoke.ts`:
start appky z `.output/release`, most MCP přes socket) není v CI ani v `check`.
Zapojit ho do jobu `package` a po `NAST-1` ověřit podpis (`codesign --verify`,
`spctl`).

### NAST-21 · CI není doložené skutečným během — STŘEDNÍ

Zelený běh jobů `required`, `package` a `e2e` z `.github/workflows/quality.yml`
nad identifikovanou revizí doložený není. Úplné mutace (`bun run mutants:ts`)
běží jen lokálně a zelený běh nad vydávanou revizí doložený taky není. Job `e2e`
pouští sadu s `--ignore-snapshots`, takže vizuální sadu
(`bun run test:e2e:visual`) ověřuje jen vývojový Mac.

### NAST-23 · Licence třetích stran neodpovídají buildu — STŘEDNÍ

`THIRD-PARTY-NOTICES.txt` se píše ručně a nic ho proti závislostem negeneruje
ani nekontroluje. esbuild (`tools/desktop/build.ts`) i `nuxt generate` zabalí
`devDependencies` (pdf-lib, `@xmldom/xmldom`, fast-png, qrcode, zod, Vue …) do
bundlu bez jejich licenčních textů a `files` v `electron-builder.yml` notices do
`.app` nebere.

---

## Nápady mimo současný rozsah — `NAPAD`

- **MCP se zavřenou appkou.** Agent čte vault jen přes běžící appku. Čtení
  přímo ze souborů by potřebovalo zámkový soubor respektovaný appkou
  i connectorem (`desktop/mcp/connector.ts`, `desktop/store.ts`). Má smysl, jen
  když nutnost mít appku otevřenou začne vadit.
- **Výpočty mimo hlavní proces.** Překlad Typstu (`compileTypst` v
  `desktop/pdf.ts`) a `inflateSync` ve `streamBytes` běží synchronně v hlavním
  procesu a fronta `exclusive` v `desktop/store.ts` je jedna pro všechny datové
  soubory. Worker a fronta po souborech mají smysl, jen když uložení nebo náhled
  začnou okno znatelně zdržovat.
