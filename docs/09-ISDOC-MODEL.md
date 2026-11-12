# Fakturian — model dokladu a ISDOC

## Rozhodnutí

ISDOC je zdroj strojových dat faktury. Formulář nad ním používá menší model
`Invoice`, který obsahuje jen údaje podporované aplikací. Plné schéma se do
frontendu neposílá.

| Vrstva               | Typ               | Umístění                                                    | Role                                   |
| -------------------- | ----------------- | ----------------------------------------------------------- | -------------------------------------- |
| Plný ISDOC 6.0.2     | XML `Document`    | `desktop/isdoc/mod.ts` (`parse`), `isdoc-invoice-6.0.2.xsd` | výměnný formát ověřený proti XSD       |
| Projekce do appky    | `intoInvoice()`   | `desktop/isdoc/projection.ts`                               | čtení podporovaných polí               |
| Zápis vlastního      | `buildIsdoc()`    | `desktop/invoice/isdoc.ts`                                  | sestavení ISDOC z podporovaného modelu |
| Editační model       | `Invoice`         | `desktop/invoice/model.ts`, `src/schemas/invoices.ts`       | formulář a IPC                         |
| Formulářová validace | `invoiceSchema()` | `src/schemas/invoices.ts`                                   | pravidla podporovaného dokladu         |

Plný doklad nemá vlastní typový model: `parse` ho přečte do DOM (`@xmldom/xmldom`)
až poté, co projde celým vendorovaným XSD (`xmllint-wasm` ve workeru
`desktop/isdoc/validator.ts`), a projekce pak věří povinným prvkům, číselníkům
i zápisu částek a dat. Round-trip a XSD validitu ověřují testy
v `desktop/test/isdoc/`. Typy IPC jsou v `src/bindings.ts`; argumenty příkazů
ověřuje hlavní proces (`invoiceArgument` v `desktop/invoice/model.ts`)
a hodnoty přijaté z cizího dokladu navíc kontroluje zod na frontendu.

## Čtení a zápis

```text
PDF → vložený ISDOC → parse → plný model → projekce → Invoice → formulář
Invoice → ISDOC model → XML → vložení do nového PDF
```

Doklad vystavený Fakturianem se při uložení znovu sestaví z podporovaného
modelu. Doklad z cizího softwaru se nepřepisuje:

- importované PDF se kopíruje beze změny (holé `.isdoc` import nebere);
- pokus o uložení cizího PDF pod jeho číslem odmítne `save_invoice` podle
  `IssuingSystem` (`saveInvoice` v `desktop/invoice/mod.ts`, porovnání
  s `ISSUING_SYSTEM`); doklad bez něj je cizí.

Tím je ztrátová projekce omezená na vlastní doklady, které nepodporovaná pole
nevytvářejí.

## Hranice podporovaného modelu

Appka spravuje číslo a typ dokladu, UUID, data, dodavatele, odběratele,
platební údaje, poznámku a řádky. Doklady jsou vždy v korunách —
`LocalCurrencyCode` odchází jako `CZK`. Doklad s jinou tuzemskou měnou se
**odmítne** už při čtení; doklad s vyplněným `ForeignCurrencyCode` jiným než
CZK projde čtením (korunové částky jsou jen přepočet), ale import ho odmítne.

Vlastní doklady nesou v `Extensions` ve jmenném prostoru
`https://fakturian.app/isdoc/extensions/1` (`EXTENSION_NAMESPACE` v
`desktop/isdoc/mod.ts`) dva údaje, pro které ISDOC nemá standardní pole:
na hlavičce `SentAt` a `SentBy` (odeslání), na řádku `UsageYear` (rok čerpání
ročního limitu ceníku). Z cizího dokladu se `SellersItemIdentification`
a řádkové `Extensions` nečtou — cizí katalogové číslo v našem ceníku nic
neznamená.

Stav zaplacení žije v JSON souboru ve vaultu (`platby.json`). Čerpání ceníku
žádný soubor nemá: počítá se z řádků archivu (vazba na položku + `UsageYear`).

Model záměrně nenese objednávky, dodací listy, více platebních prostředků,
eGov údaje, podpisy ani plný daňový model. Fakturian je určený pro neplátce
DPH; daňové součty vlastních dokladů jsou nulové.

Při rozšíření podporovaného dokladu platí:

1. Standardní účetní údaj patří do ISDOC a do projekce.
2. Údaj dokladu, pro který ISDOC standardní pole nemá, patří do `Extensions`
   ve jmenném prostoru Fakturianu.
3. Interní vazba aplikace, která není vlastností dokladu, patří do příslušného
   JSON souboru ve vaultu.
4. Nové pole musí projít čtením, editací, zápisem a XSD kontrolou v testech
   hlavního procesu i frontendu.
5. Cizí doklady se needitují (kontrola `IssuingSystem` v `saveInvoice`), viz „Mimo
   rozsah" v [01-FUNKCE](01-FUNKCE.md).
