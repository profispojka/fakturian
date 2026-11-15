# Fakturian — Backlog

- **UCT-40 · Ruční import ISDOC do cizího programu není doložený — STŘEDNÍ.**
  Vzorky dokladů jsou `samples()` v `desktop/test/invoices.ts` (faktura,
  dobropis, faktura na zálohu, minimální doklad); PDF z nich staví jen
  `desktop/test/pdfa.test.ts` do dočasné složky, kterou po sobě smaže. Vzorky
  uložit, importovat do Pohody nebo Money S3 a ověřit číslo, částku, odběratele,
  příznak neplátce a vazbu dobropisu. Program, verzi a výsledek zapsat do
  [07-KVALITA](07-KVALITA.md) k vydávacím branám.
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
