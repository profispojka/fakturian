# Import a převzetí veřejných PDF z jiných fakturačních systémů

Ověřeno 15. 11. 2026 nad kódem `25f1d64`, bez úpravy aplikačního kódu.

Import i převzetí vydaných faktur fungují na čtyřech nezměněných veřejných PDF:
třech z Fakturoidu a jednom z iDokladu. U Pohody je doložené načtení a uložení
přijaté faktury; úspěšné převzetí vydané faktury neplátce z Pohody tato sada
nedokládá. Jediný nalezený vzorek Pohody s ISDOC je od plátce DPH.

## Rozsah a způsob ověření

Staženo 20 různých PDF: 11 z Fakturoidu, 5 z iDokladu a 4 z Pohody/mPohody.
Osm souborů jsou oficiální marketingové vzory, dvanáct jsou veřejně zveřejněné
doklady. Výběr není reprezentativní statistikou kompatibility těchto produktů.

Každý originál prošel skutečnými funkcemi hlavního procesu bez mocků:

- `loadPdf` a `readIsdoc`: rozpoznání PDF, přílohy a úplná kontrola ISDOC proti XSD;
- `readSource` a `importDocuments`: import mezi vydané faktury do samostatného prázdného vaultu;
- `scanVault` a `adoptDocuments`: nabídka převzetí i přímý pokus o převzetí kopie uvnitř jiného vaultu;
- `listInvoices`: opětovné načtení uloženého dokladu z evidence;
- `importReceived`: samostatná zkouška uložení přijatého dokladu do `prijate/`.

Výsledky prošly skutečnými frontendovými schématy `importReportSchema`,
`adoptScanSchema` a u přijatých dokladů `receivedDocumentSchema`.
Nejde o ovládání Electronu, klikání v UI ani o ověření vytvoření záznamu ve
`vydaje.json`; test přijatých dokladů končí uložením PDF a odpovědí pro formulář výdaje.
U přijatých vzorků se zde neověřuje, zda odběratel odpovídá konkrétnímu uživateli.

U úspěchu se ověřuje shoda uloženého PDF s originálem po bajtech, načtení
z evidence a odmítnutí opakovaného importu. U převzetí se navíc ověřuje přesun
zdroje; u odmítnutí jeho zachování a prázdná evidence.
U čtyř úspěšných vydaných faktur jsou číslo, částka, datum vystavení, splatnost,
množství a jednotková cena porovnané s hodnotami z původního PDF.
Vybrané stránky jsou také vyrenderované Popplerem a vizuálně zkontrolované.

Smíšená dávka dvou skutečných faktur stejného dodavatele z Fakturoidu a jednoho
PDF bez ISDOC ověřuje pokračování po odmítnutí souboru, jediného společného
odběratele, odvození dodavatele, účtu a splatnosti ze skenu složky, odmítnutí
cizího IČO a opakovaného importu. Platné doklady se převezmou a odmítnuté PDF zůstane.

## Výsledek

| Systém         | PDF | S platným ISDOC podle XSD | Import vydaných | Převzetí vydaných | Uložení přijatého PDF |
| -------------- | --: | ------------------------: | --------------: | ----------------: | --------------------: |
| Fakturoid      |  11 |                         4 |               3 |                 3 |                     3 |
| iDoklad        |   5 |                         2 |               1 |                 1 |                     1 |
| Pohoda/mPohoda |   4 |                         1 |               0 |                 0 |                     1 |
| Celkem         |  20 |                         7 |               4 |                 4 |                     5 |

Sedm platných XML neznamená sedm přijatelných dokladů: nad XSD běží ještě
doménové kontroly položek, IČO, měny a plátcovství. Třináct PDF vložený ISDOC
nemá a všechny tři vstupní cesty je odmítají. To odpovídá současnému kontraktu,
včetně `UCT-38` v [08-ZNAME-OMEZENI.md](08-ZNAME-OMEZENI.md).

### Jednotlivé originály

„Bez ISDOC“ znamená odmítnutí importem, skenem, přímým převzetím i příjmem.
„Prošlo“ u importu/převzetí zahrnuje také opětovné načtení z evidence.

