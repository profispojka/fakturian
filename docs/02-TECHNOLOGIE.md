# Fakturian — Technologie

## Přehled architektury

```
┌───────────────────────────────────────────────┐
│  Electron  (desktopový obal)                    │
│  ┌──────────────────────────────────────────┐  │
│  │  Nuxt (SPA režim) + Nuxt UI + TypeScript │  │  ← UI v rendereru (Chromium)
│  └──────────────────────────────────────────┘  │
│        preload: window.fakturian (IPC)          │
│  hlavní proces: TypeScript v Node (desktop/)    │  ← soubory, PDF, síť, MCP
└───────────────────────────────────────────────┘
              │
              ▼
   Vault = uživatelem zvolená složka (offline)
     faktury/ = PDF/A-3 s vloženým ISDOC (1 soubor = 1 doklad)
     prijate/ = přijaté doklady od subdodavatelů
     .fakturian/ = nastaveni.json (dodavatel + kontakty + ceník)
                   vydaje.json  platby.json
                   snapshots/  cache/index.json
   ARES REST API (jen při dotažení firmy)
   Fio API (jen při synchronizaci plateb)
```

- **Obal aplikace:** Electron. Renderer (Chromium) zobrazuje frontend, hlavní
  proces v Node obsluhuje všechno, co sahá mimo stránku.
- **Frontend:** Nuxt ve **statickém SPA režimu** + Nuxt UI komponenty.
- **Systémové operace:** TypeScript v hlavním procesu (`desktop/`), sazbu PDF
  a klíčenku obstarávají nativní addony. Čistá doménová logika zůstává ve `src/`
  a hlavní proces ji importuje přes alias `~` (`tools/desktop/build.ts`).
- **Data:** faktury jako PDF/A-3 s vloženým ISDOC, k tomu sada JSONů rozdělených
  podle domény — vše ve vaultu. Žádný server, žádná databáze.

---

## Frontend — Nuxt + Nuxt UI

- **Nuxt 4** s **`ssr: false`** → generuje statickou SPA. V zabalené appce
  **neběží Node server**: `nuxt generate` vydá `.output/public` a hlavní proces
  ho servíruje přes vlastní schéma `app://fakturian` (`desktop/protocol.ts`).
  Cesta, kterou soubor z buildu neobslouží, dostane `index.html` a vyřeší ji
  router.
- **Nuxt UI v4** — hotové komponenty (tabulky, formuláře, modály, tlačítka),
  postavené na Tailwind CSS.
