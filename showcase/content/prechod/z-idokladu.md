---
kind: use-case
eyebrow: Přecházím z iDokladu
title: Máš složku plnou PDF? Poskládá se z ní vault
description: Appka projde složku i s podsložkami, najde tvoje vydané faktury a nabídne je převzít. Konfiguraci si dopočítá z dokladů.
lede: Export z jiného softwaru vypadá jako hromada PDF s divnými názvy. Fakturian z nich udělá funkční vault, aniž bys cokoli přepisoval.
shot: usecase-idoklad
shotAlt: Nabídka převzetí dokladů nalezených v datové složce
faq:
    - q: Musí být soubory nějak pojmenované?
      a: Ne. Sken hledá doklady podle obsahu, ne podle názvu — export z jiného softwaru se běžně jmenuje „Vydaná faktura - 2026017.pdf" a leží v podsložkách po letech nebo klientech.
    - q: Změní mi sken něco ve složce?
      a: Ne. Sken jenom najde a ukáže, co v ní vypadá jako tvoje vydané faktury. Teprve převzetí soubory přesune do faktury/ pod jejich číslem.
    - q: Proč se soubory přesouvají, a ne kopírují?
      a: Kopie by ve složce nechala tentýž doklad dvakrát — jednou původní a jednou převzatý. Přesun je jasnější a nic se nepřerenderovává.
    - q: Co když ve složce nemám .fakturian/nastaveni.json?
      a: 'Nevadí, appka si ho vyrobí z dokladů: doplní odběratele, a když ještě nemá tvoje údaje, i dodavatele, splatnost a tvar číselné řady. Existující nastavení nikdy nepřepíše.'
    - q: Co se do vaultu nevezme?
      a: Zálohové faktury, daňové doklady k platbě, doklady plátce DPH a přijaté faktury (ty patří do Výdajů). Vypíší se i s důvodem.
    - q: Kde se převzetí nabízí?
      a: Při volbě složky v úvodním průvodci, v Nastavení a v přehledu faktur — tedy tam, kde chybějící doklady někdo hledá.
related:
    - /prechod/z-fakturoidu
    - /pro/male-firmy
---

## Co je na tom dnes otravné

Z iDokladu (a většiny podobných služeb) si odejdeš s exportem: složka plná PDF,
občas rozdělená po letech nebo klientech, s názvy, kterým rozumí jen exportér.

Když takovou složku otevřeš v nové appce, tváří se prázdná — protože appka
hledá doklady tam, kde je zvyklá, a pod jinými jmény. Výsledek je, že historii
buď necháš ležet ladem, nebo ji celý večer přepisuješ.

## Jak to řeší Fakturian

### Sken složky, který nic nemění

Vybereš složku a appka ji **projde i s podsložkami**. Ukáže seznam toho, co
v ní vypadá jako tvoje vydané faktury — a čeká. Sken je jen pohled, nezapisuje.

### Převzetí přesune doklady na jejich místo

Když převzetí potvrdíš, soubory se přesunou do `faktury/` pod svým číslem.
Nic se nepřekresluje: zůstává to PDF, které klient dostal. Kopírovat by
znamenalo mít tentýž doklad ve složce dvakrát.

### Konfiguraci si appka odvodí

Nemáš `.fakturian/nastaveni.json`? Vyrobí si ho z dokladů: odběratele, a když ještě nemá
tvoje vlastní údaje, i dodavatele s IČO, adresou a účtem, výchozí splatnost
a tvar číselné řady. Co už jsi nastavil ručně, nepřepíše.

### Co se nevzalo, se vypíše

Zálohové faktury, doklady plátce DPH a přijaté faktury se nepřevezmou — a je
u nich napsané proč. Přijaté doklady si zaeviduješ ve Výdajích, kam patří.

## Jak přejít

1. **Vyexportuj doklady** z iDokladu do složky (klidně i s podsložkami).
2. **Otevři tu složku** v Fakturianu jako datovou složku.
3. **Nech ji projít** a převezmi, co appka najde.
4. **Zkontroluj číselnou řadu** v nastavení a vystav první fakturu.

## Na co si dát pozor

- Appka bere jen PDF s vloženým ISDOC: doklad **bez ISDOC** nevezme a řekne
  proč.
- Fakturian je **jen pro neplátce DPH**.
- Běží **jen na macOS** a s vaultem pracuje **jeden počítač v jednu chvíli**.
