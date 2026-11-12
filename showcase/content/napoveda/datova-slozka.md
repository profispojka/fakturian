---
kind: help
group: Data a zálohy
order: 7
title: Datová složka (vault)
description: Co v datové složce leží, proč je rozdělená do několika souborů, jak ji přesunout nebo vyměnit a co dělat s poškozeným souborem.
related:
    - /napoveda/zalohovani
    - /napoveda/prenos-dat
---

Všechna data appky jsou obyčejné soubory v jedné složce. Žádná databáze, žádný
skrytý formát.

## Co ve složce je

```
Vault/
  faktury/            2026001.pdf (PDF s vloženým ISDOC)
  prijate/            přijaté doklady tak, jak přišly
  .fakturian/
    nastaveni.json    dodavatel, odběratelé, ceník
    vydaje.json       výdaje a přijaté doklady
    platby.json       stav zaplacení faktur
    snapshots/        týdenní snímky
    cache/            cache (jde smazat)
```

## Proč víc souborů

Dělí se podle toho, **jak často se mění**. Konfigurace se upravuje jednou za
měsíc, platby a výdaje při každé akci. Kdyby to bylo v jednom souboru, vzal
by konflikt v cloudové synchronizaci všechno najednou; takhle vezme jednu
doménu.

Skrytá složka `.fakturian/` drží všechno, co zapisuje appka, takže v kořeni
vidíš jen doklady. **Celou ji nemaž** — jsou v ní odběratelé, ceník i platby.
Smazat můžeš jen `.fakturian/cache/`, appka si ji vyrobí znovu z PDF.

## Jak složku přesunout

Ve Finderu, jako každou jinou složku — appka data nestěhuje a nemá k tomu
tlačítko. Při dalším spuštění řekne, že složka není na svém místě, a ty ji
ukážeš tam, kde teď leží. Data v ní zůstala celou dobu.

Totéž platí pro přejmenování a pro složku na odpojeném disku: appka jen ztratila
cestu, ne obsah.

## Jak otevřít jinou složku

V **Nastavení → Datová složka → Změnit složku…**. Appka se na vybranou složku
přepne a ta původní zůstane nedotčená:

- **Prázdná složka** → začneš v ní načisto.
- **Složka, kde už data jsou** → otevře je. Dvě účetnictví se neslučují; každá
  složka je samostatná evidence.

Tlačítkem **Otevřít ve Finderu** se do aktuální složky dostaneš kdykoli.

## Poškozený soubor

Když se některý soubor nepodaří načíst (poškozený obsah, ruční editace), appka
to řekne a **do té domény nic nezapíše**. Radši nezapsat než přepsat skutečná
data oříznutou verzí. Ostatní části appky fungují dál.

Obnovu najdeš ve složce `.fakturian/snapshots/` nebo ve své kopii složky — viz
[Zálohování a obnova](/napoveda/zalohovani).

## Dva počítače

Vault v cloudové složce jde používat z víc strojů, ale **jen střídavě**.
Souběžná editace podporovaná není: dvě appky nad jedním souborem znamenají
tichou ztrátu dat.