- **TypeScript** všude.
- **Zod** — jediný popis toho, jak má co vypadat. Formuláře ho dostávají přímo
  (`<UForm :schema>`, Nuxt UI umí Standard Schema) a stejná schémata hlídají
  i to, co do appky přiteče zvenčí (viz „Hranice s vnějškem" níž). Doménové
  predikáty, které zod neumí — mod-11 u IČO, mod-97 u IBANu, kalendářní platnost
  data — jsou čistými funkcemi v `utils/validators.ts` a `utils/date.ts` a zod je
  jen volá. Pravidla psaní schémat jsou ve skillu `.claude/skills/zod-validace/`,
  práce s datem v [AGENTS.md](../AGENTS.md).
- **`useState`** (vestavěné v Nuxtu) pro sdílený stav — **bez Pinia**. Stav
  obalují composables (`useInvoices()`, `useContacts()`, `usePricelist()` …).
- **VueUse** podle potřeby.

Rozdělení `src/` na `schemas/`, `services/`, `composables/`, `utils/`
a `constants/` popisuje [AGENTS.md](../AGENTS.md). Odtud plyne i to, kde smí
stát volání `commands.*` (IPC do hlavního procesu): **jen ve `src/services/`
nebo v composable domény, které se týká** (`src/composables/`). Stránka ani
komponenta ho nevolá napřímo — jde přes composable nebo službu.

---

## Hranice s vnějškem — co se kontroluje a proč

Do frontendu vede jen jedna sada obalů `commands.*`, ale nese různé druhy dat.
Schéma vždy bydlí ve `src/schemas/`, nikdy u svého volání — jinak by na službě
závisel každý, kdo potřebuje jen typ.

| Odkud                                                 | Schéma                                     |
| ----------------------------------------------------- | ------------------------------------------ |
| Fio (HTTP i rozbor v hlavním procesu, sem chodí tvar) | `schemas/fio.ts`                           |
| ARES (syrový JSON rejstříku, čte ho `parseAres`)      | `schemas/ares.ts`                          |
| Doklady z vaultu (`load_invoice`, `list_invoices`)    | `schemas/invoices.ts`                      |
| Cizí PDF s ISDOC při importu                          | `schemas/import.ts`, `schemas/expenses.ts` |
| JSON soubory ve vaultu                                | odpovídající moduly v `schemas/`           |
| Volání nástrojů od agenta (MCP)                       | `schemas/mcp.ts`                           |

Na každé hranici platí totéž (princip „Dovnitř jen kvalitní data" v
[AGENTS.md](../AGENTS.md)): údaj buď projde celou kontrolou, nebo se odmítne
celý s hláškou.

- **Tvar, který vrací hlavní proces** (typy ze `src/bindings.ts`), se kontroluje
  striktně. Nesedící tvar je naše chyba a má se ozvat na hranici, ne až
  prázdnou adresou na faktuře nebo `NaN` v součtu obratu.
- **Cizí doklad** kontroluje hlavní proces (`checkSource` v `desktop/import.ts`,
  `readReceived` v `desktop/received.ts`) a vadný odmítne celý. Odběratele z něj
  frontend založí, jen když projde `contactSchema` jako ruční zadání
  (`newContactsFromImport`); ostatní vyjmenuje s důvodem a nezaloží.
- **Soubory ve vaultu** se čtou schématem svého souboru. Soubor v jiném tvaru
  neprojde: `load()` selže, doména zůstane nenačtená a `save()` ji nepřepíše
  oříznutou verzí toho, co v souboru doopravdy bylo. Migrace starších tvarů
  appka nemá.
- **Formulářová schémata** říkají, co smí uživatel **uložit**; souborová, co jde
  **načíst**.

### Kontrakt IPC je psaný ručně

`src/bindings.ts` je jediný popis rozhraní mezi stránkou a hlavním procesem:
`CommandArgs` a `CommandResults` (argumenty a výsledek každého příkazu), obaly
`commands.*`, jména událostí a typy dat, která tečou oběma směry. Nic se
negeneruje. Hlavní proces se na něj váže v `desktop/commands.ts`: tabulka
příkazů stojí za `satisfies Contract`, takže příkaz, který nepřijme argumenty
z `CommandArgs` nebo vrátí jiný typ, než slibuje `CommandResults`, shodí
`bun run typecheck`. Zod schémata ve `src/schemas/` na tytéž typy navazují přes
`satisfies z.ZodType<…>`.

Frontend volá `commands.listInvoices(vaultPath)`, ne holý kanál. Cesta volání:

1. `commands.*` → `window.fakturian.invoke`, který vystavuje preload
   (`desktop/preload.ts`) přes `contextBridge`;
2. kanál `fakturian:invoke` (`desktop/ipc.ts`) přijme `startShell`
   v `desktop/window.ts` jen od hlavního rámce stránky appky;
3. `dispatcher` najde příkaz v `Map`, ne indexem objektu, takže jméno z webview
   nespustí nic z prototypu;
4. argumenty projdou `strictObject` schématem příkazu (`command()`), klíč navíc
   se odmítne;
5. chyba se vrací jako hodnota `{ ok: false, error }` a preload z ní udělá holý
   řetězec, který `errorText()` ukáže beze změny.

Události (`mcp-message`, `close-requested`, `focus-changed`) jdou opačně přes
`fakturian.on`. Preload hlavnímu procesu hlásí, jestli na událost někdo
poslouchá: zavření okna jinak čeká na odpověď stránky, která nenaběhla.

Zod tím **nekončí a končit nemá**: `load_invoice` vrací typ `Invoice`, ale
hodnota vznikla naparsováním ISDOC z PDF, které mohlo projít rukama cizího
softwaru — typ je slib o našem parseru, ne o těch datech. Dělba je:
**TypeScript drží tvar, zod hodnoty.** JSON soubory ve vaultu nemají typ vůbec:
`read_data_file` vrací holý řetězec, takže tam je zod jediná obrana.

Seznam nástrojů MCP posílá agentovi connector i se zavřenou appkou. Connector je
hlavní proces bez okna a seznam skládá přímo z `mcpToolList()` ve
`src/schemas/mcp.ts`, tedy z týchž schémat, kterými okno ověřuje argumenty;
druhá kopie seznamu neexistuje.

---

## Desktopová vrstva — Electron

- **Spuštění** (`desktop/main.ts`): zámek jedné instance (druhé spuštění jen
  přenese okno do popředí), schéma `app://`, CSP, nativní menu
  (`desktop/menu.ts`). S argumentem `--mcp` se místo okna spustí connector MCP.
- **Okno** (`desktop/window.ts`): `contextIsolation`, `sandbox` a bez
  `nodeIntegration`, vývojářské nástroje jen mimo balíček. Stránka nesmí otevřít
  další okno, odejít na cizí adresu ani dostat oprávnění webu (`secureContents`).
  Velikost a pozice se ukládají do `.window-state.json` a okno mimo připojené
  monitory dostane jen uloženou velikost.
- **Zavření** křížkem, ⌘W, ⌘Q i z Docku jde přes stránku (`close-requested`),
  která se zeptá na rozepsaný doklad a okno zavře příkazem `close_window`.
  Stránka, která na událost neposlouchá, zavření nezdrží.
- **Moduly hlavního procesu:**
    - **Dialogy** — `dialog` Electronu jako sheet okna (`pick_folder`,
      `pick_files`, `pick_save_path` v `desktop/system.ts`).
    - **Konfigurace appky mimo vault** — `desktop/preferences.ts`, soubor
      `fakturian.json` s cestou k vaultu.
    - **Síť** — `fetch` z Node v hlavním procesu (`desktop/ares.ts`,
      `desktop/fio.ts`), bez přesměrování, s časovým limitem.
    - **Odkazy a Finder** — `open_url` pustí jen `http:`, `https:` a `mailto:`,
      `reveal_path` ukáže soubor ve Finderu.
    - **Oznámení** — `Notification` Electronu po synchronizaci.
    - **Log** — `desktop/log.ts` připisuje do
      `~/Library/Logs/com.fakturian.desktop/Fakturian.log`; nezachycené chyby
      hlavního procesu tam zapíše `main.ts`.
    - **Souborový systém webview nedostane** — soubory ve vaultu čtou
      a zapisují vlastní příkazy (`read_data_file`, `write_data_file`), cestu
      přetaženého souboru zná jen preload (`pathForFile`).
    - **Klíčenka** — Fio token v macOS Keychain přes `@napi-rs/keyring`
      (`AsyncEntry`). Jestli token existuje, zjistí
      `security find-generic-password` bez čtení hesla, takže se klíčenka
      neptá.
- Vlastní **příkazy** pro doklady: `save_invoice` = vysázet PDF s vloženým
  ISDOC, `load_invoice` = otevřít jeden doklad podle čísla (jen z `faktury/`,
  cestu z frontendu nebere), `list_invoices` = projít vault a vrátit souhrny
  i soubory vyžadující zásah, `delete_invoice` = přesun dokladu do Koše.
    - Příkazy jsou `async` funkce v hlavním procesu. Mimo jeho vlákno běží
      kontrola ISDOC proti XSD (worker `validator.mjs`) a čekání na klíčenku;
      sazba typstu je synchronní volání nativního addonu.

### CSP — brzda na odchozím provozu

Hlavní proces přidá ke každé HTML stránce z buildu hlavičku, kterou sestaví
`contentSecurityPolicy()` v `desktop/protocol.ts`. Podstatné jsou `connect-src
'self'` a `img-src 'self' data: blob:`: webview nemá kam poslat data
(`new Image().src = 'https://…'` ani `fetch`), ARES i Fio jdou přes hlavní
proces. `script-src` je `'self'` a hashe inline skriptů, které do HTML vložil
`nuxt generate`, takže cizí vložený skript neprojde. Pro `bun run dev` dá
`developmentPolicy()` navíc `'unsafe-inline' 'unsafe-eval'` a websocket dev
serveru pro HMR. Adresu dev serveru (`FAKTURIAN_DEV_URL`) zabalená appka
ignoruje.

Externí zdroje appka nemá: ikony `@nuxt/icon` jsou zabundlované do klientského
JS (`nuxt.config.ts`), fonty ani obrázky se z internetu netahají.

---

## Ukládání dat — datová složka („vault", jako Obsidian)

Data nežijí ve skrytém adresáři aplikace, ale ve **složce, kterou si zvolí
uživatel**. Zálohu a sync řeší uživatel tím, kam složku umístí (iCloud Drive,
Dropbox, Git, Time Machine, USB); vlastní cloud appka nemá.

- **Volba složky:**
    - Při prvním spuštění průvodce „zvol / vytvoř datovou složku" (výchozí návrh
      `~/Documents/Fakturian`).
    - Cesta se uloží do `fakturian.json` v
      `~/Library/Application Support/com.fakturian.desktop/`. Tutéž složku
      dostane Electron jako `userData` a leží v ní i stav okna a socket MCP
      s klíčem; Fio token je v Klíčence, log v `~/Library/Logs/`.
    - Změna složky v Nastavení appku přepne; data zůstávají, kde leží. Přesunutou
      složku uživatel jen znovu ukáže.
