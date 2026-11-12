---
kind: use-case
eyebrow: Pro programátory na volné noze
title: Fakturace pro vývojáře, který si účtuje hodiny
description: Sazby jako položky ceníku, desetinné hodiny a doklad s ISDOC a QR platbou. Data jsou obyčejné soubory ve složce, kterou si zvolíš.
lede: Účtovat hodiny neznamená vést tabulku. Sazba je položka ceníku, množství desetinné číslo a z faktury vzniká doklad, který si účetní naimportuje strojově.
shot: usecase-programatory
shotAlt: Formulář faktury s položkami po hodinách a sazbou z ceníku
faq:
    - q: Umí Fakturian stáhnout hodiny z trackeru?
      a: Ne a neplánuje se to. Fakturian čas neměří ani nestahuje — hodiny zadáš jako běžnou položku a sazbu vezmeš z ceníku jedním kliknutím.
    - q: Umí to půlhodiny a čtvrthodiny?
      a: Ano, množství je desetinné číslo. 4,5 hodiny je běžná položka.
    - q: Jak se řeší různé sazby pro různé klienty?
      a: Sazba je položka ceníku, takže si jich můžeš mít víc — vývoj, konzultace, code review. Dohodnutou sazbu klienta si navíc připíšeš do poznámky u odběratele, kde ti zůstane před očima.
    - q: Můžu si vault verzovat gitem?
      a: Ano. Data jsou JSON soubory a PDF ve složce, kterou si zvolíš — nic z toho není databáze. Vault používej v jednu chvíli z jednoho počítače.
    - q: Jde faktura opravit, když klient něco reklamuje?
      a: Ano, vystavenou fakturu prostě upravíš a uloží se znovu. Když už je zaplacená a vracíš část peněz, vystavíš dobropis navázaný na její číslo.
related:
    - /pro/konzultanty
    - /reseni/ai-agent
---

## Co je na tom dnes otravné

Hodiny máš v trackeru, sazby v hlavě nebo v e-mailu, faktury v cloudové službě.
Na konci měsíce je z toho pravidelný rituál: sečíst odpracované po projektech,
přepsat do fakturačního webu, zkontrolovat, jestli se někde neztratil půlden.

Přepisování je nejen zdlouhavé, ale i jediné místo, kde vzniká chyba, kterou pak
řešíš s klientem — a vždycky ve svůj neprospěch, protože chybějící hodinu si
nikdo nevšimne, přebývající ano.

## Jak to řeší Fakturian

### Ceník místo pamatování sazeb

Sazby si založíš jako položky: vývoj, konzultace, code review, měsíční údržba.
U každé je jednotka a cena. Do faktury je vkládáš jedním kliknutím a doplníš jen
množství — to je desetinné, takže půlhodiny a čtvrthodiny nejsou problém.

Ceník má i **interní poznámku**, která se nikdy nedostane na doklad ani do
ISDOC — hodí se, když se položka na faktuře musí jmenovat jinak, než jak jí
říkáš ty.

### Agent nad vlastními daty

Fakturian umí být zdrojem dat pro AI agenta přes MCP: zeptáš se normální větou
a odpověď vznikne z tvých faktur. Server běží u tebe a mluví s otevřenou appkou
přes lokální socket — nikam se nic neodesílá.

### Faktura je hotový doklad

Uložením vznikne PDF s vloženým ISDOC a QR platbou. Účetní si ho naimportuje
strojově, klient naskenuje QR kód a zaplatí. Variabilní symbol je číslo faktury,
takže se platba spáruje z Fia sama.

## Jak začít

1. **Zvol složku pro data** — třeba `~/Documents/Fakturian` nebo rovnou složku
   v iCloudu, ať máš faktury i na druhém stroji.
2. **Vyplň své údaje a ceník** — jméno, IČO, účet, formát čísla faktury a sazby,
   které používáš.
3. **Vystav první fakturu** — odběratele dotáhneš z ARESu podle IČO, položky
   vložíš z ceníku, doklad uložíš.

## Na co si dát pozor

- Fakturian je **pro neplátce DPH**. Jakmile se staneš plátcem, tahle appka
  přestane stačit.
- **Sám čas neměří** a měřit nebude. Trackery to dělají líp; Fakturian řeší, co
  se s hodinami stane potom.
- Je **jen pro macOS** a **jen pro jeden počítač v jednu chvíli** — vault
  v cloudové složce používej střídavě, ne současně ze dvou strojů.
