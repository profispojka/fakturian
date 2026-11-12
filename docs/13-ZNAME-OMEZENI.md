# Fakturian — Známá omezení

Nálezy z revizí, které **nejsou vadou** ani úkolem k opravě — jsou to vědomě
přijaté kompromisy nebo přímé důsledky architektury. Zapsané, aby v budoucí
revizi znovu nepůsobily jako překvapení a nikdo se je nepokoušel „opravit".
Co skutečně čeká na opravu, je v [05-BACKLOG](05-BACKLOG.md).

## Jak se s tímhle souborem pracuje

- Položka sem patří, když revize něco odhalí, ale řešení by znamenalo zrušit
  záměrné rozhodnutí (např. vzhled appky), ne opravit chybu.
- ID se přebírá z oblasti podle stejných prefixů jako v backlogu (`BEZP`,
  `NAST`, …) — čísla se mezi tímto souborem a backlogem nepřekrývají a znovu
  nepoužívají.
- Každá položka má místo v kódu: soubor a jméno funkce, symbolu nebo klíče
  konfigurace. Čísla řádků se nepíšou, s každou úpravou se posunou.

---

## Účetnictví a legislativa — `UCT`

### UCT-37 · Datum plnění appka nevede, limit DPH počítá podle data vystavení

`src/utils/dashboard.ts` (`vatLimit`), `desktop/invoice/isdoc.ts`
(`buildIsdoc`, `TaxPointDate` se nezapisuje). Formulář faktury datum
zdanitelného plnění nenabízí, PDF ho netiskne a vlastní ISDOC ho nenese.

**Proč:** neplátce DPH datum plnění na faktuře uvádět nemusí a zavedené
nástroje ho neplátci nenabízejí. Ověřeno 16. 9. 2026:

- **iDoklad** — vydaná faktura neplátce ukazuje jen datum vystavení a splatnosti,
  vložený ISDOC `TaxPointDate` nemá. Blog iDokladu: pole nabízí plátcům DPH.
- **Fakturoid** — nápověda „Návod, jak ve Fakturoidu nastavit DIČ a DUZP na
  faktuře": pole se zobrazuje pouze plátcům, neplátců se netýká. Identifikovaná
  osoba ho vidí jen při fakturaci do zahraničí v režimu přenesené daně nebo OSS.

Pole navíc, které nic nemění, cílového uživatele jen mate. Oba nástroje přitom
limit plátcovství hlídají — tedy podle data vystavení.

**Co tím přijímáme:** obrat pro limit se podle § 4a zákona o DPH přiřazuje
k datu uskutečnění plnění. Práce za prosinec vyfakturovaná v lednu se na kartě
Přehledu započte do nového roku, takže limit za starý rok může ukázat nižší
obrat, než jaký podle zákona byl. Kdo fakturuje na přelomu roku blízko limitu,
musí tohle hlídat sám. Odběratel s účetnictvím, který datum plnění potřebuje,
ho z dokladu nevyčte — jako u faktur z iDokladu a Fakturoidu.

**Cizí doklad:** datum plnění z importovaného ISDOC appka nečte ani netiskne.
Pole zná jen oficiální XSD 6.0.2 (`desktop/isdoc/isdoc-invoice-6.0.2.xsd`),
proti kterému se import validuje; doklady od plátců ho nesou a validací projdou,
projekce (`desktop/isdoc/projection.ts`) ho jen nečte.

### UCT-38 · Výdaj z dokladu jen s čitelnou částkou

`desktop/received.ts` (`readReceived`, `listBrokenReceived`),
`src/pages/index.vue`. Přetažené PDF se mezi výdaje dostane jen tehdy, když
z něj appka přečte ISDOC, číslo, dodavatele, datum vystavení i částku s daní.
Čísla musí být zapsaná podle `xs:decimal` (desetinná tečka) a nesmí přesáhnout
90 miliard Kč. Sken, PDF bez ISDOC nebo doklad, kterému něco z toho chybí,
import odmítne a do `prijate/` ho nezkopíruje. Soubor,
který v `prijate/` přesto leží (nakopírovaný mimo appku), ukáže Přehled jako
vadný a appka s ním dál nepracuje.

**Proč:** výdaj s neznámou částkou by tiše chyběl v Bilanci i v součtu
nákladů. Doklad buď má částku, se kterou se dá počítat, nebo v evidenci není
vůbec — mezistav „doplň ručně" neexistuje.

**Co tím přijímáme:** k výdaji od dodavatele, který ISDOC neposílá, nejde
přiložit PDF. Takový výdaj se zapíše ručně bez dokladu.

### UCT-41 · Odběratel jen český

`src/utils/validators.ts` (`isValidIco`, `isValidDic`),
`desktop/invoice/mod.ts` (`saveInvoice`), `desktop/invoice/isdoc.ts` (`buildIsdoc`).
Odběratel musí mít české IČO, DIČ může být jen české a ISDOC zapisuje zemi
napevno CZ. Zahraničního odběratele appka vyfakturovat neumí.