- **Přístup k libovolné složce:** distribuce je mimo App Store (DMG/ZIP), tedy
  bez sandboxu macOS. Přístup k Dokumentům, Ploše, Stažené, externím a síťovým
  diskům a cloudovým úložištím povoluje uživatel systému; popisky žádostí jsou
  v `mac.extendInfo` v `electron-builder.yml`.
- **Soubory ve vaultu:**
    - `faktury/` — **jedna faktura = jeden PDF** pojmenovaný podle čísla
      (`20260001.pdf`). PDF/A-3 nese v příloze **ISDOC XML**. Dobropisy leží
      tamtéž a sdílejí číselnou řadu; typ se rozliší v ISDOC.
    - `prijate/` — **přijaté doklady** od subdodavatelů, uložené tak, jak přišly.
      `import_received` přijme jen PDF s čitelným ISDOC a částkou
      `TaxInclusiveAmount` (`UCT-38` v [13-ZNAME-OMEZENI](13-ZNAME-OMEZENI.md)).
      `list_broken_received` najde soubory, které tam přesto leží, a Přehled je
      ukáže spolu s vadnými fakturami z `list_invoices`.
    - `.fakturian/` — **skrytá** složka se vším, co zapisuje appka.
    - `.fakturian/nastaveni.json` — vlastní údaje dodavatele, kontakty
      (odběratelé) a ceník.
    - `.fakturian/vydaje.json`, `platby.json` — data zapisovaná
      při každé akci. Oddělená od konfigurace, aby konflikt v cloudu vzal jednu
      doménu, ne všechno.
    - `.fakturian/snapshots/` — zálohy `soubor.razítko.přípona`, PDF faktur
      v `snapshots/faktury/`. Na soubor zůstane první záloha každého týdne (stav
      z konce minulého), nejvýš pět týdnů zpátky (`saveSnapshot` v
      `desktop/store.ts`). Obnova je ruční ve Finderu.
    - `.fakturian/cache/index.json` — **zahoditelná cache** (viz níže).
    - `logo.png` — volitelné logo na fakturu, ve vaultu, aby cestovalo s daty.
    - **Nikdy SQLite.** Data musí jít otevřít textovým editorem.
    - Vazbu řádku na ceník nese standardní `SellersItemIdentification`; stav
      odeslání a rok čerpání limitu nesou `Extensions` ve vlastním jmenném
      prostoru (viz mapování níž).
