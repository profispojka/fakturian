---
kind: help
group: Data a zálohy
order: 8
title: Zálohování a obnova
description: 'Dvě nezávislé vrstvy zálohy: umístění datové složky a týdenní snímky uvnitř appky. Plus kopie složky, kdykoli ji potřebuješ předat.'
related:
    - /napoveda/datova-slozka
    - /napoveda/reseni-potizi
---

Fakturian nemá vlastní cloud. Zálohu si řídíš sám — a máš na to dvě nezávislé
vrstvy.

## 1. Umístění složky (nejdůležitější)

Kam dáš vault, to je tvoje záloha:

| Umístění                            | Co dostaneš                        | Co nedostaneš                          |
| ----------------------------------- | ---------------------------------- | -------------------------------------- |
| iCloud Drive, Dropbox, Google Drive | synchronizaci a kopii mimo počítač | historii starších verzí (jen omezenou) |
| Time Machine                        | historii verzí a obnovu k datu     | přístup z druhého stroje               |
| Git                                 | verzování s poznámkami             | automatiku — commituješ sám            |
| USB / externí disk                  | kopii mimo počítač                 | průběžnost                             |

Nejčastější kombinace: **vault v iCloudu + Time Machine na disku**.

## 2. Týdenní snímky

Před první změnou v každém týdnu si appka odloží předchozí podobu datového
souboru i přepisované faktury do `.fakturian/snapshots/` a drží ji pět týdnů.
Snímky mají v názvu datum (`platby.2026-09-14.json`), takže je ve Finderu
poznáš. Slouží k rychlé nápravě omylu (smazaný odběratel, přepsaný ceník), ne
jako plnohodnotná záloha — leží ve stejné složce jako data.

Vracíš je **sám ve Finderu**, appka do nich nesahá. Složku ti ukáže tlačítko
v Nastavení → Zálohy.

## Předání a jednorázová kopie

Vault je obyčejná složka, takže vlastní exportní formát appka nepotřebuje.
Před velkým zásahem nebo při předání účetní ji **zkopíruj nebo zabal ve
Finderu** (pravým tlačítkem → _Komprimovat_). Dostaneš jeden soubor se vším:
PDF dokladů, přijatými doklady i JSON.

Zpátky se dostaneš tím, že složku rozbalíš a **otevřeš ji v appce** (Nastavení →
Změnit složku). Dvě účetnictví ale do jedné složky nesypej — u dvou verzí téže
faktury nejde poznat, která platí.

## Obnova

1. **Omyl v datech** → vezmi soubor z `.fakturian/snapshots/` a nahraď jím ten
   v `.fakturian/` (appku předtím zavři).
2. **Smazaná nebo přepsaná faktura** → smazanou fakturu vrátíš z Koše,
   předchozí verzi přepsaného PDF drží `.fakturian/snapshots/faktury/`. PDF
   smazané mimo appku vrátíš ze zálohy složky.
3. **Ztracený počítač** → nainstaluj appku jinde a otevři složku ze zálohy nebo
   z cloudu. Nic dalšího není potřeba, žádná aktivace.
4. **Poškozený soubor** → appka do poškozené domény nezapisuje; nahraď soubor
   ze snímku nebo z kopie složky.

## Co zálohovat nemusíš

Složku `.fakturian/cache/` — appka si ji vyrobí znovu z PDF. Zbytek `.fakturian/`
jsou data a patří do zálohy.
