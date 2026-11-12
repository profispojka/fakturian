---
kind: help
group: Integrace
order: 10
title: Párování plateb z Fio banky
description: Zadání tokenu do Klíčenky, párování plateb podle variabilního symbolu a částky a co dělat s tím, co se nespárovalo.
related:
    - /napoveda/vystaveni-faktury
    - /napoveda/reseni-potizi
---

Fakturian umí stáhnout transakce z Fio banky a označit zaplacené faktury.
Je to volitelné — bez tokenu funguje zbytek appky normálně.

## Token

1. V internetovém bankovnictví Fio si vygeneruj **osobní API token**.
   Doporučujeme **jen pro čtení** — appka nic neposílá, stačí jí číst.
2. **Integrace → Fio → vložit token.** Uloží se do **Klíčenky macOS**, ne do
   souboru ve vaultu.

Token jde kdykoli smazat stejným tlačítkem.

## Synchronizace

Tlačítko **Synchronizovat platby** stáhne nové transakce (Fio dává období
zhruba 90 dní zpět) a zkusí je spárovat.

Podmínka spárování je **shoda ve dvou věcech zároveň**:

1. **variabilní symbol** = číslo faktury,
2. **částka**.

Při shodě se faktura označí jako zaplacená a uloží se i datum platby. Co
nesedí, uvidíš zvlášť — appka si nic nedomýšlí.

## Co se nespáruje

| Situace                                  | Co s tím                              |
| ---------------------------------------- | ------------------------------------- |
| klient zaplatil bez variabilního symbolu | označ fakturu ručně jako zaplacenou   |
| poslal jinou částku (sleva, poplatek)    | označ ručně, případně vystav dobropis |
| platba přišla po částech                 | označ ručně, až dojde zbytek          |
| platba je starší než stažené období      | označ ručně                           |

Ruční přepnutí stavu je vždycky možné — párování je pomůcka, ne autorita.

## Jiné banky

Zatím jen Fio a jen přes živé API. Import výpisů (CSV, GPC) se neřeší, protože
každý formát a každá banka je vlastní svět a špatně naparsovaný výpis je horší
než žádný.