- **Vlastní údaje (dodavatel)** v `.fakturian/nastaveni.json` jsou zdrojem pro
  nové faktury; do každé faktury se identita zapíše i do ISDOC
  `AccountingSupplierParty`.
- **Číslování faktur:** další číslo se počítá **z názvů souborů** ve `faktury/`.
  Běžná PDF se neotvírají; jen název vypadající jako konfliktní kopie se porovná
  s číslem uvnitř ISDOC. iCloud zástupce `.20260001.pdf.icloud` i konfliktní
  kopie číslo dál rezervují. Bere se nejvyšší pořadí **v aktuálním roce** + 1;
  nový rok začíná od `0001`. **Formát je uživatelská šablona** (výchozí
  `{RRRR}{NNNN}`), aby šlo navázat na řadu z jiného softwaru. Čísla se porovnávají
  bez ohledu na velikost písmen (APFS ji v názvu nerozlišuje). Kontrola volného
  čísla a zápis běží v jedné frontě (`invoiceWrites`) a nový doklad se zapisuje
  přes `writeNew` (příznak `wx`), takže obsazené jméno nepřepíše ani souběžné
  uložení, ani soubor, který mezitím přinesla synchronizace. **Zálohová faktura
  není zvláštní typ dokladu.**
- **Seznam a Přehled:** appka projde `faktury/`, z každého PDF vytáhne ISDOC
  a načte přehledová pole. Výsledek se ukládá do `.fakturian/cache/index.json`
  jako **cache** — jde kdykoli smazat a přegenerovat. **Nikdy není zdrojem
  pravdy.** iCloud zástupce a konfliktní nebo duplicitní PDF vrací jako položky
  vyžadující zásah; do součtů se dostane nanejvýš jedna jednoznačná verze čísla.
