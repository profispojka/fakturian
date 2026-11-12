---
kind: help
group: Začínáme
order: 1
title: První spuštění
description: 'Tři kroky po instalaci: vybrat datovou složku, vyplnit vlastní fakturační údaje a vystavit první doklad.'
related:
    - /napoveda/datova-slozka
    - /napoveda/vystaveni-faktury
---

Po instalaci tě appka provede třemi kroky. Trvá to pár minut a nic z toho se
neposílá na internet.

## 1. Vyber datovou složku

Appka nabídne `~/Documents/Fakturian`. Můžeš zvolit jinou — a je to důležité
rozhodnutí, protože **umístění složky zároveň určuje, jak se data zálohují
a synchronizují**:

| Kam složku dáš                        | Co tím získáš                                   |
| ------------------------------------- | ----------------------------------------------- |
| iCloud Drive / Dropbox / Google Drive | synchronizace mezi zařízeními a záloha mimo dům |
| Time Machine                          | historii verzí                                  |
| Git repozitář                         | verzování s poznámkami                          |
| USB / externí disk                    | data mimo počítač                               |

Složka nemusí být prázdná. Když v ní už doklady jsou, appka je najde a nabídne
převzít — viz [Přenos dat z jiného softwaru](/napoveda/prenos-dat).

## 2. Vyplň vlastní údaje

Jméno nebo název firmy, IČO, adresa, číslo účtu. Tyhle údaje jdou na každý
doklad, takže je appka bez nich nepustí dál.

Pár polí stojí za rozmyšlení:

- **Formát čísla faktury** — výchozí `{RRRR}{NNNN}` dá `20260001`. Když
  přecházíš odjinud, nastav i počáteční číslo, ať řada plynule naváže.
- **Výchozí splatnost** — počet dní, o který se posune datum splatnosti.

## 3. Vystav první doklad

V panelu vlevo nahoře je tlačítko **Vytvořit**, v jeho nabídce **Faktura**. Odběratele buď vybereš ze seznamu,
nebo ho rovnou dotáhneš z ARESu podle IČO. Položky vložíš z ceníku nebo napíšeš
ručně.

Uložením vznikne PDF s vloženým ISDOC a QR platbou přímo v datové složce.

## Co dělat, když se něco nepovede

- **Appka hlásí, že složka nejde použít** — zkontroluj, že do ní máš právo
  zapisovat a že není jen pro čtení (typicky složka na jiném disku).
- **Údaje nejdou uložit** — nejčastěji neplatné IČO (kontroluje se kontrolní
  číslice) nebo prázdné povinné pole.
- **Chybová hláška o načtení dat** — ve složce je poškozený soubor. Appka
  radši nezapisuje, než aby ho přepsala; viz [Když se něco nedaří](/napoveda/reseni-potizi).
