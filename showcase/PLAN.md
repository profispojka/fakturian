# Prezentační web Fakturian — plán

Výstup fáze 0–1 skillu `app-showcase`. Všechna rozhodnutí o obsahu se měří
proti tomuhle dokumentu.

## Zadání (od zadavatele)

| Věc        | Rozhodnutí                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| doména     | zatím žádná → zástupná `https://fakturian.cz`, mění se na jednom místě (`nuxt.config.ts` → `site.url`) |
| hosting    | Vercel (statický výstup `nuxt generate`)                                                               |
| hlavní CTA | **zatím žádná akce** — web informuje, nesbírá e-maily, nenabízí stažení                                |
| cena       | jen model (jednorázová platba, žádné předplatné), bez čísla                                            |
| jazyk      | jen česky                                                                                              |

Build zatím není podepsaný ani notarizovaný (fáze J), auto-updater chybí —
web proto nikde neslibuje stažení.

## Pozicování

> Pro **živnostníka bez zaměstnanců, který fakturuje pár desítek dokladů ročně
> a zároveň platí subdodavatele**, je Fakturian **desktopová appka pro macOS**,
> která **ukáže faktury, náklady a vykázané dny pohromadě — lokálně,
> bez cloudu a bez účtu**. Na rozdíl od Fakturoidu a iDokladu **nesoutěží
> jednoduchostí, ale tím, že je vidět, jak na tom podnikání je**.

Vymezení, které patří na web nahlas:

- **jen pro neplátce DPH** — plátcovství se neřeší a řešit nebude,
- **jen macOS** (Windows je v plánu, ne ve slibu),
- **jen jeden člověk u jednoho vaultu** — souběžná editace ze dvou strojů ne,
- kdo chce jen rychle vystavit fakturu a nic víc, bude spokojenější jinde.

## Hlavní funkce

Výběr podle tří kritérií skillu (cítěná bolest × je to vidět × odlišuje).

| #   | Funkce                                       | Proč je mezi hlavními                                                                                                                     | Co je na obrázku                                                                       |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | **Data jsou obyčejné soubory ve tvé složce** | Jediné skutečné odlišení proti cloudovým službám; řeší strach „co když skončí". Bolest: lock-in, mizející přístup, cizí server.           | Vault ve Finderu vedle appky: `faktury/2026001.pdf`, `.fakturian/vydaje.json`          |
| 2   | **Ceník s ročním limitem položky**           | Nikde jinde; hlídá dohodnutých X dní dovolené (nebo měsíců paušálu) a nepustí fakturu přes limit. Bolest: „kolik dní jsem letos vykázal?" | Položka ceníku s limitem a výpisem faktur + faktura, která limit překročí a neuloží se |
| 3   | **Platby se spárují samy z Fio**             | Bolest: ruční odškrtávání zaplacených faktur. VS + částka → stav se přepne sám.                                                           | Seznam faktur se stavy zaplaceno / po splatnosti                                       |
| 4   | **Claude connector (MCP)**                   | Aktuální a pro cílovku silné: agent pracuje nad skutečnými daty, protože jsou to soubory na disku.                                        | Stránka Integrace s příkazem + odpověď agenta                                          |

Náhradníci (jdou do sekce „další funkce", ne mezi hlavní): PDF s vloženým ISDOC
a čtyřmi vzhledy, QR platba, import historie z Fakturoidu/iDokladu, převzetí
plné složky, sledování limitu plátcovství, dobropisy, ⌘P paleta.

## Devět landing pages

Osy: profese × velikost provozu × situace × prostředí. Každá má vlastní data
na obrázcích, vlastní FAQ a vlastní důkaz.

| #   | URL                     | Pro koho                                             | Bolest                                      | Hlavní důkaz                                        |
| --- | ----------------------- | ---------------------------------------------------- | ------------------------------------------- | --------------------------------------------------- |
| 1   | `/pro/programatory`     | vývojář na volné noze, fakturuje měsíčně podle hodin | přepisování hodin z trackeru                | desetinné množství hodin, sazba z ceníku             |
| 2   | `/pro/konzultanty`      | konzultant s dohodnutou dovolenou                    | vykázané dny se hlídají v tabulce           | roční limit položky ceníku a blokace při překročení |
| 3   | `/pro/remeslniky`       | řemeslník, pár faktur měsíčně                        | složité appky, chce klid a papír            | ceník položek, QR platba, tisk                      |
| 4   | `/pro/male-firmy`       | rodinná firma, fakturuje jeden člověk                | data na cizím serveru, střídání účetní      | vault ve sdílené složce, předání kopií složky       |
| 5   | `/prechod/z-fakturoidu` | přechází z Fakturoidu                                | „přijdu o historii a rozbiju číselnou řadu" | import ISDOC + navázání na řadu                     |
| 6   | `/prechod/z-idokladu`   | přechází z iDokladu                                  | totéž + plná složka PDF na disku            | převzetí složky, sken bez zápisu                    |
| 7   | `/reseni/bez-cloudu`    | kdo nechce data v cloudu                             | GDPR, mlčenlivost, cizí server              | vault, offline provoz, dvě volitelné online funkce  |
| 8   | `/reseni/offline`       | práce bez internetu (dílna, chata, letadlo)          | cloudová appka bez signálu nefunguje        | appka bez internetu, jen dvě funkce vypnuté         |
| 9   | `/reseni/ai-agent`      | kdo pracuje s Claude/AI agentem                      | agent nevidí do fakturačního cloudu         | MCP server nad vlastním vaultem                     |

Anti-doorway kontrola: každá stránka má vlastní datovou sadu pro screenshoty,
vlastní 4–6 otázek FAQ a odkazy na dvě příbuzné stránky.

## Obrázky (fáze 4)

- `hero-prehled` — dashboard s daty (světlá i tmavá)
- `feature-vault` — Finder + appka (skládaný obrázek, viz `showcase/README`)
- `feature-limit-ceniku` — roční limit položky ceníku (výřez)
- `feature-platby` — seznam faktur se stavy (zoom na stav)
- `feature-mcp` — stránka Integrace (výřez)
- `usecase-*` — 9 obrázků, každý s daty daného oboru
- `help-*` — obrázky ke článkům nápovědy
- `og-*` — 1200×630 pro hlavní stránky

## Videa (fáze 5)

| Klip       | Délka | Obsah                                       |
| ---------- | ----- | ------------------------------------------- |
| `hlavni`   | ~35 s | od přehledu přes novou fakturu k PDF a QR   |
| `dovolena` | ~15 s | položka s limitem, kde je vykázaná, blokace |
| `platby`   | ~15 s | synchronizace Fio → faktura zaplacená       |
| `vault`    | ~15 s | složka, soubory, sync do iCloudu            |
| `mcp`      | ~18 s | dotaz agenta a odpověď nad vaultem          |

## Nápověda (fáze 7)

První spuštění, vystavení faktury, přechod z jiného softwaru, záloha a
obnova, ceník s limity, Fio, MCP, řešení potíží, klávesové zkratky.

## Co web nikdy neřekne

- žádné počty uživatelů, recenze, loga zákazníků,
- žádný slib termínu vydání,
- žádné „nejlepší" a „revoluční",
- žádná funkce z oblasti `NAPAD` v `docs/05-BACKLOG.md`, která není hotová
  (Windows, Toggl, další banky).
