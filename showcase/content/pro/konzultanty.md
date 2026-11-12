---
kind: use-case
eyebrow: Pro konzultanty a dlouhodobé spolupráce
title: Dovolená, kterou fakturuješ, se hlídá sama
description: Máš s klientem dohodnutých dvacet dní ročně a vykazuješ je jako odpracovaný čas. Fakturian ví, kolik jsi jich vybral, a fakturu přes limit neuloží.
lede: Dohodnutý fond dní je závazek, který se špatně pamatuje a ještě hůř dohledává zpětně. Tady je to jedno číslo u položky ceníku.
shot: usecase-konzultanti
shotAlt: Položka ceníku s ročním limitem — vykázané hodiny a faktury, na kterých byly
video: dovolena
faq:
    - q: Proč se dovolená jmenuje na faktuře jinak?
      a: Protože tak to bývá dohodnuté — klient chce na dokladu „Konzultační činnost", ne „dovolená". Název na dokladu si zadáš, vedle něj je interní poznámka a ikonka (třeba palma), podle kterých položku poznáš v appce.
    - q: V čem se limit zadává?
      a: V jednotce položky. Dvacet dní po osmi hodinách je u položky s jednotkou „hod" prostě 160. Žádný skrytý převod — podle toho čísla se blokuje uložení faktury, takže musí být na první pohled jasné.
    - q: Platí limit jen pro dovolenou?
      a: Ne, sedí na kterékoli položce ceníku. Stejně dobře hlídá paušál na dvanáct měsíců do roka nebo počet dohodnutých školicích dnů. Položka bez limitu se jen eviduje.
    - q: Co když fakturu s dovolenou smažu?
      a: Hodiny se vrátí. Vykázané množství nese samotný doklad, takže se smazanou fakturou zmizí i její čerpání. Když jen vracíš peníze, stejně funguje dobropis.
    - q: Do kterého roku spadne faktura za prosinec vystavená v lednu?
      a: Do prosincového. Rok se bere z fakturovaného období, ne z data vystavení, přesně kvůli tomuhle případu.
    - q: Co se stane, když limit překročím?
      a: Faktura neprojde validací a nejde uložit. Žádné částečné povolení ani varování, které se dá překlikat — jinak by hlídání nemělo smysl.
    - q: Uvidím zpětně, na kterých fakturách položka byla?
      a: Ano, po kliknutí na položku je vpravo výpis faktur i s množstvím. Vazba se zapisuje při vystavení dokladu a drží se na položce, ne na jejím názvu — takže přežije i to, že si ji později přejmenuješ.
related:
    - /pro/programatory
    - /pro/male-firmy
---

## Co je na tom dnes otravné

U dlouhodobé spolupráce bývá dohoda jednoduchá: fakturuješ odpracovaný čas
a k tomu máš dvacet dní ročně, které smíš vykázat, i když nepracuješ. Problém
není v dohodě, ale v evidenci.

Fakturační služba o žádném limitu neví — pro ni je to obyčejná položka. Takže si
dny píšeš do tabulky, do poznámek v telefonu nebo nikam. V listopadu pak nastane
otázka „kolik mi ještě zbývá?" a odpovědět se dá jedině pročtením faktur od
ledna.

## Jak to řeší Fakturian

### Limit sedí na položce ceníku, ne v poznámce vedle

Položka „Konzultační činnost" dostane **maximálně ročně 160** (dvacet dní po
osmi hodinách), interní poznámku „dovolená" a palmu jako ikonku. Od té chvíle je
to hlídané — a nejde jen o dovolenou: stejně se hlídá paušál na dvanáct měsíců
nebo počet dohodnutých školicích dnů.

### Vložení do faktury je jedno kliknutí

Ve faktuře vybereš položku z ceníku jako každou jinou a zadáš hodiny. Na dokladu
z toho bude běžný řádek s tvým názvem a sazbou; v editoru ho pozná odznáček
s ikonkou a nad tabulkou je vidět, kolik po téhle faktuře z limitu zbude.

### Přes limit to nepustí

Když by faktura limit překročila, **neuloží se**. Ne varování, ne „opravdu
chcete", ale prostě neprojde validací — protože překročený závazek se pak řeší
dobropisem a nepříjemným e-mailem.

Hláška počítá stejně jako blokace, takže „zbývá 24 hod" znamená přesně to, co
appka příště povolí.

### Rok se určuje z období, ne z data vystavení

Faktura za prosinec vystavená v lednu se připíše do prosincového roku. Bez toho
by se každý přelom roku počítal špatně a evidence by se rozjela.

## Jak začít

1. **Nastav limit** u položky v Ceníku: „maximálně ročně" v její jednotce.
2. **Vykazuj běžně** — položku vkládej do faktur z ceníku.
3. **Kontroluj kdykoli** kliknutím na položku: vykázáno, zbývá, a na kterých
   fakturách.

## Na co si dát pozor

- Limit je **roční a jeden na položku**, ne per-klient. Když máš dohody s víc
  klienty zvlášť, založ si na to zvlášť pojmenované položky.
- Limit je v **jednotce položky** — u hodinové sazby tedy v hodinách, ne ve dnech.
- Fakturian je **pro neplátce DPH** a **pro macOS**.
