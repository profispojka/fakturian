---
kind: help
group: Každodenní práce
order: 5
title: Ceník a roční limity
description: Ikonka a roční limit u položky ceníku, vkládání do faktur, kde je položka vykázaná a co se stane při překročení limitu.
related:
    - /napoveda/vystaveni-faktury
    - /napoveda/caste-dotazy
---

Ceník drží položky, které se na fakturách opakují — a zároveň ví, **kde všude je
máš vykázané**. U části z nich navíc bývá dohodnuté, kolik jich smíš za rok
vykázat: dovolená fakturovaná jako odpracovaný čas, paušál na dvanáct měsíců,
počet školicích dnů. Fakturian to hlídá za tebe.

## Položka ceníku

- **Název** — jak položka vypadá na dokladu. Typicky „Konzultační činnost",
  protože klient nechce na faktuře vidět slovo dovolená.
- **Poznámka** — interní, jen pro tebe („dovolená"). Do PDF ani do ISDOC se
  nikdy nedostane.
- **Cena a jednotka** — předvyplní se do faktury, množství doplníš.
- **Ikonka** z pevného výběru. Palma u dovolené řekne víc než přečtený název —
  vidíš ji ve výpisu, v nabídce „Vložit z ceníku" i u řádku faktury. Na doklad
  se nikdy nedostane.
- **Maximálně ročně** — nepovinný roční limit **v jednotce položky**. Dvacet dní
  po osmi hodinách je u hodinové položky `160`. Prázdné = položka se nehlídá,
  jen eviduje.

## Vložení do faktury

Ve faktuře vybereš položku přes **Vložit z ceníku…** a zadáš množství. Na
dokladu z toho bude běžný řádek s tvým názvem a sazbou; u hlídané položky ho
v editoru pozná odznáček s ikonkou a nad tabulkou uvidíš, kolik po téhle faktuře
z limitu zbude.

Vazbu „faktura ↔ položka" i rok čerpání nese **doklad sám** — ukládají se do něj
při vystavení a drží se na položce, ne na jejím názvu, takže přežijí i to, že si
položku později přejmenuješ. Vyčerpané množství se z těch dokladů počítá, nikam
zvlášť se nezapisuje: co se ve složce smaže, přestane z limitu ubírat.

## Rok se bere z fakturovaného období

Faktura za prosinec vystavená v lednu se připíše do **prosincového** roku.
Kdyby se počítal rok podle data vystavení, každý přelom roku by evidenci
rozhodil.

## Překročení limitu

Faktura, která by limit překročila, **neprojde validací a nejde uložit**. Není
to varování, které se dá odkliknout — překročený závazek se pak řeší dobropisem
a nepříjemným e-mailem.

Hláška „zbývá X" počítá stejně jako blokace, takže co ti appka ukáže, to
i povolí. Dobropis limit nečerpá, naopak do něj množství vrací.

## Smazaná faktura vrací množství

Vykázané množství nese samotný doklad, takže se smazanou fakturou zmizí
i jeho čerpání a množství je zase k dispozici. Nic se nepřepočítává ručně.

## Kde je položka vykázaná

Klikni na položku ve výpisu a vpravo se ukáže, kolik z ní za daný rok odešlo
a **na kterých fakturách** — u hlídané položky k tomu zbytek do limitu. Ročník
se dá přepnout; na jaře se běžně dokládá i to, co zbylo z loňska.

Seznam se počítá z dokladů ve složce, takže sedí i po zásahu zvenčí: smazané
PDF z limitu přestane ubírat samo, nic se nikde neuklízí ručně.