**Proč:** appka je pro českého neplátce DPH. Služba osobě povinné k dani v jiném
státě EU z něj dělá identifikovanou osobu a faktura pak nese režim přenesení
daňové povinnosti — to je DPH, kterou appka záměrně nevede (viz „Nezavádět
DPH" níže).

**Co tím přijímáme:** kdo fakturuje do zahraničí, potřebuje na tyto doklady
jiný nástroj.

---

## Záměrně neměnit

Změny, které vypadají jako dobrý nápad, ale riziko regrese je vyšší než přínos.

1. **Nesahat na vnitřek `buildIsdoc`** (`desktop/invoice/isdoc.ts`).
   Pořadí elementů je dané `xs:sequence`. Schéma-validita není totéž co „přečte
   to Pohoda"; přesunout kód beze změny obsahu je v pořádku, refaktorovat
   vnitřek ne.
2. **Nezavádět DPH.** Dotkne se datového modelu a nejtěžší část — `TaxTotal`
   s více sazbami — se dá ověřit jedině importem do cizího účetního softwaru.
3. **Nerozřezávat `layouts/default.vue` a `pages/index.vue` podle počtu řádků.**
   Ty řádky nese markup s utilitami, ne logika; rozdělení znamená stěhovat
   vzhled s rizikem vizuálních regresí a bez přínosu pro logiku.
4. **Nesjednocovat jazyk identifikátorů plošně.** Modul po modulu při věcném
   zásahu.
5. **Nemazat cache ani snapshoty kvůli „zjednodušení".** Bez cache parsuje
   `list_invoices` každé PDF ve vaultu a snapshoty jsou jediná lokální pojistka.

---

## Rozhodnuto neřešit

Nálezy z revizí, u kterých majitel mezi 10. a 12. 11. 2026 rozhodl, že se
neřeší. Měřítkem byla otázka „co se stane uživateli, když se to nikdy neopraví"
a odpověď nad kódem: nic, co by ho poškodilo. Je to úklid kódu, hygiena
nástrojů, obrana proti cestě, která v appce není, nebo produktový vkus. Seznam
z 12. 11. posoudily dvě nezávislé revize a zapsané je jen to, na čem se shodly.
Položka nese ID, pod kterým stála v backlogu, i když tam zbytek téhož ID
zůstává.

**Revize je nemá zakládat znovu.** Nález z tohoto seznamu se do
[05-BACKLOG](05-BACKLOG.md) vrací jen s novým scénářem, ve kterém uživatel
přijde o data, dostane špatný doklad nebo číslo, nebo ho appka viditelně zdrží —
a ten scénář musí jít dohledat v kódu. „Je to duplicitní", „šlo by to
jednodušší" a „není to konzistentní" novým scénářem není.

### Data a hlavní proces

- **DATA-25 · Hláška o záloze u rozbitého JSON.** `writeDataFile` a
  `saveSnapshot` (`desktop/store.ts`): zápis se odmítne a originál zůstane na
  místě; nepřesná může být jen věta „Kopie je v …", když se záloha nezapsala.
- **DATA-25 · Zápis indexu faktur mimo frontu.** `listInvoices`
  a `removeIndexEntry` (`desktop/invoice/index.ts`): při souběhu se ztratí jen
  záznam cache, který platí jen při shodě času změny a velikosti souboru; doklad
  se jinak přečte znovu z PDF.
- **DATA-25 · Široké rozpoznání konfliktní kopie.** `conflictOriginalName`
  (`desktop/util.ts`) bere „Faktura 2026.pdf" jako možnou kopii „Faktura.pdf".
  Šíře je záměrná: výpis si skutečné číslo přečte z PDF a užší pravidlo by
  přehlédlo skutečnou kopii od synchronizace.
- **BEZP-12 · Deduplikace příloh PDF podle odkazu.** `uniqueIsdoc`
  (`desktop/pdf.ts`) drží strop 16 příloh a 32 MB na celé PDF; opakovaný odkaz
  se do nich započítá.
- **LOG-38 · Fio nerozliší TLS a DNS, stavové kódy jsou čísla.** `fioFetch`
  (`desktop/fio.ts`): obojí končí „jste offline?" a náprava je pro uživatele
  stejná; chyba `fetch` nese adresu s tokenem, takže se z ní nic nevypisuje.
- **ARCH-13 · Hlavní proces nekontroluje dodavatele ani cíl dobropisu.**
  `saveInvoice` (`desktop/invoice/mod.ts`) ověří doklad schématem
  `invoiceSchema()`; zbytek drží `useInvoices.validate()`. Druhá cesta do
  `saveInvoice` není: volá ho jediný příkaz z jediného místa a agent přes MCP jde
  přes tutéž kontrolu.
- **ARCH-15 · Služby, které jen přeposílají IPC.** `src/services/fio.ts`,
  `expenses.ts`, `invoices.ts`: `commands.*` se smí volat jen ve službě nebo
  v composable domény, takže průchozí metoda je cena za to pravidlo.
- **ARCH-20 · Drobnosti hlavního procesu.** `markInvoiceSent`
  (`desktop/invoice/status.ts`) čte celý doklad kvůli jménu dodavatele;
  `compareNumbers` (`desktop/numbering.ts`) nemá paritní fixture s řazením ve
  výpisu, které si frontend dělá sám; `linePrice`
  (`desktop/isdoc/projection.ts`) formátuje cenu ručně jen do popisu řádku.
- **UI-37 · `get_invoice` čte celý archiv, částky jdou agentovi jako číslo.**
  `src/composables/useMcpTools.ts`: archiv je potřeba kvůli stavu platby.

### Rozhraní

- **LOG-41 · „N× na faktuře" podle popisu.** `lineCounts`
  (`components/invoice/PricePicker.vue`): jen odznáček ve výběru; limity se
  počítají jinde podle `itemId`.
- **UI-28 · Klik na řádek ceníku neotevře panel vykázání; `EmailModal` popisuje
  Finder.** `src/pages/pricelist/index.vue`, `components/invoice/EmailModal.vue`:
  panel se otevírá z nabídky řádku a text popisuje záložní cestu.
- **UI-30 · Přehled ukazuje „Top dlužníci", „Blíží se splatnost" a „Top
  odběratelé" vedle tabulky nezaplacených.** `src/pages/index.vue`: čísla jsou
  správná, jde o rozsah obrazovky.
- **UI-31 · Paleta nehledá výdaje a z tvorby nabízí jen fakturu.**
  `components/CommandPalette.vue`: vše je dostupné z panelu.
- **UI-32 · Přepínače řazení Z–A a „Nejstarší".** `customers/index.vue`,
  `pricelist/index.vue`, `invoice/index.vue`.
- **UI-33 · Pět tlačítek odběratele na faktuře, druhý formulář odběratele,
  „Uloženo" na třech místech, variabilní symbol a rok čerpání vždy vidět.**
  `src/pages/invoice/[id].vue`, `components/invoice/CustomerDialog.vue`.
- **UI-34 · IČO dodavatele u výdaje a poznámka odběratele nejsou ve výpisu;
  „Zrušit" mají jen dva formuláře.** `src/pages/expense/index.vue`,
  `customers/index.vue`, `components/invoice/ContactPicker.vue`.
- **UI-35 · Cesta ke složce v Nastavení dvakrát, logo v sekci „Datová složka",
  převzetí dokladů na třech místech vedle importu.** `src/pages/settings.vue`,
  `components/vault/AdoptOffer.vue`, `components/vault/Wizard.vue`.
- **UI-36 · Karta MCP psaná pro vývojáře; ikonka položky ceníku.**
  `src/pages/integrations.vue`, `PRICE_ICONS` v `src/constants/icons.ts`.
- **UI-37 · Virtualizace výpisů.** `virtualRows()`
  (`components/RecordTable.vue`) se zapíná až nad 100 řádků.
- **UI-37 · Stav faktury se v buňce počítá víckrát.** `settlementFor`
  a `stateOf` v `src/pages/invoice/index.vue`: výpis má desítky řádků.

### Duplicity a styly

- **ARCH-21 · Zkopírované kusy stránek.** `syncFromRoute` ve třech `[id].vue`,
  hlavička výpisu ve čtyřech `index.vue`, dvojklik přes `event.detail === 2`,
  pickery faktury nad stejným `UModal`, blok strany na faktuře, hláška importu
  a převzetí, zkracování domovské složky, blok `busy`/`try`/`finally` ve
  `vault/Wizard.vue`. Platí pravidlo z `AGENTS.md`: standardní tvar má přednost
  před deduplikací.
- **ARCH-22 · CSS a Tailwind.** Přebití `.section-title` ve třech `<style>`
  blocích, `.field` s jediným použitím, syrové hex hodnoty v `layouts/default.vue`
  a `CommandPalette.vue`, `:ui` přepisy v `invoice/index.vue`, globální
  `.page-body label`, `-ml-5` a vykřičníky v markupu, `playSwap` s vynuceným
  reflow, `RevenueChart.vue` s nereaktivním `root`.

### Testy a nástroje

- **TEST-21 · Výpis z Fia v kontraktu má tvar podle dokumentace.**
  `test/contracts/fixtures/fio-transactions.json`: kdyby se skutečná odpověď
  lišila, synchronizace nic nespáruje a platba se zapíše ručně; špatnou platbu
  nezapíše.
- **NAST-21 · Poruchové vzorky pro vadný typ, pokles pokrytí a chybějící
  validátor.** `test/tooling/quality-gate.test.ts`.
- **NAST-26 · Kontrolní skripty.** `requireTsMutations`
  (`tools/mutation/mutation-result.ts`) pustí mutanta `Ignored` s jakýmkoli
  důvodem; `errorTextRule` (`tools/lint/oxlint-fakturian.ts`) hlásí falešně při
  zastínění jména `e`.
