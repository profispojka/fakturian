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

- **UCT-42 · Faktura může vyjít bez zápisu do rejstříku nebo evidence — BLOKUJE.**
  `supplierSchema` a `supplierReadyForInvoicing` (`src/schemas/suppliers.ts`) zápis nevyžadují,
  povinný je jen v `supplierSettingsSchema`. Krok dodavatele v `components/vault/Wizard.vue` pole
  nemá a `fillSupplier` (`useAdopt.ts`) uloží dodavatele z převzatých dokladů bez něj. Když ARES
  neodpoví, u s. r. o. vždy (`parseAres` vrací `''`) a u převzetí složky průvodce skončí
  „můžeš fakturovat" a `#opt(inv.supplier.registration)` v `desktop/templates/invoice.typ` řádek
  vynechá. Faktura pak postrádá údaj podle § 435 OZ (`docs/05-PRAVO.md`). Zápis patří do
  `supplierSchema`, pole do průvodce.

- **DATA-26 · Vadný nebo konfliktní datový soubor zastaví celou appku bez cesty k němu — VYSOKÁ.**
  `start` a `startErrorMessage` v `src/app.vue`, `useVaultData.load`, `checkSyncVariants`
  (`desktop/store.ts`). Konfliktní kopie `vydaje 2.json` od synchronizace nebo poškozený JSON
  ukáže místo appky jen `UError` s „Zkusit znovu" a „Vybrat jinou složku…". Hláška posílá do
  `.fakturian/` a `.fakturian/snapshots`, které Finder skrývá, a tlačítko na ně obrazovka nemá.
  Nápověda (`showcase/content/napoveda/datova-slozka.md`) přitom slibuje, že ostatní části appky
  fungují dál. Přidat „Ukázat ve Finderu" (`revealPath`) a srovnat text nápovědy.

- **UI-43 · Neúspěšné otevření faktury nechá ve formuláři předchozí — STŘEDNÍ.**
  `openFromRoute` v `src/pages/invoice/[id].vue`: když `load` dokladu B selže (PDF mezitím
  zmizelo nebo se přejmenovalo), zůstane formulář s dokladem A i se změnami, které uživatel právě
  zahodil, adresa ukazuje B. „Uložit" zapíše A, „Smazat" míří na B. Při selhání formulář vyprázdnit
  a ukázat stav „doklad nejde otevřít" (`missing`).

- **TEST-23 · Hlídání limitu obratu nemá pokryté tři větve — STŘEDNÍ.**
  `saveInvoice` (`desktop/invoice/mod.ts`): `crossed.add(year)` u roku, který už limit překročil
  (doklady nakopírované mimo appku), chyba „obrat v předchozím roce překročil" a větev
  `parseIsdocDate(date) === undefined`, na kterou se přes `summarySchema` v
  `desktop/invoice/index.ts` nedá dojít. Práh 100 % pokrytí na soubor proto neprojde
  (`bun run test -- --coverage`).

- **LOG-42 · Pád stránky nebo hlavního procesu uživatel nevidí — NÍZKÁ.**
  `desktop/main.ts` (`uncaughtException`, `unhandledRejection`) chybu jen zaloguje,
  `render-process-gone` v `desktop/window.ts` nechá prázdné okno bez obnovy. Log
  `~/Library/Logs/com.fakturian.desktop/Fakturian.log` zmiňuje jen `PRIVACY.md`, z appky na něj
  cesta nevede. Spadlou stránku načíst znovu a do nabídky Nápověda dát „Ukázat log".

- **UCT-45 · Výdaj z dokladu se zaokrouhlením nese částku bez něj — NÍZKÁ.**
  `readReceived` (`desktop/received.ts`) bere `TaxInclusiveAmount`, ne `PayableAmount`
  s `PayableRoundingAmount`. Doklad 999,63 Kč zaokrouhlený na 1 000 Kč se zapíše jako 999,63 Kč;
  tentýž doklad importovaný mezi faktury (`intoInvoice`) vyjde na 1 000 Kč. Fixture
  `desktop/test/fixtures/zaokrouhleni.isdoc` na částku výdaje žádný test nekontroluje.

- **UI-46 · Průvodce při převzetí nepoužije zadané IČO — NÍZKÁ.**
  `afterVaultPicked` (`components/vault/Wizard.vue`) volá `useAdopt.refresh()` se
  `supplier.value?.ico`, který je ve složce bez nastavení `null`; `deriveOurIco`
  (`desktop/adopt.ts`) pak rozhodne podle většiny dokladů. Složka s převahou dokladů od jednoho
  neplátce-subdodavatele se nabídne jako vlastní vydané faktury.

- **UI-47 · Hláška o poškozeném datovém souboru jmenuje pole z kódu — NÍZKÁ.**
  `issuesText` (`src/utils/errors.ts`) lepí `issue.path.join('.')`, takže `useVaultFile.load`
  a `save` hlásí „(supplier.bankAccount: …)" a import výdaje „Přijatý doklad se nepodařilo
  přečíst: supplier: …".

- **DATA-28 · Zálohy odeslaných faktur se neuklízejí — NÍZKÁ.**
  `saveSnapshot` (`desktop/store.ts`) maže kopie starší `SNAPSHOT_WEEKS` jen při dalším zápisu téhož
  čísla. `markInvoiceSent` (`desktop/invoice/status.ts`) uloží zálohu neodeslané verze, která pak
  ve `snapshots/faktury/` zůstane navždy.

- **DATA-29 · Smazaný výdaj nejde vrátit opětovným importem — NÍZKÁ.**
  `askDelete` (`src/pages/expense/index.vue`) nechá PDF v `prijate/` a `identicalFile`
  (`desktop/received.ts`) pak tentýž soubor odmítne jako duplikát. Obnovit jde jen smazáním souboru
  ve Finderu.

- **NAST-27 · V balíčku zůstává `default_app.asar` z Electronu — NÍZKÁ.**
  `electronDist` v `electron-builder.yml` vypne úplný úklid, takže
  `Contents/Resources/default_app.asar` jde s appkou. Fuse `OnlyLoadAppFromAsar` ho nenačte;
  smazat ho jde v `afterPack`.
