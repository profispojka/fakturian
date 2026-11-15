# Import a převzetí veřejných PDF z jiných fakturačních systémů

Ověřeno 15. 11. 2026. Trvalá sada **36 E2E testů prošla** nad 21 nezměněnými
veřejnými PDF. Import i převzetí vydaných faktur jsou doložené u všech tří
systémů: třemi doklady z Fakturoidu, jedním z iDokladu a jedním z Pohody.
Šest přijatých dokladů prošlo až po vytvoření výdaje a uložení přílohy.

## Rozsah a způsob ověření

Staženo 21 různých PDF: 11 z Fakturoidu, 5 z iDokladu a 5 z Pohody/mPohody.
Osm souborů jsou oficiální marketingové vzory, třináct jsou veřejně zveřejněné
doklady. Výběr není reprezentativní statistikou kompatibility těchto produktů.

Každý originál prošel skutečnými funkcemi hlavního procesu bez mocků:

- `loadPdf` a `readIsdoc`: rozpoznání PDF, přílohy a úplná kontrola ISDOC proti XSD;
- `readSource` a `importDocuments`: import mezi vydané faktury do samostatného prázdného vaultu;
- `scanVault` a `adoptDocuments`: nabídka převzetí i přímý pokus o převzetí kopie uvnitř jiného vaultu;
- `listInvoices`: opětovné načtení uloženého dokladu z evidence;
- `importReceived`: samostatná zkouška uložení přijatého dokladu do `prijate/`.

Na těchto podkladech běží také
[`external-invoices.spec.ts`](../test/e2e/workflows/external-invoices.spec.ts):
skutečné okno Electronu, renderer, IPC a zápis na disk. Nahrazený je pouze
nativní dialog výběru souborů. Každý test má vlastní domov a kopii vaultu.

Všech 21 originálů se importuje tlačítkem v Nastavení. Pět platných vydaných
faktur se navíc přebírá přes nabídku ve složce a otevírá v editoru; porovnává se
číslo, částka, popisy položek, množství a ceny. Šest platných přijatých PDF
prochází tlačítkem ve Výdajích až po záznam v `vydaje.json`, včetně kontroly
odběratele. Oba vadné demonstrační doklady mají odmítací E2E test.

U úspěchu se ověřuje shoda uloženého PDF s originálem po bajtech, načtení
z evidence a odmítnutí opakovaného importu. U převzetí se navíc ověřuje přesun
zdroje; u odmítnutí jeho zachování a prázdná evidence.
U úspěšných vydaných faktur jsou číslo, částka, datum vystavení, splatnost,
množství a jednotková cena porovnané s hodnotami z původního PDF.
Vybrané stránky jsou také vyrenderované Popplerem a vizuálně zkontrolované.

E2E smíšená dávka dvou skutečných faktur stejného dodavatele z Fakturoidu a
všech šestnácti odmítaných PDF porovnává úplný seznam důvodů ve skenu složky.
Platné doklady se převezmou a odmítnuté PDF zůstane. Přímý backendový test
navíc kontroluje odvození dodavatele, účtu a splatnosti a odmítnutí cizího IČO.

## Výsledek

| Systém         | PDF | S platným ISDOC podle XSD | Import vydaných | Převzetí vydaných | Uložení přijatého PDF |
| -------------- | --: | ------------------------: | --------------: | ----------------: | --------------------: |
| Fakturoid      |  11 |                         4 |               3 |                 3 |                     3 |
| iDoklad        |   5 |                         2 |               1 |                 1 |                     1 |
| Pohoda/mPohoda |   5 |                         2 |               1 |                 1 |                     2 |
| Celkem         |  21 |                         8 |               5 |                 5 |                     6 |

Osm platných XML neznamená osm přijatelných dokladů: nad XSD běží ještě
doménové kontroly položek, IČO, měny a plátcovství. Třináct PDF vložený ISDOC
nemá a všechny tři vstupní cesty je odmítají. To odpovídá současnému kontraktu,
včetně `UCT-38` v [08-ZNAME-OMEZENI.md](08-ZNAME-OMEZENI.md).

### Jednotlivé originály

„Bez ISDOC“ znamená odmítnutí importem, skenem, přímým převzetím i příjmem.
„Prošlo“ u importu/převzetí zahrnuje také opětovné načtení z evidence.