| Lokální název a původní zdroj                                                                                                               | Import a převzetí vydaných                                | Přijaté PDF                        |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------- |
| [fakturoid-public-2024.pdf](https://zpravy.udh.gov.cz/zprava/s2024/umdirkvapid/4097-janajanurova-24-09-03.pdf)                              | Prošlo: `24-09-03`, 40 000 Kč                             | Prošlo                             |
| [fakturoid-public-hours.pdf](https://zpravy.udh.gov.cz/zprava/s2024/umdirkvapid/4096-janajanurova-24-09-02.pdf)                             | Prošlo: `24-09-02`, 4 000 Kč, 5 × 800 Kč                  | Prošlo                             |
| [fakturoid-public-fractional.pdf](https://piroplaceni.pirati.cz/zadost/file/34228/)                                                         | Prošlo: `2024-20`, 44 387,50 Kč, 167,5 × 265 Kč           | Prošlo                             |
| [fakturoid-aurora.pdf](https://cdnweb.fakturoid.cz/images/screenshots/invoice-template/fa-aurora.pdf)                                       | Odmítnut rozdíl zaokrouhlení řádku; jde také o plátce DPH | Odmítnut rozdíl zaokrouhlení řádku |
| [fakturoid-solaris.pdf](https://cdnweb.fakturoid.cz/images/screenshots/invoice-template/fa-solaris.pdf)                                     | Bez ISDOC                                                 | Bez ISDOC                          |
| [fakturoid-phoenix.pdf](https://cdnweb.fakturoid.cz/images/screenshots/invoice-template/fa-phoenix.pdf)                                     | Bez ISDOC                                                 | Bez ISDOC                          |
| [fakturoid-orion.pdf](https://cdnweb.fakturoid.cz/images/screenshots/invoice-template/fa-orion.pdf)                                         | Bez ISDOC                                                 | Bez ISDOC                          |
| [fakturoid-lyra.pdf](https://cdnweb.fakturoid.cz/images/screenshots/invoice-template/fa-lyra.pdf)                                           | Bez ISDOC                                                 | Bez ISDOC                          |
| [fakturoid-vega.pdf](https://cdnweb.fakturoid.cz/images/screenshots/invoice-template/fa-vega.pdf)                                           | Bez ISDOC                                                 | Bez ISDOC                          |
| [fakturoid-public-nonvat.pdf](https://smlouvy.gov.cz/smlouva/soubor/21301047/michaelajerabkova-2021-0001%20%281%29.pdf)                     | Bez ISDOC                                                 | Bez ISDOC                          |
| [fakturoid-public-2023.pdf](https://smlouvy.gov.cz/smlouva/soubor/29054049/anonymiz%20faktura%20Mgr%20Jarusek%20Miroslav.pdf)               | Bez ISDOC                                                 | Bez ISDOC                          |
| [idoklad-public-services.pdf](https://smlouvy.gov.cz/smlouva/soubor/36388136/Fakturace%20kve%CC%8Cten%20_Rudolfova%CC%81%20ADV.pdf)         | Prošlo: `20240006`, 95 400 Kč, 53 × 1 800 Kč              | Prošlo                             |
| [idoklad-nonvat.pdf](https://www.idoklad.cz/wp-content/uploads/2025/05/vzor-faktury-neplatce-dph.pdf)                                       | Neplatné demonstrační IČO odběratele `12345678`           | Stejné odmítnutí                   |
| [idoklad-public-nonvat.pdf](https://smlouvy.gov.cz/smlouva/soubor/38451204/Faktura%20instalace.pdf)                                         | Bez ISDOC                                                 | Bez ISDOC                          |
| [idoklad-public-printed.pdf](https://smlouvy.gov.cz/smlouva/soubor/35915084/Redek%20-%20tir%C3%A1%C5%BE.pdf)                                | Bez ISDOC                                                 | Bez ISDOC                          |
| [idoklad-public-vat.pdf](https://www.mesto-chlumec.cz/e_download.php?file=data%2Furedni_deska%2Fobsah5230_7.pdf&original=Fa+2024000289.pdf) | Bez ISDOC                                                 | Bez ISDOC                          |
| [pohoda-public.pdf](https://smlouvy.gov.cz/smlouva/soubor/31625187/Faktura.pdf)                                                             | Správně odmítnut plátce DPH                               | Prošlo: `230100375`, 276 896,40 Kč |
| [pohoda-public-nonvat.pdf](https://piroplaceni.pirati.cz/zadost/file/17464/)                                                                | Bez ISDOC                                                 | Bez ISDOC                          |
| [pohoda-public-2024.pdf](https://piroplaceni.pirati.cz/zadost/file/36730/)                                                                  | Bez ISDOC                                                 | Bez ISDOC                          |
| [pohoda-proforma.pdf](https://www.stormware.cz/dnload/zalohova-faktura-vzor-PDF.pdf)                                                        | Bez ISDOC; jde o zálohovou fakturu                        | Bez ISDOC                          |

## Překážky a meze výsledku

### Fakturoid: výpočet z ceny s DPH naráží na kontrolu jednotkové ceny bez DPH

Oficiální vzor Aurora má platný ISDOC. První řádek nese množství `3.0`,
jednotkovou cenu bez DPH `413.22`, základ řádku `1239.67`, cenu s DPH `500.0`
a celkovou cenu řádku s DPH `1500.0`. `VATCalculationMethod` je `1`.

`desktop/isdoc/projection.ts`, funkce `linePrice`, požaduje přesnou shodu
množství a ceny bez DPH s částkou řádku: `3 × 413,22 = 1 239,66 Kč`.
Výsledkem ve všech cestách je:

> řádek 1: 3.0 × 413.22 Kč nedává částku řádku 1239.67 Kč

Rozdíl odpovídá zaokrouhlení při výpočtu ze zadané ceny s DPH:
`1 500 / 1,21 = 1 239,6694… → 1 239,67 Kč`. To je konkrétní překážka
kompatibility projekce s tímto způsobem výpočtu, zejména pro přijaté doklady.
Mezi vydané faktury by tento doklad stejně neměl projít, protože je od plátce.
Vzor obsahuje také demonstrační IČO; odstranění první překážky samo o sobě
nezaručuje přijetí celého vzoru. Test nemění data ani neuvolňuje validaci.

### iDoklad: datová vrstva může mít jiné údaje než viditelné PDF

Úspěšný skutečný export `20240006` zobrazuje adresu odběratele
„Za Císařským mlýnem 1063/5“. Jeho ISDOC ale obsahuje `StreetName=Za`
a `BuildingNumber=Císařským`. Fakturian vrací „Za Císařským“ přesně podle
vložených dat. Částka, číslo, data i položka souhlasí, úplnost adresy vůči
viditelnému PDF tímto importem zaručena není. Originální PDF zůstává zachované.

Oficiální marketingový vzor neplátce má naproti tomu neplatné IČO odběratele
`12345678`. Jeho odmítnutí odpovídá projektovým pravidlům; není to důkaz
nekompatibility formátu iDokladu.

### Pohoda: chybí pozitivní vzorek vydané faktury neplátce s ISDOC

Čtení nativního ISDOC, částka s daní a uložení přijatého PDF jsou doložené
skutečným exportem Pohody. Oba veřejné neplátcovské vzorky vložený ISDOC
nemají. Z této sady proto nelze tvrdit, že je úspěšné převzetí vydaných faktur
z Pohody ověřené. K jeho doložení je potřeba nezměněný export neplátce v CZK
s vloženým ISDOC. Není nahrazen dokumentem vygenerovaným Fakturianem.

## Lokální podklady a opakování

Originály jsou v ignorované složce `.data/external-pdf-20261115/sources/`,
nikoli mezi verzovanými fixtures. Dále tam jsou:

- `sources.json`: původní URL každého staženého PDF;
- `results.json`: všech 20 výsledků, hlášky, SHA-256, metadata, přečtené údaje a opakované importy;
- `batch-results.json`: smíšená dávka, sken, kontrola IČO a duplicity;
- `*.pdf.isdoc`: beze změny vytažené přílohy těch PDF, která projdou XSD;
- `verify.ts`, `build.mjs` a `run.log`: ověřovací skript a jeho výstup.

Z kořene repozitáře:

```sh
node .data/external-pdf-20261115/build.mjs
node .data/external-pdf-20261115/runtime/verify.mjs
```

Skript překládá stejné produkční moduly esbuildem stejně jako desktopový build,
včetně samostatného workeru XSD. Dočasné vaulty po zkoušce maže, zdrojová PDF
ponechává. Bez těchto lokálních souborů je potřeba podklady znovu stáhnout;
protokol sám nepřidává síťové testy do běžné testovací sady.

## Kontroly projektu

- Cílená sada `adopt-folder`, `adopt`, `import`, `invoice/import` a `received`: **141/141 testů prošlo**.
- `bun run lint:check`: prošlo.
- `bun run typecheck`: prošlo.
- `node scripts/check-tailwind-scales.ts`: prošlo.
- `node scripts/check-dead-css.ts`: prošlo.
- Úplné `bun run test`: **3041 prošlo, 10 selhalo, 1 neošetřená chyba**, celkem 153 souborů.

Selhání úplné sady jsou v `test/nuxt/integration/contacts.spec.ts`,
`vault-file.spec.ts`, `vault-schemas.spec.ts` a `test/nuxt/pages/page-expenses.spec.ts`,
`page-settings.spec.ts`. Aplikační kód ani tyto testy tato zkouška neupravuje.
Úplnou sadu proto nelze označit za zelenou. Mutace se nepouštěly, protože se
aplikační zdrojové soubory nemění.
