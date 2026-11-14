# Fakturian — Seznam funkcí

Desktopová aplikace pro **kompletní provoz živnostníka**: faktury, náklady
a vykázané dny na jednom místě. Všechno běží **lokálně a offline**,
data jsou obyčejné soubory ve složce, kterou si zvolíš.

> **Pozicování.** Fakturian nesoutěží jednoduchostí — v tom Fakturoid vyhraje.
> Soutěží tím, že jako jediný ukáže **faktury, náklady a odpracované
> dny pohromadě**, bez cloudu a bez účtu. Kdo chce jen vystavit fakturu, ať
> použije cokoli jiného. Fakturian je pro toho, kdo chce vidět, jak na tom
> podnikání je.

Online jsou jen **dvě volitelné funkce**, vždy až na pokyn uživatele:

1. **Dotažení firmy z ARES** podle IČO (vyplnění odběratele).
2. **Synchronizace plateb z banky Fio** (označení zaplacených faktur).

Bez internetu appka normálně funguje, jen tyhle dvě věci nejsou dostupné.
Odeslání e-mailem jen otevře tvůj mailový klient — appka sama nic neposílá.

> **Hlavní princip — funguje jako Obsidian.** Všechna data jsou obyčejné soubory
> ve **složce, kterou si sám zvolíš** („vault"). Appka data nikam neuzamyká ani
> neposílá. **Zálohu a synchronizaci mezi zařízeními řešíš tím, KAM tu složku
> umístíš** — iCloud Drive / Dropbox / Google Drive (sync + offsite záloha),
> Time Machine (historie verzí), Git (verzování), nebo USB. **Proto nikdy
> SQLite** — v momentě, kdy data nejdou otevřít textovým editorem, je Fakturian
> jen další fakturační appka, co má data u sebe.

> **Terminologie:** Ty, kdo fakturu vystavuje, jsi **dodavatel** → tvoje data se
> nastavují v sekci „Vlastní fakturační údaje". Firmy/osoby, kterým fakturuješ,
> jsou **odběratelé** → ty si vedeš v seznamu a dotahuješ z ARESu.

---

## 1. Vlastní fakturační údaje (dodavatel = ty)

Údaje, které jdou na každou fakturu. Uložené v `.fakturian/nastaveni.json`
a editovatelné v Nastavení. Novou fakturu jimi appka předvyplní.

- Jméno / název firmy, adresa (ulice, město, PSČ), IČO
- Zápis do rejstříku nebo evidence (§ 435 OZ)
- DIČ appka nevede: neplátce ho na faktuře uvádět nemusí (§ 29 ZDPH platí jen pro
  daňový doklad) a u fyzické osoby v něm je rodné číslo.
- Text **„Nejsem plátce DPH"** (povinná informace na faktuře neplátce)
- Číslo účtu / IBAN (pro platbu a QR kód)
- Kontaktní e-mail (volitelné)
- **Číslování faktur: vlastní šablona** — výchozí `{RRRR}{NNNN}` → `20260001`.
  Další číslo = nejvyšší v aktuálním roce + 1 (počítají se doklady ležící ve
  `faktury/`; nový rok začíná od `0001`). Jde přepsat u konkrétní faktury.
  Změna šablony uprostřed roku řadu nerestartuje: Nastavení při uložení převede
  další pořadí staré šablony do navázání v novém tvaru (`20260040` → `F2026-041`).
- **Navázání na existující řadu** — kdo přechází z jiného softwaru, zadá
  počáteční číslo a vlastní formát, aby uprostřed roku nepřerušil řadu.
- Výchozí splatnost ve dnech
- **Logo na fakturu** — uložené jako `logo.png` přímo ve vaultu (cestuje
  s daty), sedí v bočním pásu dokladu. Nejlíp vypadá PNG s průhledným pozadím.
- **Jeden vzhled PDF** — boční pás nese logo, kontakt, platební údaje a QR
  platbu; hlavní plocha jen položky a částku. Tlačítko **Náhled** v Nastavení
  vysází ukázkovou fakturu z vlastních údajů bez ukládání. Doklad nese v patce
  odkaz na web appky. Už vystavená PDF se zpětně nepřekreslují.

---

## 2. Odběratelé (zákazníci)

- Seznam odběratelů (název, IČO, město), vyhledávání
- **Přidat / upravit / smazat** odběratele
- **Dotáhnout z ARES** podle IČO — vyplní název, adresu, IČO, DIČ
- Ruční zadání (když firma není v ARESu / fyzická osoba)
- **Povinné údaje:** název, IČO, ulice, město a PSČ. DIČ jen když ho odběratel
  má. **E-mail je nepovinný** (fakturu jde předat i papírem); když vyplněný je,
  musí být platný a použije se pro odeslání faktury.
- Neúplný odběratel se do evidence nedostane: formulář, zadání na faktuře
  i import ho odmítnou a soubor vaultu s ním spadne na kontrole při načtení.
- **Poznámky k odběrateli** — volný text (domluvené sazby, kontakt na účetní).
  Appka s nimi nic nepočítá.

---

## 3. Faktury

### Seznam faktur

- Přehled: číslo, odběratel, datum vystavení, splatnost, částka, stav
- Nečitelný PDF soubor, iCloud zástupce nebo konfliktní kopie se v přehledu
  ukáže červeně se jménem, důvodem a akcí pro zobrazení ve Finderu. Duplicitní
  číslo se do součtů započítá nejvýš jednou; bez jednoznačné verze vůbec, dokud
  uživatel konflikt nerozhodne.
- **Vytvořit** novou fakturu
- **Smazat** fakturu — otázkou ano/ne, z nabídky řádku i z detailu dokladu.
  Otázka jmenuje, co zmizí spolu s dokladem: PDF jde do **Koše macOS** (Finderem
  se dá vrátit) a zapsané platby se odeberou. Číslo se tím uvolní,
  takže po smazání posledního dokladu ho appka vydá znovu a po smazání staršího
  zůstane v řadě díra. Fakturu, ke které existuje dobropis, smazat nejde.
- **Otevřít / upravit** detail faktury. Původní PDF se před přepisem ukládá do
  týdenních záloh. Doklad vystavený jiným softwarem (převzatý nebo
  naimportovaný) přepsat nejde — appka ho odmítne uložit pod původním číslem
  a nabídne uložení jako nový doklad s vlastním číslem.
- **Odeslání e-mailem** fakturu zároveň označí jako odeslanou; označení je
  nevratné. Odeslaný doklad jde dál upravit, ale uložení se nejdřív zeptá —
  odběratel má u sebe původní verzi. Čas a odpovědná osoba jsou součástí
  vloženého ISDOC a úprava je zachová.
- **Duplikovat** — převezme odběratele i položky, přidělí další číslo v řadě
  a nastaví dnešní datum vystavení
- Vyhledávání / filtr (podle odběratele, čísla, roku)
- Stav faktury: _vystaveno_ / _zčásti uhrazeno_ / _zaplaceno_ — klik na stav
  nebo **Zapsat platbu** v nabídce dokladu
  otevře platby dokladu: datum a částka každé úhrady, zbytek k úhradě
  a přeplatek. Zapsat jde i částečnou platbu a platbu s jiným datem než dnes.
- **Zvýraznění po splatnosti**

### Údaje na faktuře

- Číslo faktury — automaticky další v pořadí, jde přepsat
- Odběratel — výběr ze seznamu, nebo zadání přímo na faktuře (i s dotažením
  z ARES), volitelně rovnou uložené do Odběratelů. Údaje vybraného odběratele
  jde na dokladu upravit bez zásahu do evidence.
- Datum vystavení a datum splatnosti (předvyplní se podle výchozí splatnosti).
  U nové faktury se splatnost posouvá s datem vystavení, dokud ji uživatel
  nenastaví sám; u vystavené se nemění.
- **Datum plnění appka nevede** (`UCT-37` v [13-ZNAME-OMEZENI](13-ZNAME-OMEZENI.md)).
  Rok čerpání limitu ceníku se nastavuje zvlášť u hlídaného řádku (sekce 5).
- Položky (sekce 4) a automaticky počítaná celková částka
- **Měna je vždy CZK**, faktura je česky.
- Platební údaje: číslo účtu, variabilní symbol (= číslo faktury)
- Poznámka / text faktury (volitelné)
- Text „Nejsem plátce DPH" automaticky

> **Zálohová faktura** se neřeší jako zvláštní typ dokladu. Zálohu vyfakturuješ
> **normální fakturou** na část částky a doplatek druhou fakturou.

---

## 4. Položky faktury

- **Přidat / odebrat / upravit** položku
- Pole položky: popis, množství, jednotka (ks, hod, …), cena za jednotku
- **Sleva** je obyčejný řádek se zápornou cenou; hlídá se jen, aby součet
  faktury nevyšel záporný (nulová faktura projde)
- **Vložit položku z ceníku** (sekce 5) — předvyplní popis, jednotku a cenu
- Řádek položky, která má **roční limit**, nese v editoru odznáček s její
  ikonkou a nad tabulkou je vidět, kolik z limitu po faktuře zbude
- Řádkový i celkový součet se počítá automaticky; bez DPH

---

## 5. Ceník položek

Ceník opakujících se položek — a zároveň evidence toho, **kde všude je máš
vykázané**.

- Seznam položek: **název, cena za jednotku, jednotka**
- **Přidat / upravit / smazat** položku
- Při tvorbě faktury položku vybereš z ceníku → předvyplní se popis, cena a
  jednotka (množství doplníš ručně)
- **Interní poznámka k položce** — název je ten, co stojí na dokladu; vedle něj
  je nepovinná poznámka (jak tomu říkáš ty sám), která se nikdy nedostane do PDF
  ani do ISDOC.
- **Ikonka z pevného výběru** — položka je pak ve výpisu, v nabídce „Vložit
  z ceníku" i na faktuře poznat na první pohled. Na doklad se nedostane.
- Žádné kategorie, sklad, DPH ani historie cen

### Roční limit položky

**K čemu to je:** u části položek je dohodnuté, kolik se jich smí za rok vykázat
— typicky **dovolená** (fakturuje se jako odpracovaný čas, ale máš dohodnutých
třeba 20 dní ročně), stejně tak paušál na dvanáct měsíců nebo počet školicích
dnů.

- Položka má nepovinné **„maximálně ročně"** v **jednotce položky** — 20 dní
  dovolené po osmi hodinách = `160` u položky s jednotkou „hod". Prázdné =
  položka se nehlídá, jen eviduje; nula neprojde.
- Řádek dokladu se s položkou páruje podle **`itemId`**, který řádek dostane při
  vložení z ceníku (`utils/pricelist.ts`); přejmenování položky vazbu nerozbije.
- Limit se počítá **pro každý rok samostatně**. U hlídaného řádku faktury lze
  změnit „Čerpat z limitu roku"; výchozí je rok vystavení. Na jedné faktuře
  mohou být položky čerpající z různých let. Rok je interní a netiskne se.
- **Překročení limitu = faktura neprojde validací** a nejde uložit.
- **Smazaná faktura množství vrací** — vykázané množství nese archiv dokladů,
  takže s dokladem zmizí i jeho čerpání. Totéž platí pro doklad smazaný mimo
  appku.
- **Dobropis množství vrací, ne přičítá**

### Kde je položka vykázaná

Nabídka řádku „Vykázání a roční limit" otevře vpravo panel: **na kterých
fakturách** položka je a kolik z ní za daný rok odešlo; u hlídané položky
i zbytek do limitu. Ročník se dá přepnout.

> Vazbu „faktura ↔ položka ceníku" i rok, ze kterého řádek čerpá, nese **doklad
> sám** v ISDOC (mapování v [02-TECHNOLOGIE](02-TECHNOLOGIE.md)). Vyčerpané
> množství za rok je součet těchhle řádků, žádný soubor navíc.

---

## 6. Výdaje a přijaté faktury

Každý výdaj je jeden přijatý doklad — faktura od grafika stejně jako měsíční
poplatek za doménu nebo účetní. Výdaje slouží k přehledu, kolik za co platíš;
daňovou evidenci nenahrazují.

- Pole: dodavatel, částka, datum, popis
- **Drag & drop PDF do okna** → výdaj se **vyplní sám** z vložených ISDOC dat;
  originál se uloží do `prijate/` tak, jak přišel
    - **Jen čitelný doklad** s ISDOC a všemi povinnými údaji; ostatní import
      odmítne a nic nezkopíruje (`UCT-38` v
      [13-ZNAME-OMEZENI](13-ZNAME-OMEZENI.md))
    - **Týž doklad podruhé:** bajt po bajtu stejné PDF, které už v `prijate/`
      leží, import odmítne. Doklad, který se s některým výdajem shoduje UUID
      z ISDOC nebo dodavatelem s číslem dokladu, se odmítne jako už zapsaný.
    - **Validace příjemce:** když IČO příjemce v dokladu je a **neshoduje se**
      s tvým, import se odmítne. Když chybí úplně (zahraniční dodavatel, fyzická
      osoba), import projde s varováním.
- Ruční zadání bez dokladu
- **Žádná predikce.** Každý výdaj se v součtech počítá jednou, v měsíci svého
  data. Opakované výdaje appka nezná; každou platbu předplatného zapíšeš jako
  vlastní doklad.

---

## 7. Dobropisy

Doklad, kterým vracíš celou už vystavenou fakturu.

- **Vytvořit dobropis** navázaný na existující fakturu (odkáže se na její číslo)
- **Dobropis vždy vrací celou fakturu a jen jednou** — součet je přesně opačný
  než u faktury. Faktura, která už dobropis má, další nedostane. Dobropis se
  nedá duplikovat. Stejná pravidla platí při importu: cizí dobropis bez své
  faktury nebo na část faktury se přeskočí.
- Vlastní číslo dobropisu ze stejné číselné řady jako faktury
- Položky se zápornou částkou, převzaté z faktury; sleva z původní faktury se
  vrací s opačným znaménkem
- Povinný **důvod opravy** — vysází se na doklad a do ISDOC jako poznámka
- Ukládá se jako **PDF + ISDOC** (v ISDOC opravný doklad). PDF uvádí „Celkem
  k vrácení", nevyzývá k úhradě a nemá platební údaje ani splatnost.
- **Vypořádání:** faktura s dobropisem nic nedluží, ve výpisu má stav
  „Dobropisováno" a nikdy není po splatnosti. Dobropis vrací jen to, co
  odběratel na fakturu zaplatil: bez platby je rovnou „Vypořádáno", jinak
  „K vrácení", dokud se vratka nezapíše jako jeho platba.
- Zrušení faktury, kterou odběratel nedostal, je smazání, ne dobropis.

---

## 8. Přehled

- Vyfakturováno za **tento měsíc** a **tento rok**
- **Zaplaceno vs. nezaplaceno** za letošní rok (částka i počet faktur);
  nezaplacená částka z jiných let stojí pod nimi zvlášť
- Počet faktur **po splatnosti**
- Nezaplacené faktury s rychlým prokliknutím, blížící se splatnosti
- Sloupcový graf „Fakturace za období" (měsíce / kvartály / roky)
- Bilance, top dlužníci a odběratelé
- **Sledování obratu za kalendářní rok** proti dvěma prahům registrace k DPH:
  2 000 000 Kč (plátcem od 1. ledna dalšího roku) a 2 536 500 Kč (plátcem už
  dnem po překročení). Obrat patří do roku **data vystavení** faktury. Po
  překročení karta říká i **datum, od kterého je uživatel plátcem** — i v
  následujícím roce.
- **Upozornění na vadné doklady:** soubor ve `faktury/` nebo `prijate/`, který
  appka nepřečte (třeba nakopírovaný mimo ni), Přehled vyjmenuje i s důvodem.
  Doklad ve `faktury/` musí projít stejnými pravidly jako import (sekce 12)
  a jmenovat se podle svého čísla. Do součtů ani evidence vadný doklad nevstupuje.

---

## 9. Export, tisk a odeslání

- Faktura/dobropis se **ukládá rovnou jako PDF s vloženým ISDOC** — A4 šablona je
  zároveň finální doklad
- **Náhled** — rozepsaná faktura vysázená stejnou šablonou, jakou by ji uložilo
  „Uložit", po stránkách v okně appky. Na disk nezapisuje nic. **Tisk** jde
  z uloženého PDF.
- Šablona obsahuje dodavatele, odběratele, položky, součet, platební údaje, QR kód
- **Odeslat odběrateli** — otevře mailový klient s předvyplněným příjemcem,
  předmětem a textem. Nabídne se i hned po vytvoření faktury.
- **Poslat upomínku** — u faktury po splatnosti otevře mail s textem upomínky
  (číslo faktury, částka, o kolik dní je po splatnosti)

### Jak se PDF dostane do mailu

- **Apple Mail (a Outlook pro Mac):** appka vytvoří rozepsanou zprávu přes
  AppleScript **i s přiloženým PDF**. Při prvním použití vyskočí systémový
  dialog o povolení automatizace.
- **Ostatní klienti:** `mailto:` neumí přiložit soubor, takže appka zároveň
  **ukáže PDF ve Finderu** a uživatel ho do zprávy přetáhne.

---

## 10. QR platba

- QR kód ve formátu **SPAYD** přímo v PDF
- Generuje se z čísla účtu, částky, variabilního symbolu a zprávy
- QR má každá faktura, dobropis žádný
- Účet musí projít kontrolou (mod-11 u českého čísla, kontrolní součet u IBANu).
  Když neprojde, QR se nevysází; u importovaného dokladu to řekne výsledek
  importu.

---

## 11. Synchronizace plateb z banky — Fio

- Zadání **osobního API tokenu Fio** v Integracích (doporučeno read-only)
- Tlačítko **„Synchronizovat platby"** stáhne nové transakce
- **Párování plateb na faktury** podle variabilního symbolu (= číslo faktury);
  částka rozhoduje jen mezi doklady se stejným symbolem
- Při shodě se k faktuře zapíše platba se **skutečnou částkou a datem** —
  částečná platba nechá fakturu zčásti uhrazenou, přeplatek se ukáže u částky
- Pohyb, který už je zapsaný, se podle ID z Fia nezapíše znovu; uhrazená faktura
  další platbu nedostane
- Další dotaz do 30 s appka do banky nepustí (limit Fio) a řekne, kolik zbývá
- Výsledek synchronizace: počet spárovaných a nespárovaných plateb
- Token uložen v macOS Keychain, ne v souboru
- Bez internetu / bez tokenu funkce není dostupná, zbytek appky jede dál

---

## 12. Import z jiného softwaru

Kdo už fakturuje jinde, musí mít jak nastoupit.

- **Import PDF s vloženým ISDOC** z Fakturoidu, iDokladu a dalších → naplní
  historii faktur i seznam odběratelů. Holé ISDOC XML appka nebere: PDF by
  musela sázet sama a klient by měl u sebe jiný doklad, než jaký leží ve
  `faktury/`.
- Navázání na **existující číselnou řadu** (sekce 1)
- Bere se faktura a dobropis. Vrubopis, zálohové a zjednodušené doklady a doklad
  bez odběratele se přeskočí s důvodem.
- **Čísla se čtou přesně podle ISDOC.** Desetinná čárka nebo mezera v čísle
  doklad odmítne, protože „1,250" jde číst jako 1,25 i jako 1 250. Odmítne ho
  i částka nad 90 miliard Kč, nečitelné zaokrouhlení a řádek, jehož množství
  krát jednotková cena nedává jeho částku.
- Faktura se záporným součtem, dobropis s kladným a dobropis bez odkazu na
  opravovanou fakturu se nevezmou.
- **Odběratel z dokladu se založí jen úplný** — musí projít stejnou kontrolou
  jako ručně zadaný (jméno, IČO, adresa; e-mail, pokud je vyplněný). Neúplného
  appka nezaloží a vyjmenuje ho v upozornění i s tím, co mu chybí. Faktura se
  naimportuje i tak; odběratele pak doplníš ručně.

### Převzetí složky

Druhá cesta dovnitř: **otevřít složku, kde doklady už leží**, a nechat appku, ať
si z nich vault poskládá sama. Export z jiného softwaru je pojmenovaný jinak
(„Vydaná faktura - 2026017.pdf") a leží jinde než ve `faktury/`.

- Appka složku **projde** (i podsložky) a nabídne, co v ní vypadá jako tvoje
  vydané faktury. Sken sám nic nemění.
- Převzetím se soubory **přesunou** do `faktury/` pod svým číslem. Nic se
  nepřesazuje: zůstává to PDF, které klient dostal.
- **`.fakturian/nastaveni.json` být ve složce nemusí** — appka si ho vyrobí
  z dokladů: odběratele, a když ještě žádné vlastní údaje nemá, i dodavatele,
  splatnost a tvar číselné řady. Vlastní nastavení nikdy nepřepisuje.
- Platí stejná pravidla jako u importu; doklad plátce DPH se nebere a **přijatá**
  faktura patří do Výdajů. Co se nevzalo, se vypíše i s důvodem — i nečitelná
  podsložka a doklad, který už ve vaultu je.
- Nabízí se v průvodci výběrem složky, na Přehledu a v přehledu faktur.

---

## 13. Datová složka („vault") a zálohování

```
Vault/
  faktury/            2026001.pdf (PDF+ISDOC)
  prijate/            přijaté doklady (PDF tak, jak přišly)
  logo.png
  .fakturian/
    nastaveni.json    dodavatel, kontakty, ceník
    vydaje.json  platby.json
    snapshots/        týdenní zálohy
    cache/            index.json (zahoditelná cache)
```

- Soubory jsou **rozdělené podle frekvence zápisu**: konfigurace se mění zřídka,
  platby a výdaje při každé akci. Konflikt v cloudu tak vezme jednu doménu,
  ne všechno.
- **Index je jen cache** — jde kdykoli smazat a přegenerovat. Nikdy není zdrojem
  pravdy.
- **Týdenní zálohy** — před první změnou datového souboru nebo PDF faktury
  v každém týdnu se uloží jeho předchozí stav; zálohy se drží pět týdnů. Jméno
  nese datum v UTC (`platby.2026-09-14.json`). **Obnova je ruční** — uživatel
  kopii přetáhne zpátky do `.fakturian/`; Nastavení → Zálohy jen ukáže složku
  ve Finderu.
- Atomický zápis (temp + rename)
- Při prvním spuštění appka nabídne **zvolit / vytvořit datovou složku**
  (výchozí návrh `~/Documents/Fakturian`)
- Složku jde **kdykoli změnit** v Nastavení; přesouvá se ve Finderu — appka data
  nestěhuje
- Tlačítko **„Otevřít datovou složku ve Finderu"**
- **Otevřít jde libovolná složka, i plná cizích dat** — doklady mimo `faktury/`
  si appka nabídne převzít (sekce 12).
- Faktury jsou **samonosné PDF** — otevřeš je čímkoli
- **Žádný cloud ani přihlašování**
- Smazaná faktura jde do Koše macOS → vrátí ji Finder

### Záloha a synchronizace = umístění složky

Cloudové zástupce a konfliktní kopie appka rozpozná. Zástupce PDF dál rezervuje
číslo dokladu; u konfliktního PDF zastaví nejednoznačné započtení a u
konfliktního JSONu čtení i zápis, dokud uživatel verze nerozhodne ve Finderu.

**Cizí změnu appka nepřepíše.** Když soubor od načtení změnil jiný Mac přes
cloud nebo druhé okno Fakturianu, zápis se odmítne a appka nabídne, že se
načte znovu z disku; neuložené změny se tím ztratí. Vault v cloudu je proto
lepší používat v jednu chvíli z jednoho stroje.

---

## 14. Claude connector (MCP)

Fakturian vystavuje **MCP server**: AI agent umí číst faktury, odběratele,
výdaje a ceník a vystavit fakturu, kterou potvrdíš v okně appky.
Funguje jen s otevřeným Fakturianem. Podrobnosti v [06-MCP](06-MCP.md).

---

## 15. Produkt a distribuce

- **Jen macOS.** Polish je hlavní odlišení a dělat ho pro dva systémy najednou
  znamená nedodělat ani jeden. Windows verze se nedělá (viz „Mimo rozsah").
- Obchodní model je **source available**, licence **FSL-1.1-MIT**: appku smí
  každý sestavit a používat, nesmí ji prodávat jako konkurenční produkt; každá
  verze po dvou letech přechází na MIT.
- Veřejný build musí být **podepsaný a notarizovaný**; způsob aktualizace není
  rozhodnutý.
- Navigace: Přehled; skupina Doklady (Faktury, Výdaje); skupina Evidence
  (Odběratelé, Ceník); dole Integrace a Nastavení.

---

## Mimo rozsah (vědomě neřešíme)

Vědomá rozhodnutí, ne opomenutí. Nevracet se k nim.

| Co                                                   | Proč ne                                                                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| DPH a plátcovství                                    | Fakturian je pro neplátce; limit hlídá právě proto, aby uživatele přechod nepřekvapil                          |
| Cizí měny a cizojazyčné faktury                      | Doklad je v korunách a česky                                                                                   |
| Zálohové a proforma faktury                          | Řeší se postupnou fakturací (sekce 3)                                                                          |
| Cenové nabídky jako doklad                           | —                                                                                                              |
| Generátor smluv                                      | Zbytečná komplikace                                                                                            |
| Vlastní měření času                                  | Hodiny se zadávají jako běžná položka, sazby jsou v ceníku                                                     |
| Čtení schránky přes IMAP                             | Trvalý provozní závazek (tokeny, expirace, změny politik); přijaté doklady se řeší drag & dropem               |
| Odesílání e-mailů z appky (SMTP, Google)             | Appka jen otevře mailový klient                                                                                |
| Jiné banky než Fio, import výpisů (CSV/GPC/camt.053) | —                                                                                                              |
| Automatická synchronizace na pozadí                  | Jen ručně na tlačítko                                                                                          |
| Automatické upomínky                                 | Upomínka se posílá na tlačítko; appka sama nikdy nic neodešle                                                  |
| Vlastní cloudový sync                                | Řeší se tím, kam si dáš vault; vlastní cloud by popřel hlavní argument produktu                                |
| SQLite nebo binární databáze                         | Data musí jít otevřít textovým editorem                                                                        |
| Sdílení a více uživatelů nad jednou složkou          | Souběžné zápisy do téhož JSONu se odmítají jako konflikt                                                       |
| Windows verze                                        | Druhý systém znamená druhou větev vzhledu, klíčenky, podpisu a MCP (unixový socket); kód Windows nikde nehlídá |
| Mobilní verze                                        | Vault na iOS je jiný problém než appka                                                                         |
| Osobní finance a investice                           | Jiná appka                                                                                                     |
| Dýško jako funkce                                    | Dýško je další položka na faktuře                                                                              |
| Úprava převzatých cizích dokladů                     | Zápis by musel zachovat celý cizí ISDOC; převzatý doklad se jen čte (`foreign_document` v `save_invoice`)      |
