---
kind: help
group: Když se něco nedaří
order: 13
title: Když se něco nedaří
description: 'Nejčastější hlášky a co za nimi je: poškozená data, chybějící doklady, nespárovaná platba nebo mlčící agent.'
related:
    - /napoveda/zalohovani
    - /napoveda/datova-slozka
---

## „Data ve složce nejdou načíst"

Některý datový soubor má poškozený obsah. Appka se nad ním **nerozjede** —
radši nic než přepsat skutečná data oříznutou verzí. Složka i doklady v ní
zůstávají na místě; hláška říká, o který soubor jde.

Co s tím:

1. Vezmi poslední dobrý soubor z `.fakturian/snapshots/` nebo ze zálohy složky.
2. Nahraď jím ten ve složce.
3. Klikni na **Zkusit znovu**.

## „Tohle je desktopová aplikace — v prohlížeči nefunguje"

Appka běží mimo své okno (typicky spuštěná jako web). Celá datová vrstva je
nativní, takže tohle není chyba dat, ale způsobu spuštění. Spusť Fakturian
normálně z `.app`.

## Složka se tváří prázdná, i když v ní faktury jsou

Přehled čte doklady z `faktury/`. Export z jiného softwaru je pojmenovaný jinak
a leží jinde — nech appku složku projít a doklady převzít, viz
[Přenos dat](/napoveda/prenos-dat).

## Faktura nejde uložit

Nejčastější důvody:

| Hláška                         | Co za tím je                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| neplatné IČO                   | nesedí kontrolní číslice — překlep                                                      |
| překročený roční limit položky | faktura by přesáhla limit z ceníku, viz [Ceník a roční limity](/napoveda/limity-ceniku) |
| chybí povinný údaj dodavatele  | doplň v Nastavení                                                                       |
| číslo už existuje              | zvol jiné — obsazená jsou čísla dokladů ve složce `faktury/`                            |

## Platba se nespárovala

Párování vyžaduje shodu variabilního symbolu **i** částky. Když klient poslal
jinou částku nebo bez symbolu, přepni stav ručně — viz [Fio](/napoveda/fio).

## QR kód se nevygeneroval

QR platba se generuje jen pro **CZK a EUR**. U jiných měn by SPAYD vyrobil kód,
který banka odmítne, tak se raději nevytvoří.

## Agent (MCP) nic nevrací

Server běží proti otevřené appce. Když Fakturian neběží, řekne to rovnou —
spusť ho a zkus dotaz znovu. Viz [Claude connector](/napoveda/claude-connector).

## Přijatá faktura se nenaimportovala

Kontroluje se IČO příjemce: když na dokladu sedí někomu jinému, import se
odmítne. Doklad bez IČO příjemce projde s varováním.

## Něco jiného

Datová složka je čitelná: JSON soubory otevřeš v textovém editoru a faktury
v Náhledu. Když si nevíš rady, začni tím, že se podíváš, co v souborech
opravdu je — na rozdíl od cloudové služby to jde.
