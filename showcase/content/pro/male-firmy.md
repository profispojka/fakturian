---
kind: use-case
eyebrow: Pro rodinné a jednočlenné firmy
title: Účetnictví ve složce, kterou dáte účetní jak chcete
description: Data leží ve sdílené složce jako obyčejné soubory. Předání účetní je kopie složky, ne export z cizího systému.
lede: Když se ve firmě střídají lidé i účetní, nejcennější je, aby data byla přenositelná a čitelná i bez appky.
shot: usecase-male-firmy
shotAlt: Nastavení s datovou složkou, číselnou řadou a rotujícími snímky
faq:
    - q: Můžeme fakturovat ze dvou počítačů?
      a: Střídavě ano — vault dáte do sdílené složky a používáte ho z jednoho stroje v jednu chvíli. Když soubor mezitím změní druhý počítač, appka zápis odmítne a nabídne načtení znovu; změnu je pak potřeba udělat ještě jednou.
    - q: Jak předáme podklady účetní?
      a: Nejjednodušší je nasdílet jí složku, nebo poslat její kopii. Faktury jsou PDF s vloženým ISDOC, takže si je naimportuje strojově do svého programu.
    - q: Co když někdo omylem smaže fakturu?
      a: Smazání se ptá a PDF putuje do Koše, takže ho vrátíte Finderem. Soubor smazaný mimo appku vrátíte ze zálohy složky, datové soubory mají navíc rotující snímky posledních verzí.
    - q: Kde se dá zjistit, kolik nás stojí provoz?
      a: V sekci Výdaje a v Bilanci na Přehledu. Počítá se z toho, co zapíšete, každý výdaj jednou — appka nic nedopočítává ani nepředpovídá.
    - q: Musí mít každý svůj účet?
      a: Žádné účty nejsou. Appka nikoho nepřihlašuje — přístup k datům je přístup ke složce, takže se řídí právy na disku nebo ve sdíleném úložišti.
related:
    - /reseni/bez-cloudu
    - /pro/remeslniky
---

## Co je na tom dnes otravné

V malé firmě fakturuje obvykle jeden člověk, ale sáhnout na data potřebuje víc
lidí: společník, účetní, někdy i externí administrativa. Cloudová služba to řeší
přidáváním uživatelů — což znamená další předplatné a další účet, který někdo
zapomene zrušit, až odejde.

A pak je tu otázka, která se ptá sama, jakmile firma existuje pár let: kde ta
data vlastně jsou a co když ta služba skončí nebo zdraží?

## Jak to řeší Fakturian

### Data jsou složka, ne účet

Vault je obyčejná složka: `faktury/` s PDF dokladů, `prijate/` s přijatými
doklady a několik JSON souborů s konfigurací, výdaji, platbami
a vykázané položky ceníku. Dáte ji do iCloudu, na firemní disk nebo do Dropboxu — a tím je
vyřešená i záloha a sdílení.

Přístup se pak řídí právy na tu složku, ne uživateli v cizí aplikaci.

### Předání účetní bez exportu

Faktury jsou PDF **s vloženým ISDOC**, tedy zároveň strojově čitelné. Účetní si
je naimportuje do svého programu bez přepisování. Když chce všechno najednou,
zabalte jí složku ve Finderu — žádný exportní formát appky se do toho neplete.

### Soubory rozdělené podle toho, jak často se mění

Konfigurace se mění jednou za měsíc, platby a výdaje při každé akci — proto
nejsou v jednom souboru. Když v cloudu vznikne konflikt, vezme jednu doménu, ne
celé účetnictví.

### Náklady na provoz na jedné obrazovce

Účetní, doména, předplatná, licence — přetáhnete PDF dokladu do okna, nebo
výdaj zapíšete ručně. Bilance na Přehledu pak ukáže nákup vedle prodeje,
sečtený jen z toho, co je opravdu zaevidované.

## Jak začít

1. **Vyberte místo pro vault** — nejlépe složku ve sdíleném úložišti, které už
   používáte.
2. **Nastavte fakturační údaje firmy** a číselnou řadu; pokud přecházíte
   z jiného softwaru, navažte na stávající čísla.
3. **Domluvte se s účetní**, jestli chce průběžný přístup ke složce, nebo její
   kopii jednou za čtvrtletí.

## Na co si dát pozor

- **Jeden vault, jeden stroj v jednu chvíli.** Sdílená složka ano; souběžná
  editace se neztratí, ale každá kolize znamená změnu udělat znovu.
- Appka je **pro neplátce DPH** — jakmile se firma stane plátcem, nestačí.
- Běží **jen na macOS**.