- **Synchronizační konflikty JSONů:** vedlejší `platby 2.json`,
  `platby (… conflicted copy).json` ani `.platby.json.icloud` nejsou nová
  doména. Čtení i zápis dotčené domény se zastaví, dokud uživatel konflikt
  nerozhodne ve Finderu. Zápis porovná soubor s otiskem z posledního čtení;
  existující soubor, který appka nečetla, je konflikt taky.
- **Přepnutí složky = nový start:** `setVault()` novou cestu zapamatuje a načte
  appku znovu na Přehledu (`window.location.replace('/')`). Rozběhnutá práce
  tím zanikne a nemůže po `await` pokračovat nad jinou složkou. Otevření první
  složky (průvodce) stránku znovu nenačítá.
- **Rušení = smazání do Koše:** `delete_invoice` přesune PDF do systémového Koše
  nástrojem `/usr/bin/trash` (macOS 15+, přes `NSFileManager`) a appka zahodí
  platby dokladu. Fakturu s dobropisem hlavní proces smazat odmítne.
- **Odeslání a opravy:** označení „odesláno" je výslovná akce uživatele. Odeslaný
  doklad jde upravit, formulář se ale před uložením zeptá. Čas a odpovědná osoba
  jsou ve vloženém ISDOC v `Extensions`; `save_invoice` je z původního PDF
  přenese do nové verze (`copySent`). Původní PDF jde před přepisem do
  týdenních záloh.
- **Atomický zápis:** zápis do dočasného souboru a přejmenování (`writeAtomic`).

---

## ARES (dotažení firmy podle IČO)

- Veřejné REST API
  `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/{ICO}`;
  vrací název, adresu, IČO, DIČ.
- Volá ho příkaz `ares_subject` (`desktop/ares.ts`) v hlavním procesu, stav
  dotazu drží `useAres()`. Hlavní proces vrátí syrový JSON a ověří ho až
  `parseAres` ve `services/ares.ts`.
- IČO jde do cesty URL, takže ho příkaz před dotazem ověří (osm číslic, kontrolní
  součet, žádná mezera).
- Přesměrování je vypnuté (`redirect: 'manual'`) — poslalo by dotaz na adresu,
  kterou appka nezná. Dotaz má limit 15 s.
- Bez ARESu appka funguje dál, odběratel jde zadat ručně.

### Kde volání žije — obojí v hlavním procesu

Webview má v CSP `connect-src 'self'` a na síť nedosáhne. Dělicí čára je mezi
tím, co z odpovědi hlavní proces vrací:

- **ARES** je veřejný GET bez autentizace a jeho odpověď je cizí JSON, takže
  hlavní proces ho předá tak, jak přišel, a tvar ověří schéma ve frontendu.
- **Fio** má token **v cestě URL**. Do webview token nesmí, takže hlavní proces
  výpis i rozebere (`parseFio`) a vrací jen `FioPayment[]`. Chyba `fetch` nese
  celou adresu i s tokenem, proto ji `fioFetch` nahradí vlastní větou bez
  `cause`.

---

## Synchronizace plateb — Fio banka API

- **Fio REST API** `https://fioapi.fio.cz/v1/rest/`, endpoint
  `/periods/{token}/{od}/{do}/transactions.json`.
- **Autentizace:** osobní API token (doporučeně read-only), uložený v macOS
  **Keychain** přes `@napi-rs/keyring`, ne v souboru. Z klíčenky se čte nejvýš
  jednou za běh, protože každé čtení může otevřít systémový dialog.
- **Limit:** Fio povoluje 1 dotaz na token za 30 s. `useFio` si pamatuje čas
  posledního dotazu a další v té lhůtě odmítne sám; nový token čeká od nuly.
  Žádný polling na pozadí.
- **Párování plateb na faktury** (`matchPayments` v `utils/fio.ts`):
    - bere jen **příchozí** transakce i s jejich ID (`column22`),
    - doklad určí **variabilní symbol** (číslice z čísla faktury; úvodní nuly se
      nepočítají); částka rozhoduje jen mezi doklady se stejným symbolem,
      dobropis se nepáruje,
    - k dokladu zapíše platbu se skutečnou částkou, datem a `fioId`,
    - pohyb, jehož ID už v `platby.json` leží, přeskočí; uhrazený nebo
      dobropisovaný doklad další platbu nedostane a pohyb bez ID se nezapíše,
    - nespárované platby se jen počítají.

---

## PDF + ISDOC (formát faktury)

