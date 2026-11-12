---
kind: help
group: Každodenní práce
order: 6
title: Výdaje a přijaté doklady
description: 'Evidence nákladů a přijatých dokladů: přetažení PDF s ISDOC, ruční zápis a jak se výdaje sčítají.'
related:
    - /napoveda/datova-slozka
    - /napoveda/zalohovani
---

Každý výdaj je jeden doklad: faktura od subdodavatele stejně jako měsíční
poplatek za doménu nebo účetní.

## Přetažení PDF do okna

Nejrychlejší cesta: přetáhni PDF přijaté faktury do okna appky.

- Doklad musí mít **vložená ISDOC data** (posílá je Fakturoid, iDoklad
  i většina účetních programů). Výdaj se z nich vyplní sám — dodavatel, částka,
  datum.
- **Originál se uloží** do `prijate/` přesně tak, jak přišel.
- **Kontrola příjemce:** když IČO příjemce na dokladu nesedí s tvým, import se
  odmítne. Když v dokladu chybí (zahraniční dodavatel, fyzická osoba), projde
  s varováním.

Sken nebo PDF bez ISDOC appka nepřijme, stejně jako doklad, ze kterého nejde
přečíst částku. Takový výdaj zapíšeš ručně — dodavatel, částka, datum, popis —
jen bez přiloženého PDF. Soubor, který v `prijate/` leží a appka ho nepřečte,
uvidíš na Přehledu v upozornění na vadné doklady.

## Jak se výdaje sčítají

Každý výdaj se v součtech — Bilance na Přehledu, výdaje za měsíc — počítá
**jednou, v měsíci svého data**. Appka opakování nedopočítává ani nepředpovídá:
za takovým číslem by nestál žádný doklad. Kdo chce vidět každou platbu
předplatného, zapíše (nebo přetáhne) každý doklad zvlášť.

## Co výdaje neřeší

- **Daňovou uznatelnost** ani odpisy — to je práce pro účetní.
- **DPH** — appka je pro neplátce.