| Lokální název a původní zdroj                                                                                                               | Import a převzetí vydaných                      | Přijaté PDF                        |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------- |
| [fakturoid-public-2024.pdf](https://zpravy.udh.gov.cz/zprava/s2024/umdirkvapid/4097-janajanurova-24-09-03.pdf)                              | Prošlo: `24-09-03`, 40 000 Kč                   | Prošlo                             |
| [fakturoid-public-hours.pdf](https://zpravy.udh.gov.cz/zprava/s2024/umdirkvapid/4096-janajanurova-24-09-02.pdf)                             | Prošlo: `24-09-02`, 4 000 Kč, 5 × 800 Kč        | Prošlo                             |
| [fakturoid-public-fractional.pdf](https://piroplaceni.pirati.cz/zadost/file/34228/)                                                         | Prošlo: `2024-20`, 44 387,50 Kč, 167,5 × 265 Kč | Prošlo                             |
| [fakturoid-aurora.pdf](https://cdnweb.fakturoid.cz/images/screenshots/invoice-template/fa-aurora.pdf)                                       | Neplatné demonstrační IČO dodavatele `87654321` | Stejné odmítnutí                   |
| [fakturoid-solaris.pdf](https://cdnweb.fakturoid.cz/images/screenshots/invoice-template/fa-solaris.pdf)                                     | Bez ISDOC                                       | Bez ISDOC                          |
| [fakturoid-phoenix.pdf](https://cdnweb.fakturoid.cz/images/screenshots/invoice-template/fa-phoenix.pdf)                                     | Bez ISDOC                                       | Bez ISDOC                          |
| [fakturoid-orion.pdf](https://cdnweb.fakturoid.cz/images/screenshots/invoice-template/fa-orion.pdf)                                         | Bez ISDOC                                       | Bez ISDOC                          |
| [fakturoid-lyra.pdf](https://cdnweb.fakturoid.cz/images/screenshots/invoice-template/fa-lyra.pdf)                                           | Bez ISDOC                                       | Bez ISDOC                          |
| [fakturoid-vega.pdf](https://cdnweb.fakturoid.cz/images/screenshots/invoice-template/fa-vega.pdf)                                           | Bez ISDOC                                       | Bez ISDOC                          |
| [fakturoid-public-nonvat.pdf](https://smlouvy.gov.cz/smlouva/soubor/21301047/michaelajerabkova-2021-0001%20%281%29.pdf)                     | Bez ISDOC                                       | Bez ISDOC                          |
| [fakturoid-public-2023.pdf](https://smlouvy.gov.cz/smlouva/soubor/29054049/anonymiz%20faktura%20Mgr%20Jarusek%20Miroslav.pdf)               | Bez ISDOC                                       | Bez ISDOC                          |
| [idoklad-public-services.pdf](https://smlouvy.gov.cz/smlouva/soubor/36388136/Fakturace%20kve%CC%8Cten%20_Rudolfova%CC%81%20ADV.pdf)         | Prošlo: `20240006`, 95 400 Kč, 53 × 1 800 Kč    | Prošlo                             |
| [idoklad-nonvat.pdf](https://www.idoklad.cz/wp-content/uploads/2025/05/vzor-faktury-neplatce-dph.pdf)                                       | Neplatné demonstrační IČO odběratele `12345678` | Stejné odmítnutí                   |
| [idoklad-public-nonvat.pdf](https://smlouvy.gov.cz/smlouva/soubor/38451204/Faktura%20instalace.pdf)                                         | Bez ISDOC                                       | Bez ISDOC                          |
| [idoklad-public-printed.pdf](https://smlouvy.gov.cz/smlouva/soubor/35915084/Redek%20-%20tir%C3%A1%C5%BE.pdf)                                | Bez ISDOC                                       | Bez ISDOC                          |
| [idoklad-public-vat.pdf](https://www.mesto-chlumec.cz/e_download.php?file=data%2Furedni_deska%2Fobsah5230_7.pdf&original=Fa+2024000289.pdf) | Bez ISDOC                                       | Bez ISDOC                          |
| [pohoda-public.pdf](https://smlouvy.gov.cz/smlouva/soubor/31625187/Faktura.pdf)                                                             | Správně odmítnut plátce DPH                     | Prošlo: `230100375`, 276 896,40 Kč |
| [pohoda-mas-2025.pdf](https://jiznislovacko.cz/component/firedrive/?format=raw&id=1172&view=document)                                       | Prošlo: `2520070`, 1 000 Kč, neplátce DPH       | Prošlo                             |
| [pohoda-public-nonvat.pdf](https://piroplaceni.pirati.cz/zadost/file/17464/)                                                                | Bez ISDOC                                       | Bez ISDOC                          |
| [pohoda-public-2024.pdf](https://piroplaceni.pirati.cz/zadost/file/36730/)                                                                  | Bez ISDOC                                       | Bez ISDOC                          |
| [pohoda-proforma.pdf](https://www.stormware.cz/dnload/zalohova-faktura-vzor-PDF.pdf)                                                        | Bez ISDOC; jde o zálohovou fakturu              | Bez ISDOC                          |

## Překážky a meze výsledku

### Výpočet z ceny s DPH a demonstrační údaje Aurory

Oficiální vzor Aurora má platný ISDOC. První řádek nese množství `3.0`,
jednotkovou cenu bez DPH `413.22`, základ řádku `1239.67`, cenu s DPH `500.0`
a celkovou cenu řádku s DPH `1500.0`. `VATCalculationMethod` je `1`.

`3 × 413,22 = 1 239,66 Kč`, zatímco při výpočtu ze zadané ceny s DPH platí
`1 500 / 1,21 = 1 239,6694… → 1 239,67 Kč`. Podle
[standardu ISDOC](https://isdoc.cz/6.0.2/doc-en/isdoc-invoice-6_0_2_xsd)
znamená metoda `1` výpočet shora.

`desktop/isdoc/projection.ts`, funkce `linePrice`, pro tento případ ověřuje
množství proti cenám s daní, samostatně zaokrouhlený základ jednotky i celého
řádku proti sazbě a shodu vyčíslené daně. Částku řádku zachová a původní
množství s jednotkovou cenou ponechá v popisu. Nesoulad bez doloženého
výpočtu odmítá. Regresní fixture `gross-price.isdoc` má platné smyšlené IČO;
testy zahrnují příjem celých 1 500 Kč i odmítnutí chybných cen, sazby, daně
a množství.

Původní Aurora se odmítá kvůli neplatnému demonstračnímu IČO `87654321`.
Je to očekávaná odmítací E2E cesta; pozitivní kompatibilitu Fakturoidu
dokládají skutečné platné neplátcovské faktury. Převzetí plátce mezi vydané
faktury zůstává mimo podporovaný rozsah.

### iDoklad: datová vrstva může mít jiné údaje než viditelné PDF

Úspěšný skutečný export `20240006` zobrazuje adresu odběratele
„Za Císařským mlýnem 1063/5“. Jeho ISDOC ale obsahuje `StreetName=Za`
a `BuildingNumber=Císařským`. Fakturian vrací „Za Císařským“ přesně podle
vložených dat. Částka, číslo, data i položka souhlasí, úplnost adresy vůči
viditelnému PDF tímto importem zaručena není. Originální PDF zůstává zachované.

Oficiální marketingový vzor neplátce má naproti tomu neplatné IČO odběratele
`12345678`. Jeho odmítnutí odpovídá projektovým pravidlům; není to důkaz
nekompatibility formátu iDokladu.

### Pohoda: původní export neplátce s vloženým ISDOC

Doklad `2520070` zveřejněný přímo na webu dodavatele má v metadatech
`POHODA Komplet` a v ISDOC `VATApplicable=false`, `LocalCurrencyCode=CZK`
a `IssuingSystem=Ekonomický a informační systém POHODA`.
Částka je 1 000 Kč, vystavení 25. 11. 2025 a splatnost 15. 12. 2025.
Čtení, import, adopt, otevření v editoru i příjem do výdajů jsou ověřené
nad nezměněným souborem a souhlasí s vizuálně zkontrolovanou stránkou PDF.

## Lokální podklady a opakování

Originály jsou ve verzované složce
[`test/e2e/fixtures/external-invoices/`](../test/e2e/fixtures/external-invoices/README.md).
[`manifest.json`](../test/e2e/fixtures/external-invoices/manifest.json)
drží pro každý soubor URL, SHA-256 a pevná očekávání. Sada hash všech PDF
kontroluje. Běh E2E nic nestahuje a podklady zůstávají stejné i při změně
veřejného webu. Pomocné backendové zkoušky a výstupy jsou navíc v ignorované
složce `.data/external-pdf-20261115/`.

Z kořene repozitáře:

```sh
bun run test:e2e -- test/e2e/workflows/external-invoices.spec.ts --workers=2
```

Sada postaví frontend i stejný hlavní proces, jaký jde do aplikace,
včetně samostatného workeru XSD. Dočasné vaulty po zkoušce maže,
zdrojová PDF ponechává.

## Kontroly projektu

- E2E sada `external-invoices.spec.ts`: **36/36 testů prošlo**.
- Cílená sada `isdoc/projection` a `received`: **73/73 testů prošlo**.
- Celá desktopová sada: **877/877 testů prošlo**, pokrytí změněné projekce **100 %** příkazů, větví, funkcí i řádků.
- Mutace `desktop/isdoc/projection.ts`: **259/259 zabito, 100 %**, žádný přeživší ani timeout.
- `bun run lint:check`: prošlo.
- `bun run typecheck`: prošlo.
- `node scripts/check-tailwind-scales.ts`: prošlo.
- `node scripts/check-dead-css.ts`: prošlo.
- `bun run typecheck:e2e`: prošlo.

Úplné `bun run test` má **3046 úspěšných testů, 10 selhání a 1 neošetřenou chybu**.
Jde o stejných deset selhání z pěti souborů Nuxt vrstvy jako před úpravou projekce
(`contacts`, `vault-file`, `vault-schemas`, `page-expenses`, `page-settings`).
Tyto testy nejsou součástí opravy kompatibility; úplná sada není zelená.