**Faktura se ukládá jako PDF/A-3 s vloženým ISDOC XML** — princip jako
Factur-X/ZUGFeRD, jen s českým ISDOC. Model dokladu a jeho vrstvy popisuje
[09-ISDOC-MODEL](09-ISDOC-MODEL.md).

- **Vizuál** sází typst přes nativní překladač
  `@myriaddreamin/typst-ts-node-compiler` (`desktop/pdf.ts`) z šablony pro A4.
  Šablona píše písmem Libertinus Serif, které nese překladač; systémová písma
  typst.ts načítá taky, proto test hlídá, že se do PDF žádné nedostane. Sazba
  je testovatelná bez GUI.
- **Šablona je soubor:** `desktop/templates/invoice.typ`, který esbuild přibalí
  jako text. Zdroj pro render vznikne slepením šablony a řádku `#pdf.attach`
  s ISDOC (`invoiceTypst`). Data chodí jako `invoice.json` (`InvoiceData`
  z `invoiceData`); částky i data jsou hotové řetězce z `czkCents`/`czDate`,
  takže se PDF nerozejde s obrazovkou.
- **Vložení ISDOC:** typst přibalí `invoice.isdoc` jako embedded file při sazbě
  (`relationship: "source"`, MIME `text/xml`, jak předepisuje ISDOC 6.0.2)
  v režimu **PDF/A-3a**.
- **Změna existujícího dokladu** (odeslání): `pdf-lib` přepíše obsah přílohy na
  místě (`replaceIsdoc`). **Čtení zpět** vytáhne ISDOC přes `pdf-lib`
  (`readIsdoc`), XML drží `@xmldom/xmldom`.
- **Každý přečtený ISDOC projde celým XSD 6.0.2** (`parse` v
  `desktop/isdoc/mod.ts`). Kontrolu dělá libxml2 z `xmllint-wasm` ve workeru
  `validator.mjs`, takže hlavní vlákno nečeká; schéma je soubor
  `desktop/isdoc/isdoc-invoice-6.0.2.xsd` přibalený do bundlu.
- **ISDOC pro neplátce:** `VATApplicable=false`, daňové sumy 0, sazba 0 %.
- **PDF/A-3a** ověřuje test externím validátorem veraPDF.

**Dobropis** používá tutéž šablonu a v ISDOC se označí jako opravný doklad.
Šablona ho pozná podle `kind`: místo „Celkem k úhradě" píše „Celkem k vrácení"
a platební údaje i splatnost vynechá. Vždy vrací celou fakturu; hlídá to
`creditTargetOf` pro formulář i agenta a `CreditTargets` v
`desktop/invoice/import.ts` pro import a převzetí složky. Vypořádání faktury
a dobropisu počítá `settlementOf` nad `ledgerOf`.

### Limit plátcovství DPH

Karta na Přehledu sčítá obrat za kalendářní rok podle **data vystavení**
a počítá i loňský rok (`vatLimit` v `utils/dashboard.ts`). Datum zdanitelného
plnění appka nevede; proč, popisuje `UCT-37` v
[13-ZNAME-OMEZENI](13-ZNAME-OMEZENI.md).

### ISDOC — mapování polí

Editace faktury = naparsovat ISDOC z PDF → naplnit formulář → upravit →
přegenerovat PDF. **Každé pole formuláře má své místo v ISDOC.**

