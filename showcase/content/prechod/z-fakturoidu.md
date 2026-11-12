---
kind: use-case
eyebrow: Přecházím z Fakturoidu
title: Přechod z Fakturoidu bez ztráty historie
description: Faktury z Fakturoidu naimportuješ z PDF s vloženým ISDOC — naplní historii i odběratele. Číselná řada naváže na stávající.
lede: 'Dvě věci, které přechod obvykle zabijí: historie zůstane ve staré službě a čísla faktur začnou od jedničky. Ani jedno tady nastat nemusí.'
shot: usecase-fakturoid
shotAlt: Seznam faktur po importu historie z jiného softwaru
faq:
    - q: Co přesně se naimportuje?
      a: Doklady ve formátu ISDOC — číslo, data, odběratel, položky a částky. Z nich se zároveň doplní seznam odběratelů. Faktury zůstanou takové, jaké je klient dostal; nic se nepřekresluje.
    - q: Co když mám doklady jen jako PDF?
      a: Přesně ty appka bere — Fakturoid do PDF vkládá ISDOC data. Když v PDF ISDOC není, appka ho nevezme a řekne proč.
    - q: Jak navážu na číselnou řadu?
      a: V nastavení zadáš formát čísla (třeba {RRRR}{NNNN}) a počáteční číslo. Další faktura pak plynule naváže na tu poslední z Fakturoidu.
    - q: Co se stane se zálohovými fakturami?
      a: Neberou se. Fakturian je jako doklad nezná — jako neplátce vystavíš zálohu běžnou fakturou na část částky.
    - q: A co doklady, kde jsem plátce DPH?
      a: Import je odmítne. Appka je stavěná pro neplátce a nechce si do dat pustit něco, s čím neumí počítat.
    - q: Zůstane mi přístup do Fakturoidu?
      a: To je na tobě a na jeho podmínkách — Fakturian s ním nijak nekomunikuje. Import je jednorázový přenos souborů, ne propojení účtů.
related:
    - /prechod/z-idokladu
    - /reseni/bez-cloudu
---

## Co je na tom dnes otravné

Přechod z fakturační služby nebrzdí cena ani funkce, ale dvě praktické obavy:

1. **„Přijdu o historii."** Faktury za poslední roky jsou ve službě a potřebuješ
   je mít po ruce — kvůli dohledávání, kontrole i klientům.
2. **„Rozbiju si číselnou řadu."** Uprostřed roku začít od `20260001`, když už
   jsi na `20260042`, je problém pro účetní i pro kontrolu.

## Jak to řeší Fakturian

### Import historie z PDF s ISDOC

Fakturoid vkládá do PDF strojově čitelná ISDOC data. Fakturian z nich umí
naimportovat celé faktury: číslo, datum vystavení a splatnosti, odběratele,
položky, částky. Zároveň si z nich **poskládá seznam odběratelů**, takže je
nemusíš zakládat ručně.

Doklady se nepřekreslují. Zůstane přesně to PDF, které klient dostal — jen
teď leží ve tvé složce a appka o něm ví.

### Navázání na existující číselnou řadu

V nastavení zadáš **formát čísla** a **počáteční číslo**. Další faktura naváže
tam, kde stará služba skončila.

### Co se nevezme, uvidíš i s důvodem

Zálohové faktury, daňové doklady k platbě a doklady plátce DPH se neberou —
appka je pro neplátce a domýšlet si u nich něco by bylo horší než je vynechat.
Vypíše je i s důvodem, ať víš, co dořešit ručně.

### Přijaté faktury patří jinam

Doklad, kde jsi příjemcem ty, se nedostane mezi vydané faktury — patří do
Výdajů. Appka kontroluje IČO příjemce a při neshodě import odmítne.

## Jak přejít

1. **Stáhni doklady z Fakturoidu** (PDF s ISDOC) do jedné složky.
2. **Zvol datovou složku** v Fakturianu — třeba tu samou.
3. **Naimportuj** doklady a zkontroluj výpis toho, co se nevzalo.
4. **Nastav číselnou řadu** na navazující číslo a vystav první fakturu.

## Na co si dát pozor

- Fakturian **nesynchronizuje** s Fakturoidem. Je to jednorázový přenos, ne
  propojení — od té chvíle fakturuješ na jednom místě.
- Appka je **jen pro neplátce DPH** a **jen pro macOS**.
- Automatické odesílání e-mailů neumí: doklad ti otevře v mailovém klientovi
  i s přílohou, odeslání je na tobě.
