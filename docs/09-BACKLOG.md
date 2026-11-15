# Fakturian — Backlog

- **UCT-40 · Ruční import ISDOC do cizího programu není doložený — STŘEDNÍ.**
  Vzorky dokladů jsou `samples()` v `desktop/test/invoices.ts` (faktura,
  dobropis, faktura na část ceny, minimální doklad). XSD validita a PDF/A
  kompatibilitu s cizím importérem nedokazují.

    Připravit trvalý balíček čtyř PDF přes skutečné `saveInvoice()` se zachovanými
    čísly a odkazy, vytaženými ISDOC přílohami a očekávanými údaji. PDF/A testy
    jako zdroj balíčku nestačí: první přes `invoiceFiles()` vkládá do všech PDF
    stejný `MINIMAL_ISDOC`, druhý doklady přečíslovává bez změny odkazu dobropisu.
    Balíček ověřit proti XSD a veraPDF a zkontrolovat shodu příloh s doklady.

    Pro práci z Macu nejdřív použít [Money S3 Online](https://money.cz/money-s3-online/).
    Výrobce nabízí [cloudové demo na 25 dní](https://demos3.money.cz/); přístup
    přiděluje obchodní oddělení po vyplnění formuláře. Ověřit, že demo umožňuje
    nahrát vlastní soubory a použít přímo import ISDOC. Náhradní cesta je
    hostovaná Pohoda nebo Windows ve virtuálním stroji na Macu.

    V čisté testovací účetní jednotce nastavit IČO podle směru importu. Importovat
    nejdřív fakturu `20260001` (51 750 Kč), potom dobropis `20260002`
    (snížení o 6 000 Kč, odkaz na `20260001`), fakturu `20260003` (30 000 Kč)
    a minimální doklad `20260005` (51 750 Kč, Petra Nováková, bez účtu).
    Vzorek `backup()` je podle [01-FUNKCE](01-FUNKCE.md#3-faktury) běžná faktura
    na část ceny; očekává se její import jako běžné faktury.
    Po uložení a opětovném otevření ověřit číslo dokladu, částku a její účinek,
    dodavatele i odběratele včetně IČO, měnu CZK, význam neplátce DPH a vazbu
    dobropisu na původní fakturu.

    Program a přesnou verzi, datum, revizi Fakturianu, kontrolní součty vzorků
    a očekávané i skutečné výsledky zapsat do [07-KVALITA](07-KVALITA.md)
    k vydávacím branám; přiložit importní protokol a snímky uložených dokladů.
    UCT-40 uzavřít až po doloženém skutečném importu.

- **NAST-1 · Appka není podepsaná ani notarizovaná a nemá updater — BLOKUJE.**
  `electron-builder.yml` má `hardenedRuntime: true` a entitlements, ale
  `notarize: false`, žádnou podpisovou identitu a žádný `publish`; job `package`
  v `quality.yml` balí s `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`. `electron-updater`
  v `package.json` není. Nepodepsanou appku laik nespustí a bez updateru se
  k uživateli nedostane žádná oprava. Patří sem Developer ID certifikát
  a notarizace v CI, hosting podepsaného buildu s feedem pro updater na vlastní
  doméně a záloha podpisového klíče mimo tento disk. Entitlement
  `automation.apple-events` (`desktop/entitlements.plist`) začne platit až
  s podpisem, takže přílohu mailu přes Mail.app je potřeba ověřit na podepsaném
  buildu. Job `package` podpis balíčku neověřuje; s certifikátem do něj patří
  `codesign --verify` a `spctl`.