| Pole ve formuláři                 | ISDOC 6.0.2                                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Číslo faktury                     | `Invoice/ID`                                                                                                                 |
| GUID dokladu                      | `UUID` — odvozené deterministicky z IČO + typu + čísla, při editaci se nemění                                                |
| Typ (faktura / dobropis)          | `DocumentType` (1 / opravný doklad) + reference                                                                              |
| Datum vystavení                   | `IssueDate`                                                                                                                  |
| Datum splatnosti                  | `PaymentMeans/Payment/Details/PaymentDueDate`                                                                                |
| Dodavatel                         | `AccountingSupplierParty`                                                                                                    |
| Zápis do rejstříku nebo evidence  | `Party/RegisterIdentification/Preformatted`                                                                                  |
| Neplátce DPH                      | `VATApplicable=false` (text na PDF se z toho odvodí)                                                                         |
| Odběratel (IČO/DIČ, adresa, mail) | `AccountingCustomerParty`: IČO v `PartyIdentification/ID`, DIČ v `PartyTaxScheme/CompanyID`, mail v `Contact/ElectronicMail` |
| Položka: popis                    | `InvoiceLine/Item/Description`                                                                                               |
| Položka: množství + jednotka      | `InvoicedQuantity` (+ `@unitCode`)                                                                                           |
| Položka: cena za jednotku         | `UnitPrice`                                                                                                                  |
| Řádkový / celkový součet          | `LineExtensionAmount` / `LegalMonetaryTotal`                                                                                 |
| Měna                              | `LocalCurrencyCode` — vždy `CZK`                                                                                             |
| Datum uskutečnění plnění          | `TaxPointDate` — **nezapisuje se** (`UCT-37`)                                                                                |
| Číslo účtu / IBAN                 | `PaymentMeans/Payment/Details` (`ID`/`IBAN`/`BankCode`)                                                                      |
| Variabilní symbol (= číslo)       | `PaymentMeans/.../VariableSymbol`                                                                                            |
| Poznámka                          | `Note`                                                                                                                       |
| Vazba řádku na položku ceníku     | `InvoiceLine/Item/SellersItemIdentification/ID`                                                                              |
| Rok čerpání ročního limitu        | `InvoiceLine/Extensions/fakturian:UsageYear`                                                                                 |
| Odesláno                          | `Extensions/fakturian:SentAt` + `fakturian:SentBy`                                                                           |
| QR / SPAYD                        | **není v ISDOC** — sestaví se z účtu + částky + VS                                                                           |
| Platby                            | **není v ISDOC** — `platby.json`                                                                                             |
| Vykázané množství za rok          | **není v ISDOC ani v souboru** — počítá se z řádků archivu                                                                   |
| Předchozí verze po editaci        | týdenní PDF zálohy v `.fakturian/snapshots/faktury/`                                                                         |
| Logo                              | **není v ISDOC** — `logo.png` ve vaultu                                                                                      |

Vlastní elementy `fakturian:*` jsou ve jmenném prostoru
`https://fakturian.app/isdoc/extensions/1`; schéma ISDOC je přijímá přes
`processContents="lax"`. `Extensions` se používají jen pro údaj, pro který ISDOC
nemá standardní pole.

**Odeslání e-mailem** má dvě cesty:

1. **AppleScript přes `osascript`** — v Mail.app vznikne rozepsaná zpráva
   **včetně přílohy** (`desktop/mail.ts`). Údaje zprávy jdou skriptu v `argv`,
   ne do jeho zdrojáku, a příloha musí být PDF uvnitř vaultu. Vyžaduje
   `NSAppleEventsUsageDescription` v Info.plist a u buildu s hardened runtime
   entitlement `com.apple.security.automation.apple-events`
   (`desktop/entitlements.plist`).
2. **Fallback `mailto:`** přes `open_url`. `mailto:` neumí přílohu, takže appka
   zároveň ukáže PDF ve Finderu.

---

## QR platba (SPAYD)

- Řetězec **SPAYD**, např.
  `SPD*1.0*ACC:CZ6508000000192000145399*AM:12100.00*CC:CZK*X-VS:20260001*MSG:Faktura 20260001`.
- Vykreslí ho hlavní proces (`qrcode` → PNG přes `fast-png`, `qrPng`
  v `desktop/invoice/payment.ts`) a typst šablona ho vloží jako
  `#image("qr.png")`.
- QR má faktura s platným účtem, dobropis žádný.

---

## Claude connector (MCP)

Connector (`desktop/mcp/connector.ts`) je tatáž appka spuštěná s `--mcp`
(rozcestí v `desktop/main.ts`) a do vaultu nesahá. Most je
`desktop/mcp/mod.ts`; v okně zprávy přijímá `useMcp.ts`, které zjistí i cesty
pro stránku Integrace (`useMcpPaths`), a nástroje vykoná `useMcpTools.ts` nad
schématy v `schemas/mcp.ts`. Zapisovatelem vaultu zůstává jen appka. Cestu
volání a zabezpečení popisuje [06-MCP](06-MCP.md).

---

## Build a distribuce

Obchodní model je **source available**, licence **FSL-1.1-MIT**. Způsob veřejné
distribuce není rozhodnutý.

- `bun run build` → `nuxt generate` (`.output/public`), `desktop:build`
  a `electron-builder` (`electron-builder.yml`). Výstup je v `.output/release`:
  DMG a ZIP pro arm64, jen macOS, minimální systém `mac.minimumSystemVersion`.
- `desktop:build` (`tools/desktop/build.ts`) zabalí esbuildem hlavní proces do
  `.output/desktop/main.mjs`, worker ISDOC do `validator.mjs` a preload do
  `preload.cjs` (preload v sandboxu nesmí být ES modul). Mimo bundl zůstávají
  jen `dependencies` — nativní addony a wasm; frontend a nástroje patří do
  `devDependencies`. Addony a worker leží v balíčku mimo archiv `asar`.
