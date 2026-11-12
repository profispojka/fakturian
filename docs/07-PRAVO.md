# Fakturian — právní opora

Podklad pro účetní a daňová pravidla appky a pro položky `UCT` v
[05-BACKLOG](05-BACKLOG.md) a [13-ZNAME-OMEZENI](13-ZNAME-OMEZENI.md). Ověřeno
proti úplným zněním předpisů (ZDP účinný 1. 8.–31. 12. 2026, ZDPH od 1. 1. 2026,
ZoÚ ve znění novely č. 316/2025 Sb.), materiálům Finanční správy, Pokynu GFŘ
D-59 a specifikacím ČBA a ISDOC.

**Na koho co dopadá.** § 11 ZoÚ zavazuje pouze účetní jednotky. Podnikající
fyzická osoba se jí stává až nad obratem 25 000 000 Kč, takže OSVČ v daňové
evidenci — hlavní cílová skupina — účetní jednotkou není; platí pro ni § 435 OZ,
§ 31 odst. 14 živnostenského zákona a důkazní břemeno podle § 92 daňového řádu.
Příjemce faktury ale účetní jednotkou často je a bez data uskutečnění plnění
doklad nezaúčtuje — proč ho Fakturian přesto nevede, je v `UCT-37`. Nový zákon
o účetnictví účinný není (sněmovní tisk 63, účinnost nejdřív 2027, návrh počítá
s 2028) — platí zákon č. 563/1991 Sb.

| Téma                          | Co platí                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Limit plátcovství DPH         | Obrat za **kalendářní rok**, dva prahy: 2 000 000 Kč → plátce od 1. 1. následujícího roku; ekvivalent 100 000 € ≈ 2 536 500 Kč → plátce den po překročení. Přihláška do 10 pracovních dnů. Zák. č. 461/2024 Sb., účinnost 1. 1. 2025                                                                                                                                   |
| Sazby DPH                     | 21 % a 12 % (§ 47 odst. 1 ZDPH), plus nulová sazba u knih (§ 71i). Číselník musí být datovaný — u starších dokladů se objeví 15 % a 10 %                                                                                                                                                                                                                               |
| Opravy dokladů                | Musí jít určit osobu odpovědnou za opravu, okamžik provedení a obsah **před i po** (§ 35 odst. 3 ZoÚ); opravy nesmějí vést k neprůkaznosti (§ 35 odst. 1). Sankce § 37a ZoÚ až 3 % hodnoty aktiv, § 98 DŘ pomůcky, v krajním případě § 254 TZ                                                                                                                          |
| Ochrana záznamů               | Preventivní ochrana proti ztrátě a změně § 33 odst. 9 ZoÚ; § 35 odst. 6 ukládá až následné obnovení průkaznosti. Čitelnost § 33 odst. 7 + § 35 odst. 5 ZoÚ. Daňové doklady § 34 odst. 1 ZDPH                                                                                                                                                                           |
| Archivace                     | 5 let účetní doklady a knihy (§ 31 odst. 2 písm. b, c ZoÚ), **10 let** účetní závěrka a výroční zpráva (písm. a), 10 let daňové doklady (§ 35 odst. 2 ZDPH). Pro plátce se kumulují → fakticky 10 let                                                                                                                                                                  |
| Číselná řada                  | Zákon nevyžaduje nepřerušenou řadu, ale **jednoznačné a nezaměnitelné označení** (§ 11 odst. 1 písm. a) ZoÚ) a evidenční číslo daňového dokladu (§ 29 odst. 1 písm. e) ZDPH). Duplicita je tvrdá vada, mezera je důkazní riziko                                                                                                                                        |
| Zápis do rejstříku na dokladu | § 435 odst. 1 OZ. Sankce § 9 odst. 2 písm. a) zák. č. 251/2016 Sb., pokuta do 100 000 Kč. Živnostenský rejstřík je veřejný **seznam**, ne veřejný rejstřík → OSVČ uvádí údaj o zápisu do jiné evidence („Zapsáno v živnostenském rejstříku"), s. r. o. soud, oddíl a vložku                                                                                            |
| Identifikovaná osoba          | Rozhodné je **§ 6h ZDPH** a pojem „osoba neusazená v tuzemsku" → týká se i dodavatelů mimo EU (§ 108 odst. 3). Registrace do 15 dnů (§ 97), přiznání jen když vznikla povinnost přiznat daň (§ 101 odst. 5). **Souhrnné hlášení se při nákupu nepodává** (§ 102 odst. 3 ho váže na poskytnutí služby). Žádný minimální limit; status je slučitelný s paušálním režimem |
| Zálohy                        | Přijatá záloha je příjmem podle ZDP ihned při úhradě, ale do obratu pro DPH vstupuje až uskutečněním plnění (§ 4a odst. 1)                                                                                                                                                                                                                                             |
| PDF/A                         | Zákonná povinnost archivovat v PDF/A **neexistuje** — předpisy žádají výsledek (neměnnost, čitelnost, věrohodnost), ne formát. PDF/A-3a vyžaduje sama specifikace ISDOC                                                                                                                                                                                                |
| SPAYD                         | Hodnoty v ISO-8859-1 (`á é í ó ú ý` projdou, `ř ě š č ž ů` ne), hvězdička se escapuje jako `%2A`. VS je jedno- až desetimístné číslo. Validátor ČBA nekontroluje mod-97 IBANu — vlastní kontrola je nutná                                                                                                                                                              |
| ISDOC                         | 6.0.2 je aktuální verze (23. 3. 2022), spravuje DIA. **Není to syntaxe EN 16931.** Směrnice ViDA (EU) 2025/516 zavádí od 1. 7. 2030 povinnou přeshraniční e-fakturaci podle EN 16931, takže datový model má umožnit i UBL 2.1 / UN-CEFACT CII                                                                                                                          |

**Na účetní zůstává:** jak přesně formulovat údaj o zápisu do evidence pro
konkrétní právní formu a rozsah povinností identifikované osoby při pravidelném
nákupu zahraničních služeb. Pokyn GFŘ D-59 je z prosince 2022 a novely
2024–2026 nereflektuje — u novějších institutů se o něj neopírat.
