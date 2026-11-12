# Fakturian — Claude connector (MCP)

Fakturian nabízí agentovi nástroje přes MCP, takže se ho můžeš zeptat „kolik mi
letos dluží ACME" nebo „vystav fakturu za listopad podle minulé" a on to udělá
nad tvými skutečnými daty.

MCP klient je aplikace, ve které agent běží (třeba Claude Code). S Fakturianem
mluví přes **connector**, a ten přes **most** v appce dojde až k **oknu**, které
jediné sahá do vaultu:

```
agent ──stdio── connector (app --mcp) ──socket── most ──event mcp-message── okno ── vault
```

Souběžné zápisy do JSONu by si tiše přepsaly data a chybu by nikdo neviděl;
s oknem jako jediným zapisovatelem souběh nevznikne.

> **Cena za to:** agent funguje, jen když máš Fakturian otevřený. Jinak volání
> vrátí „Fakturian neběží. Spusť appku…"; restart appky connector přežije.
> Dokud se data načítají nebo je některý soubor poškozený, nástroj vrátí chybu,
> nikdy prázdný výsledek.

## Registrace

```sh
claude mcp add fakturian -- /Applications/Fakturian.app/Contents/MacOS/Fakturian --mcp
```

Connector je tatáž appka, jen spuštěná s `--mcp`: `desktop/main.ts` se podle
argumentu rozhodne, jestli otevře okno, nebo obslouží agenta na stdio — bez okna,
bez ikony v Docku a bez zámku jedné instance. Nic dalšího se neinstaluje
a connector se s appkou nemůže rozejít verzí. Příkaz pro tuto instalaci je na
stránce **Integrace** i s tlačítkem na zkopírování: příkaz `mcp_connector` vrací
`{ command, args }` (`mcpConnector` v `desktop/mcp/mod.ts`). Ve vývoji je
`command` spustitelný soubor Electronu a v `args` je před `--mcp` cesta k appce.
Nástroje si můžeš dál omezit v právech svého MCP klienta.

## Nástroje

| Nástroj            | Co dělá                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `list_invoices`    | Seznam faktur: číslo, odběratel, data, částka, zaplaceno, dobropisováno, uhrazená část a datum poslední platby |
| `get_invoice`      | Detail faktury včetně položek a stavu úhrady                                                                   |
| `list_contacts`    | Odběratelé: název, IČO, e-mail, město, poznámka                                                                |
| `list_expenses`    | Výdaje: dodavatel, popis, částka, datum                                                                        |
| `pricelist_status` | Ceník za rok: u každé položky vykázáno, zbývá do ročního limitu (0 = nehlídá se), na kterých fakturách         |
| `summary`          | Obrat, náklady, marže, dlužníci, stav limitu plátcovství                                                       |
| `create_invoice`   | **Vystaví fakturu** po potvrzení v okně — číslo přidělí appka, doklad se uloží jako PDF s vloženým ISDOC       |

Nástroje a zod schémata jejich argumentů jsou v `src/schemas/mcp.ts`. Connector
posílá seznam i se zavřenou appkou a skládá ho z `mcpToolList()` téhož modulu,
takže se seznam s argumenty, které ověřuje okno, nemůže rozejít; podrobnosti
v [02-TECHNOLOGIE](02-TECHNOLOGIE.md).

## Cesta volání

1. **Agent → connector.** `initialize` (protokol `2024-11-05`, schopnost jen
   `tools`), `ping` a `tools/list` connector vyřídí sám, takže agent nástroje
   vidí i se zavřenou appkou. Neznámá metoda dostane `-32601`.
2. **Connector → most.** První `tools/call` otevře spojení na socket, connector
   se prokáže klíčem z `mcp.token` a most odpoví `ok`. Dál connector posílá jen
   `tools/call` a `notifications/cancelled`. Volání s `id`, které není řetězec
   ani celé nezáporné číslo menší než 2^53, odmítne s `-32600`, protože okno by
   ho cestou přes `JSON.parse` změnilo.
3. **Most → okno.** Most (`Bridge` v `desktop/mcp/mod.ts`, běží v hlavním
   procesu) pošle řádek událostí `mcp-message`. Než se okno načte a zavolá `mcp_attach`, zprávy čekají
   ve frontě.
4. **Okno.** `useMcp.ts` ověří zprávu, `useMcpTools.ts` argumenty a načtená data
   a nástroj vykoná. Chyba nástroje jde agentovi jako `isError` s větou, kterou
   má přečíst uživateli.
5. **Odpověď.** Okno ji pošle přes `mcp_send`, most ji zapíše do spojení
   a connector předá agentovi.

## Vystavení faktury

- **Potvrzuješ ho v okně appky; čtecí nástroje se neptají.** `create_invoice`
  doklad nejdřív zkontroluje jako formulář (odběratel, položky, součet, číselná
  řada, roční limity ceníku) a pak ukáže otázku s odběratelem a IČO, součtem,
  řádky a poznámkou. Po potvrzení znovu přečte číslo z řady i čerpání limitu.
  Odmítnutí dostane agent jako chybu.
- **Potvrzený doklad je ostrý** — se skutečným číslem z řady, zrušit ho jde jen
  smazáním v appce.
- **Dokud otázka visí, agent čeká.** Jak dlouho, určuje jeho MCP klient. Když
  čekání vzdá (`notifications/cancelled`) nebo se odpojí, otázka se zavře
  a faktura se nevystaví. Zruší-li volání až během ukládání, faktura vznikne
  a appka to řekne hláškou, protože agent se to už nedozví.
- **Dvě vystavení naráz nevzniknou.** Druhé `create_invoice` počká, až doběhne
  první, a zeptá se až potom.
- **Přerušené volání nevisí.** Když appka skončí nebo se připojené okno znovu
  načte (i po přepnutí datové složky), most zavře spojení všech connectorů.
  Connector na rozběhnutá volání odpoví, že výsledek není známý a že před
  opakováním má agent ověřit `list_invoices`. Sám volání nikdy neopakuje, aby
  fakturu nevystavil dvakrát. Zprávy, které přišly před prvním připojením okna,
  počkají ve frontě.

## Zabezpečení

- **Socket a klíč patří jen tvému účtu.** Socket leží
  v `~/Library/Application Support/com.fakturian.desktop/mcp.sock`, mimo vault,
  protože ten se synchronizuje do cloudu. Má práva 0600, jeho složka 0700.
- **Klíč se mění s každým startem.** Appka vydá nový do `mcp.token` (0600) vedle
  socketu. Spojení bez platného klíče most odmítne dřív, než se cokoli dostane
  k oknu. Proti procesu, který běží pod tvým účtem a soubor si přečte, klíč
  nechrání — proto se zápis potvrzuje v okně.
- **Stropy** v `desktop/mcp/mod.ts`:
    - `MAX_CLIENTS`: nejvýš 8 spojení naráz;
    - `MAX_BACKLOG`: nejvýš 32 zpráv čeká na načítané okno, další volání dostane
      „Okno Fakturianu se ještě načítá" a notifikace se zahodí;
    - `MAX_LINE`: zpráva nejvýš 1 MiB, delší `tools/call` odmítne už connector
      s jejím `id`;
    - spojení, které se do 5 s neprokáže klíčem, most zavře;
    - connector, který 5 s nečte odpověď, most odpojí a na jeho volání pak
      connector odpoví jako na přerušená.

## Co MCP záměrně neumí

- **Číst vault přímo.** Se zavřenou appkou by to vyžadovalo zámkový soubor
  respektovaný oběma stranami.
- **Mazat doklady.** Smazání je akce, u které chceme mít člověka u toho.
