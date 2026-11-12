---
kind: use-case
eyebrow: Pracuju bez internetu
title: Vystavíš fakturu i tam, kde není signál
description: Fakturian běží celý na tvém počítači. Bez internetu funguje všechno kromě dvou volitelných funkcí — ARES a Fio.
lede: V dílně, na chatě, v letadle nebo prostě v den, kdy vypadne připojení. Fakturace je práce, která nemá čekat na síť.
shot: usecase-offline
shotAlt: Stránka Integrace se dvěma volitelnými online funkcemi
faq:
    - q: Co všechno funguje bez internetu?
      a: Vystavení a uložení faktury i dobropisu, PDF s ISDOC, QR platba, ceník s ročními limity, odběratelé, výdaje, přehled i zálohy. Tedy prakticky celá appka.
    - q: Co bez internetu nejde?
      a: Dotažení firmy z ARESu podle IČO a stažení plateb z Fia. Tlačítka se buď nenabídnou, nebo řeknou, že integrace není dostupná — zbytek appky jede dál.
    - q: Musím být online při prvním spuštění?
      a: Ne. Není co aktivovat, žádný účet ani licenční klíč se neověřuje.
    - q: Jak pošlu fakturu, když jsem offline?
      a: Appka připraví zprávu v tvém mailovém klientovi i s přílohou. Odejde, jakmile budeš zase online — o odesílání se stará klient, ne Fakturian.
    - q: A co zálohy, když je vault v iCloudu?
      a: Soubory se synchronizují, jakmile se připojíš. Do té doby máš data lokálně a appka mezitím drží rotující snímky.
related:
    - /reseni/bez-cloudu
    - /pro/remeslniky
---

## Co je na tom dnes otravné

Webová fakturace je bez připojení mrtvá. Někdy to nevadí, ale zrovna když
potřebuješ vystavit doklad na místě — po dokončené zakázce u zákazníka, na
akci, ve vlaku — se z drobnosti stane „udělám to večer" a večer se na to
zapomene.

Druhý případ je horší: připojení je, ale služba má výpadek. Pak nemáš přístup
ani k historii vlastních faktur.

## Jak to řeší Fakturian

### Všechno počítá tvůj počítač

Doklad se skládá lokálně, PDF se renderuje lokálně, ISDOC se do něj vkládá
lokálně a ukládá se na tvůj disk. Žádný krok procesu nevede přes server.

### Historie je vždycky po ruce

Faktury jsou soubory ve složce. I kdyby appka zrovna nešla spustit, doklady si
otevřeš v Náhledu jako jakékoli jiné PDF. Nezáleží na síti ani na tom, jestli
někdo někde platí předplatné.

### Online funkce jsou dvě a jsou dobrovolné

Když internet není, appka to pozná a chová se podle toho: tlačítka pro ARES
a Fio se nenabízejí nebo jasně řeknou, že integrace není dostupná. Nikde
se neobjeví hláška, která by blokovala práci.

### Odeslání řeší tvůj mailový klient

Fakturian sám e-maily neposílá. Připraví zprávu i s PDF v Apple Mailu nebo
Outlooku (u ostatních klientů přes `mailto:` a odhalení souboru ve Finderu)
a odeslání proběhne, až budeš online.

## Jak začít

1. **Nastav appku, dokud jsi online** — hlavně údaje dodavatele a ceník
   (ARES ti je pomůže vyplnit).
2. **Odběratele si založ dopředu**, pokud víš, že budeš fakturovat v terénu.
3. **Fakturuj offline**; platby si spáruješ z Fia, až se připojíš.

## Na co si dát pozor

- Bez internetu **nedotáhneš novou firmu z ARESu** — údaje zadáš ručně
  a případně je později opravíš.
- Synchronizace vaultu (iCloud, Dropbox) proběhne až po připojení. Do té doby
  na druhém stroji nová faktura není.
- Appka je **pro neplátce DPH** a běží **na macOS**.