- Balíček má hardened runtime s oprávněními z `desktop/entitlements.plist`.
- **Code signing + notarizace je povinná** — nepodepsanou appku laik nespustí.
  Stav je v backlogu (`NAST-1`).
- **Žádné ověřování licence ani DRM.**
- **Auto-updater není zapojený.**

---

## Struktura projektu

```
fakturian/
├── src/
│   ├── pages/                # routy a skládání obrazovek
│   ├── layouts/              # okno s levým panelem
│   ├── components/           # části UI (podsložka = sekce, která je vlastní)
│   ├── composables/          # stav domén a aplikační orchestrace
│   ├── schemas/              # zod schémata, typy a prázdné záznamy domén
│   ├── services/             # krok ven z appky: IPC a rozbor odpovědí
│   ├── utils/                # čistá doménová logika
│   ├── constants/            # pevné tabulky a jejich typy
│   ├── plugins/              # Nuxt pluginy (chyby, ochrana rozepsaných změn …)
│   └── bindings.ts           # kontrakt IPC: příkazy, výsledky, události
├── desktop/                  # hlavní proces: okno, soubory, doklady, PDF, MCP
│   ├── templates/            # Typst šablony dokladů
│   └── test/                 # testy hlavního procesu a formátů
├── test/                     # Vitest projekty a testovací infrastruktura
├── e2e/                      # E2E scénáře a vizuální baseline
└── tools/                    # build, kontrolní, testovací a mutační skripty
```

---

## Nástroje a verze

- **Node.js** (runtime nástrojů a testů) + **Bun** (jen správce balíčků),
  **Electron**, **esbuild** a **electron-builder**. Verze a instalace jsou v
  [README](../README.md).
- Vývoj: **`bun run dev`** (`tools/desktop/dev.ts`) pustí dev server Nuxtu na
  `127.0.0.1:1420`, jednou postaví hlavní proces a otevře Electron na adrese
  dev serveru (`FAKTURIAN_DEV_URL`). Frontend se obnovuje sám, změna
  v `desktop/` potřebuje nový start. `bun run dev:web` je jen dev server Nuxtu;
  stránka v prohlížeči nemá `window.fakturian`, takže jí nefunguje ani načtení
  dat (`utils/desktop.ts` to uživateli řekne).
- Kontrola před commitem: `bun run check`, popsaná v [10-KVALITA](10-KVALITA.md).

### Externí validátory

Formát faktury se neověřuje vlastním kódem — ten by potvrdil jen sám sebe.
Testy proto volají systémové binárky; xmllint je jiná kontrola než
`xmllint-wasm`, kterým doklad čte appka:

| nástroj   | co ověřuje                                     | test                                                             |
| --------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| `xmllint` | ISDOC proti oficiálnímu XSD 6.0.2              | `desktop/test/isdoc.ts` (`schemaReport`), testy v `desktop/test` |
| `verapdf` | PDF/A-3a, který vyžaduje specifikace ISDOC.PDF | `desktop/test/pdfa.test.ts`                                      |

Bez nich příslušné testy **spadnou** — přeskočený validátor nedokazuje nic.

---

## Shrnutí volby

| Vrstva    | Technologie                       | Proč                                                                         |
| --------- | --------------------------------- | ---------------------------------------------------------------------------- |
| Obal      | Electron                          | Okno s Chromium a hlavní proces v TypeScriptu na soubory, PDF a síť          |
| UI        | Nuxt (SPA) + Nuxt UI              | Hotové komponenty, TS                                                        |
| Data      | PDF/A-3 + vložený ISDOC ve vaultu | Faktura = 1 samonosný soubor; vault (volená složka) = sync/záloha kam ji dáš |
| Firmy     | ARES REST API                     | Vyplnění odběratele podle IČO                                                |
| Platby    | Fio banka API (token)             | Označení zaplacených faktur (párování podle VS)                              |
| Token Fio | macOS Keychain                    | Bezpečné uložení, ne v plaintext JSON                                        |
| PDF       | typst.ts + pdf-lib                | Samonosná faktura: vizuál + strojová data                                    |
| E-mail    | AppleScript / `mailto:`           | Otevře mailového klienta, appka sama nic neposílá                            |
| QR        | SPAYD + `qrcode`                  | Standard pro české platby                                                    |
