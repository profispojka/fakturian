# Fakturian — Backlog

Jediný seznam toho, co **zbývá udělat**: otevřené vady, chybějící testy, dluhy
v nástrojích a architektuře a nápady mimo současný rozsah. Nic jiného sem
nepatří — co appka umí, je v [01-FUNKCE](01-FUNKCE.md); jak je postavená,
v [02-TECHNOLOGIE](02-TECHNOLOGIE.md); model kvality a vydávací brány
v [10-KVALITA](10-KVALITA.md); vědomě přijaté kompromisy, co se záměrně nemění
a nálezy, o kterých je rozhodnuto, že se neřeší, v
[13-ZNAME-OMEZENI](13-ZNAME-OMEZENI.md); zamítnuté funkce v sekci „Mimo rozsah"
v [01-FUNKCE](01-FUNKCE.md).

Vyřešená položka se smaže, nepřeškrtává; důkazem opravy je kód a jeho test.
Každá položka má stabilní ID, které se po smazání znovu nepoužije, místo v kódu
(soubor a funkce, symbol nebo `data-testid`, bez čísla řádku) a konkrétní
scénář, který uživatele poškodí nebo zdrží. Oblast určuje následek, ne vrstva:
`DATA` integrita účetních dat, `UCT` účetnictví a legislativa, `BEZP` bezpečnost
a soukromí, `LOG` aplikační logika, `UI` rozhraní, `TEST` testy, `NAST` nástroje
a release, `DOC` dokumentace, `ARCH` architektura a `NAPAD` nápady mimo rozsah.
Závažnost je **BLOKUJE** (bez opravy se nesmí vydat), **VYSOKÁ** (špatný
výsledek bez upozornění), **STŘEDNÍ** (viditelná vada nebo obejitelná ochrana)
nebo **NÍZKÁ** (drobnost). Úklid kódu, duplicity, styl a „šlo by to
jednodušší" sem nepatří. Před přidáním nálezu zkontroluj „Rozhodnuto neřešit"
v [13-ZNAME-OMEZENI](13-ZNAME-OMEZENI.md); položku odtud nezakládej znovu bez
nového scénáře.

Položky níže na sobě nezávisí.

- **UCT-40 · Ruční import ISDOC do cizího programu není doložený — STŘEDNÍ.**
  Vzorky dokladů jsou `samples()` v `desktop/test/invoices.ts` (faktura,
  dobropis, faktura na zálohu, minimální doklad); PDF z nich staví jen
  `desktop/test/pdfa.test.ts` do dočasné složky, kterou po sobě smaže. Vzorky
  uložit, importovat do Pohody nebo Money S3 a ověřit číslo, částku, odběratele,
  příznak neplátce a vazbu dobropisu. Program, verzi a výsledek zapsat do
  [10-KVALITA](10-KVALITA.md) k vydávacím branám.
- **UCT-36 · Otázky pro účetního — NÍZKÁ.**
  - `crossingDay` a `stageOf` (`src/utils/dashboard.ts`): dobropis stáhne roční
    součet pod 2 536 500 Kč, hranice ale v průběhu roku padla — karta hlásí
    „plátcem od 1. 1.". Ověřit, jestli dobropis zpětně ruší okamžité plátcovství.
  - `readReceived` (`desktop/received.ts`) bere `TaxInclusiveAmount` bez ohledu
    na `DocumentType=2`, takže kladně zapsaný přijatý dobropis se započte jako
    výdaj kladně. U vydaných dokladů kladný dobropis odmítne `checkSource`
    (`desktop/import.ts`), `intoInvoice` znaménko sám nenormalizuje. Rozhodnout
    nad vzorkem z Pohody nebo iDokladu: normalizovat, nebo odmítnout.
- **NAST-1 · Appka není podepsaná ani notarizovaná a nemá updater — BLOKUJE.**
  `electron-builder.yml` má `hardenedRuntime: true` a entitlements, ale
  `notarize: false`, žádnou podpisovou identitu a žádný `publish`; job `package`
  v `quality.yml` balí s `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`. `electron-updater`
  v `package.json` není. Nepodepsanou appku laik nespustí a bez updateru se
  k uživateli nedostane žádná oprava. Patří sem Developer ID certifikát
  a notarizace v CI, hosting podepsaného buildu s feedem pro updater na vlastní
  doméně a záloha podpisového klíče mimo tento disk. Entitlement
  `automation.apple-events` (`desktop/entitlements.plist`) začne platit až
  s podpisem, takže přílohu mailu přes Mail.app je potřeba ověřit na podepsaném
  buildu. Job `package` podpis balíčku neověřuje; s certifikátem do něj patří
  `codesign --verify` a `spctl`.
- **NAPAD-1 · MCP se zavřenou appkou.** Agent čte vault jen přes běžící appku.
  Čtení přímo ze souborů by potřebovalo zámkový soubor respektovaný appkou
  i connectorem (`desktop/mcp/connector.ts`, `desktop/store.ts`). Má smysl, jen
  když nutnost mít appku otevřenou začne vadit.
- **NAPAD-2 · Výpočty mimo hlavní proces.** Překlad Typstu (`compileTypst` v
  `desktop/pdf.ts`) a `inflateSync` ve `streamBytes` běží synchronně v hlavním
  procesu a fronta `exclusive` v `desktop/store.ts` je jedna pro všechny datové
  soubory. Worker a fronta po souborech mají smysl, jen když uložení nebo náhled
  začnou okno znatelně zdržovat.
