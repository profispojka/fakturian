# Kontrakty mezi backendem a frontendem

`bun run test:contracts` vždy sestaví most `desktop/test/contract-bridge.ts`
esbuildem stejně jako hlavní proces (`tools/testing/test-contracts.ts`) a pustí
ho v Node. Most volá produkční moduly `desktop/`; testovací backend nahrazuje
pouze transport IPC. Na frontendové straně běží skutečné composables a jejich
validační schémata. Test neověřuje transport přes preload Electronu. Klíčenku
macOS most nahrazuje pamětí, aby kontrakt Fio nesahal na token uživatele.

Příkaz appky přesměruje do backendu
`backend.forwards('<příkaz>', (args) => realBackend({ command: … }))`: backend
dostane argumenty, které appka skutečně poslala, a jeho odpověď rozebírá totéž
schéma jako v provozu. `realBackend()` pouští pro každé volání nový proces;
`backendSession()` drží jeden proces mostu (`--serve`) pro celý test —
potřebují ho soubory vaultu, protože `store` si mezi čtením a zápisem pamatuje
otisk souboru, a Fio, protože `realBackend()` čeká synchronně a lokální HTTP
server ve stejném procesu by neodpověděl.

| Sada                  | Co drží                                                                       |
| --------------------- | ----------------------------------------------------------------------------- |
| `isdoc.spec.ts`       | XSD → backend → model dokladu → zpět do XML.                                  |
| `archive.spec.ts`     | Převzetí cizí složky, smazání dokladu a odeslání zapsané do ISDOC uvnitř PDF. |
| `fio.spec.ts`         | Bankovní výpis z Fia v modelu plateb, i přes HTTP z lokálního serveru.        |
| `vault-files.spec.ts` | Soubory vaultu (`nastaveni.json` …) čte a zapisuje skutečný `store`.          |
| `mcp.spec.ts`         | Řádky agenta přes skutečný connector a most až do okna.                       |
| `ares.spec.ts`        | Odpověď ARES ve skutečném tvaru v modelu odběratele.                          |

## ISDOC

Vstupy jsou v `desktop/test/fixtures`; jejich původ a licence jsou
v tamním README. Oficiální `example1.isdoc` a `example2.isdoc` pocházejí
z isdoc/isdoc2ubl (Apache-2.0). Ostatní použité dokumenty jsou ručně psané
syntetické vzorky projektu, žádný nově získaný zákaznický doklad.

| Vstup                              | Nezávislé očekávání                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| `bez-mnozstvi.isdoc`               | 2026-0043, 10. 3. 2026, splatnost 24. 3., CZK 4 800, jedna licence.                  |
| Varianty tohoto vzorku             | Bez zóny, Z, +02:00, −05:30, ±14:00; stejný kalendářní den. Přestupný 29. 2. 2024.   |
| Chybějící volitelná data           | Chybějící splatnost je `undefined`.                                                  |
| Vadná data                         | 30. 2. a posun +14:01 odmítne XSD i backend.                                         |
| `example1.isdoc`, `example2.isdoc` | FV-111999/2011, 28. 2. 2013, plátce DPH, čtyři položky včetně zaokrouhlení −2,51.    |
| `two-payments.isdoc`               | Účet 2000145399/0800, VS 202600047 a splatnost z bankovního převodu.                 |
| `zaokrouhleni.isdoc`               | 3 × 333,21 + 0,37 = 1 000,00 CZK.                                                    |
| `zalohova.isdoc`                   | XSD platný, import mezi vydané faktury odmítnut s vysvětlením druhu.                 |
| `bez-castky.isdoc`                 | Povinná částka chybí: odmítne XSD i backend.                                         |
| Dobropis vystavený appkou          | Vazba na fakturu (číslo, datum, UUID), `itemId` a `usageYear` řádků, záporný součet. |

Validaci zajišťuje `xmllint` proti projektovému XSD 6.0.2. Chybějící nástroj
znamená chybu. Test importu vytváří skutečné PDF v dočasné složce, načte ho,
vypíše, nabídne k převzetí a zpracuje jako přijatý doklad. Odchozí frontendový
payload přijme `buildIsdoc` backendu; jeho XML projde XSD a XPath nezávisle ověří
částku. Samostatná aserce ověřuje XML escaping Unicode poznámky.

