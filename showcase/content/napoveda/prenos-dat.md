---
kind: help
group: Data a zálohy
order: 9
title: Přenos dat z jiného softwaru
description: Import PDF s vloženým ISDOC, převzetí složky plné PDF, navázání na číselnou řadu a přehled toho, co se nepřevezme a proč.
related:
    - /napoveda/datova-slozka
    - /napoveda/prvni-spusteni
---

Do Fakturianu vedou dvě cesty: **import dokladů** a **převzetí složky**, ve
které doklady už leží.

## Import PDF s ISDOC

Většina českých fakturačních služeb (Fakturoid, iDoklad a další) vkládá do PDF
strojově čitelná ISDOC data. Z nich appka naimportuje celé faktury — číslo,
data, odběratele, položky i částky — a doplní z nich seznam odběratelů.

Doklady se **nepřekreslují**. Zůstane přesně to PDF, které klient dostal.

## Převzetí složky

Když otevřeš složku, ve které už doklady jsou, appka ji projde (i podsložky)
a nabídne, co v ní vypadá jako tvoje vydané faktury.

- **Sken nic nemění.** Je to jen pohled.
- **Převzetí soubory přesune** do `faktury/` pod jejich číslem. Kopie by tam
  nechala tentýž doklad dvakrát.
- **Konfigurace být ve složce nemusí.** Appka si `.fakturian/nastaveni.json` vyrobí
  z dokladů: odběratele, a když ještě nemá tvoje údaje, i dodavatele, splatnost
  a tvar číselné řady. Co už máš nastavené, nepřepíše.

Nabízí se to na třech místech: v úvodním průvodci, v Nastavení a v přehledu
faktur.

## Co se nevezme (a proč)

| Doklad                 | Důvod                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------- |
| zálohová faktura       | Fakturian ji jako typ dokladu nezná — jako neplátce vystavíš zálohu běžnou fakturou |
| daňový doklad k platbě | totéž                                                                               |
| doklad plátce DPH      | appka je pro neplátce a neumí s DPH počítat                                         |
| přijatá faktura        | patří do Výdajů, ne mezi vydané doklady                                             |

Co se nevzalo, se vypíše i s důvodem — nic nezmizí potichu.

## Navázání na číselnou řadu

V **Nastavení → Fakturační údaje** zadej formát čísla (například
`{RRRR}{NNNN}`) a počáteční číslo. Další faktura pak naváže tam, kde stará
služba skončila.

## Ověření po přenosu

1. Zkontroluj počet dokladů v přehledu proti staré službě.
2. Otevři jednu naimportovanou fakturu a porovnej položky.
3. Založ novou fakturu a zkontroluj, že navržené číslo navazuje. Když ne,
   oprav počáteční číslo v Nastavení dřív, než doklad uložíš — uloženou fakturu
   pak musíš smazat, aby se číslo uvolnilo.
