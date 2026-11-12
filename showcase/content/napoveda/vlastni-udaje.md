---
kind: help
group: Začínáme
order: 2
title: Vlastní fakturační údaje
description: Co jde na každý doklad, jak nastavit číselnou řadu a splatnost, kam patří logo a jak vypadá PDF.
related:
    - /napoveda/prvni-spusteni
    - /napoveda/vystaveni-faktury
---

**Nastavení → Fakturační údaje.** Tyhle údaje se propíšou na každý vystavený
doklad a předvyplní každou novou fakturu.

## Povinné

- **Jméno nebo název firmy**
- **Adresa** (ulice, město, PSČ)
- **IČO** — kontroluje se kontrolní číslice, překlep neprojde
- **Číslo účtu a kód banky** — z nich se skládá QR platba

Větu „Nejsem plátce DPH.“, kterou neplátce na dokladu mít musí, doplní appka
sama.

## Nepovinné, ale užitečné

- **DIČ** — jen pokud ho máš (formát `CZ` + 8–10 číslic)
- **IBAN** — appka ho umí dopočítat z čísla účtu
- **E-mail**
- **Logo** — uloží se jako `logo.png` přímo do datové složky, takže cestuje
  s daty. Nejlíp vypadá PNG s průhledným pozadím; sedí v bočním pásu dokladu.

## Číselná řada

**Formát čísla** je šablona, výchozí `{RRRR}{NNNN}` → `20260001`.

| Zástupný znak | Význam                         |
| ------------- | ------------------------------ |
| `{RRRR}`      | rok čtyřmístně                 |
| `{RR}`        | rok dvoumístně                 |
| `{NNNN}`      | pořadí v roce, doplněné nulami |

Další číslo = nejvyšší v aktuálním roce + 1; nový rok začíná od jedničky.

**Přecházíš odjinud?** Zadej i **počáteční číslo**, ať řada plynule naváže —
viz [Přenos dat](/napoveda/prenos-dat).

## Výchozí splatnost

Počet dní, o které se od data vystavení posune splatnost. U konkrétní faktury
jde datum kdykoli přepsat.

## Vzhled PDF

Doklad má jeden vzhled: boční pás s logem, kontaktem, platebními údaji a QR
kódem, hlavní plocha jen položky a částka. Tlačítko **Náhled** vyrenderuje
ukázkovou fakturu z tvých skutečných údajů bez ukládání.

Už vystavená PDF se nepřekreslují — doklad, který klient dostal, se nemá měnit
zpětně.