## Archiv dokladů

Čas odeslání backend zapisuje do ISDOC uvnitř PDF a při dalším výpisu ho odtamtud
čte zpátky. `sentAt` tedy má nenulovou hodnotu jedině z toho kolečka, ne
z fixture. Smazání most provádí obyčejným odstraněním souboru místo přesunu do
Koše, aby testy neplnily systémový Koš.

| Co                | Nezávislé očekávání                                                                |
| ----------------- | ---------------------------------------------------------------------------------- |
| `fixtures/adopt/` | Tři cizí doklady: dodavatel s IČO 12345679, dva odběratelé, `outcome` je `copied`. |
| Smazání           | Doklad zmizí z přehledu i ze složky `faktury/`.                                    |
| Odeslání          | `sentAt` je čas z backendu.                                                        |
| Nedotčený doklad  | `sentAt` je `null`.                                                                |

## Fio

Výpis se do backendu posílá v syrovém tvaru, jaký vrací Fio (`column0`…`column22`),
a ven vypadne model plateb.

| Co                  | Nezávislé očekávání                          |
| ------------------- | -------------------------------------------- |
| Datum s posunem     | `2026-05-20+0200` je 20. 5. 2026.            |
| Odchozí platba      | Do výsledku se nedostane.                    |
| Variabilní symbol   | Číslo i řetězec z Fia jsou v modelu řetězec. |
| Platba bez data     | Schéma ji odmítne; dnešek nedostane.         |
| Nečitelná částka    | Odmítne ji backend, nulou se nestane.        |
| Výpis bez transakcí | Prázdný seznam, ne chyba.                    |

## Soubory vaultu

| Co                       | Nezávislé očekávání                                                      |
| ------------------------ | ------------------------------------------------------------------------ |
| Složka bez `.fakturian/` | Prázdná evidence, ne chyba.                                              |
| Uložený dodavatel        | Leží v `.fakturian/nastaveni.json` a znovu projde schématem.             |
| Soubor změněný zvenku    | Backend zápis odmítne jako konflikt, soubor na disku zůstane beze změny. |
| Nečitelný JSON           | Načtení selže hláškou backendu, soubor zůstane.                          |

## Okno MCP

Most spustí skutečný `serveMcp` a `runConnector` nad řádky z testu a vrátí, co
most poslal oknu, i kanál (`MCP_MESSAGE_EVENT`). Test ověří, že okno poslouchá
na stejném kanálu, že zprávy projdou `windowMessageSchema`
a `windowRequestSchema` a že okno na volání odpoví do stejného spojení. Zprávu
o zavření spojení most pošle po konci connectoru; vrací se zvlášť jako
`closed`.

## Fio přes HTTP

`fixtures/fio-transactions.json` servíruje lokální server skutečnému `fioFetch`;
most mu jen přesměruje adresu `fioapi.fio.cz` na server testu. Test ověří
adresu dotazu, platby v appce a hlášky pro 409, 422, 500 a nečitelné tělo.
Výpis je smyšlený ve tvaru, v jakém Fio API vrací `transactions.json`: hlavička
`info` a pohyby jako objekty `columnN` s `value`, `name` a `id`, chybějící
sloupec jako `null`. Tvar je podle dokumentace API Fio banky, ne zachycený
z reálného účtu; účet je vzorový účet ČNB, protiúčty a jména jsou vymyšlené.

## ARES

Síť obsluhuje `ares_subject` v hlavním procesu; sada drží rozbor jeho odpovědi.
`fixtures/ares-sro.json` a `fixtures/ares-zivnostnik.json` mají tvar odpovědi
`ekonomicke-subjekty` z ARES (stažené 17. 10. 2026) se smyšlenými hodnotami:
názvy, IČO, adresy i kódy územních jednotek jsou vymyšlené.

| Vstup                  | Nezávislé očekávání                                                    |
| ---------------------- | ---------------------------------------------------------------------- |
| `ares-sro.json`        | Obchodní společnost s DIČ, ulice `Krátká 2/4`, bez věty o zápisu.      |
| `ares-zivnostnik.json` | Jen živnostenský rejstřík: věta o zápisu, bez DIČ, ulice `Dlouhá 1/7`. |

Tato sada se neprezentuje jako úplné ověření všech variant standardu ISDOC.
