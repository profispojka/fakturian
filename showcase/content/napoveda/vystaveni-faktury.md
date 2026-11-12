---
kind: help
group: Každodenní práce
order: 3
title: Vystavit fakturu
description: 'Od nové faktury po uložené PDF s QR platbou: odběratel, položky z ceníku, náhled, odeslání e-mailem a upomínka.'
related:
    - /napoveda/limity-ceniku
    - /napoveda/fio
---

## Nová faktura

Tlačítko **Vytvořit** v panelu vlevo nahoře a v nabídce **Faktura** (nebo rovnou
<kbd>⌘N</kbd>). Číslo se přidělí
další v řadě podle tvého formátu: nejvyšší číslo letošního roku plus jedna.

## Odběratel

Buď ho vybereš ze seznamu, nebo zadáš jednorázově. Novou firmu si dotáhneš
z ARESu podle IČO — doplní se název, adresa, IČO i DIČ.

## Položky

Každá položka má popis, množství, jednotku a cenu za jednotku. Součty se
počítají samy.

- **Z ceníku** — vloží popis, jednotku a cenu, doplníš množství.
- U položky s **ročním limitem** je u řádku odznáček s ikonkou a nad tabulkou
  je vidět, kolik z limitu po faktuře zbude
  (viz [Ceník a roční limity](/napoveda/limity-ceniku)).

## Data a období

- **Datum vystavení** a **splatnost** — splatnost se předvyplní podle výchozího
  počtu dní z nastavení.
- **Fakturované období** je nepovinné a výchozí je minulý měsíc. Určuje také,
  do kterého roku spadne vykázaná položka ceníku.

## Náhled a uložení

Tlačítko **Náhled** ukáže fakturu přesně tak, jak ji uloží tlačítko Uložit
(nebo <kbd>⌘S</kbd>), rovnou v okně appky. Dokud doklad neuložíš, na disku nic
nevznikne.

Uložením se vytvoří PDF s vloženým ISDOC v `faktury/` a QR platba se do něj
vygeneruje z tvých platebních údajů (CZK a EUR).

## Odeslání

Po uložení appka nabídne odeslání:

- **Apple Mail a Outlook pro Mac** — vytvoří rozepsanou zprávu i s přílohou.
  Při prvním použití macOS vyskočí na povolení automatizace.
- **Ostatní klienti** — otevře `mailto:` s předvyplněným příjemcem, předmětem
  a textem a zároveň odhalí PDF ve Finderu, abys ho mohl přetáhnout.

## Oprava a smazání

- **Oprava** — dokud faktura není odeslaná, prostě ji otevři a uprav. Uloží se
  znovu. Odeslaná je zamčená a místo úpravy appka nabídne dobropis.
- **Smazání** — v seznamu faktur zvol u řádku **Smazat**, nebo tlačítko
  **Smazat** v otevřeném dokladu. Otázka řekne, co zmizí spolu s ním: PDF odejde
  do **Koše**, kde ho Finder umí vrátit, a s dokladem se smažou i jeho zapsané
  platby. Číslo se uvolní, takže po smazání posledního
  dokladu ho appka nabídne znovu. Fakturu, ke které existuje dobropis, appka
  nesmaže — nejdřív smaž dobropis.
- **Vrácení peněz odběrateli** — vystav dobropis navázaný na číslo původní
  faktury.

## Po splatnosti

Nezaplacené faktury po termínu se zvýrazní a jejich počet je v postranním
panelu. U takové faktury nabídne appka **upomínku** — připraví e-mail s číslem,
částkou a počtem dní po splatnosti.
