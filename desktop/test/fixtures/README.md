# Vzorová data pro testy backendu

## Oficiální vzorky ISDOC

| soubor           | původ                                                                        | licence    |
| ---------------- | ---------------------------------------------------------------------------- | ---------- |
| `example1.isdoc` | [isdoc/isdoc2ubl](https://github.com/isdoc/isdoc2ubl), `test/example1.isdoc` | Apache-2.0 |
| `example2.isdoc` | tamtéž, `test/example2.isdoc`                                                | Apache-2.0 |

Jsou to „kitchen sink" doklady od tvůrců standardu: plátce DPH, tři sazby, cizí měna, přijaté zálohy,
`Extensions`, `OrderReferences`, `SupplementsList` a u dvojky navíc eGovernment hlavička. Deklarují
verzi 6.0.1, jmenný prostor mají společný s 6.0.2. Appka je naimportovat neumí (plátce DPH, zálohy);
smysl vzorků je v tom, že projdou čtením bez ztráty a bez vymyšlených čísel.

## Cílené regresní vzorky

Ručně psané cizí doklady, každý na jeden nález:

| soubor                   | co hlídá                                                    |
| ------------------------ | ----------------------------------------------------------- |
| `foreign-document.isdoc` | cizí doklad bez `IssuingSystem` s adresou a e-mailem        |
| `bez-mnozstvi.isdoc`     | řádek bez `InvoicedQuantity` (`minOccurs="0"`)              |
| `bez-castky.isdoc`       | chybějící povinný `LineExtensionAmount` → doklad se odmítne |
| `zaokrouhleni.isdoc`     | `PayableRoundingAmount` → součet sedí s papírem             |
| `zalohova.isdoc`         | `DocumentType` 4 nepatří mezi vydané faktury                |
| `two-payments.isdoc`     | účet se bere z platby převodem, ne z první v pořadí         |

`bez-castky.isdoc` schválně neprojde XSD. Ostatní vzorky XSD projdou:

```sh
xmllint --noout --schema desktop/isdoc/isdoc-invoice-6.0.2.xsd desktop/test/fixtures/*.isdoc
```

`sample-invoice.isdoc` je naopak vlastní výstup: přesně tenhle ISDOC musí zapsat `buildIsdoc`
pro `sampleInvoice()` z `desktop/test/invoices.ts`.

## `adopt/` — složka k převzetí

Tři smyšlené faktury, které se tváří jako vystavené cizím softwarem: `IssuingSystem` „Testovací
fakturační systém 1.0“, jeho pojmenování souborů („Vydaná faktura - 2026017.pdf“) a sedmimístná řada.
Na nich stojí celý průchod převzetí (`adopt-folder.test.ts`) proti sdílenému kontraktu
`src/utils/fixtures/adopt-folder.json`, který čte i vitest.

Vizuál vysázela appka, vložený ISDOC je ručně psané cizí XML beze změny: dodavatel s IČO 12345679,
dva odběratelé a bankovní spojení ze vzorového účtu ČNB, hodnoty jako v kontraktu. Nový vzorek se
vyrobí stejně — ISDOC napsaný ručně, ne přes `buildIsdoc` (ten by doklad podepsal jako Fakturian),
vložený přes `replaceIsdoc` do PDF vysázeného appkou. Test „vzorky jsou cizí a smyšlené“ hlídá
`IssuingSystem` a IČO dodavatele proti kontraktu.

## Skutečný doklad sem nepatří

Žádný soubor v této složce nesmí obsahovat data existující osoby nebo firmy, ani vlastní. Testovací
hodnota je v tvaru dat, ne v tom, čí jsou: IČO se vymýšlí platné na mod-11, bankovní spojení se bere
z dokumentovaného vzorového účtu ČNB (`19-2000145399/0800`) a domény se píšou na `.example`.
