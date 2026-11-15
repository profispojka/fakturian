# Původní PDF z cizích fakturačních systémů

Tato sada obsahuje nezměněné veřejně dostupné doklady a oficiální vzory z
Pohody/mPohody, Fakturoidu a iDokladu. `manifest.json` u každého drží zdrojovou
URL, SHA-256 originálu a pevně zapsaný očekávaný výsledek.

PDF se stahují při přípravě fixtures. Běžné E2E testy síť nepotřebují a
kontrolují hash všech souborů. Nepřepisují jejich vložené ISDOC ani nevyrábějí
náhrady vlastní šablonou Fakturianu. Skutečné údaje těchto veřejných dokladů
patří jen do této sady, nikoli do syntetického vaultu a ukázkových dat aplikace.

`workflows/external-invoices.spec.ts` ověřuje v opravdovém okně Electronu:

- import všech originálů přes Nastavení, včetně úplného důvodu odmítnutí;
- převzetí platných vydaných faktur všech tří systémů přes nabídku ve složce;
- otevření převzatých a importovaných dokladů, jejich číslo, částku a položky;
- příjem platných dokladů přes Výdaje až po záznam v `vydaje.json`;
- odmítnutí demonstračních dokladů s neplatným IČO;
- duplicity, zachování původních bajtů a převzetí smíšené dávky.

Nahrazený je pouze nativní dialog výběru souboru, který Playwright přímo
neovládá. Frontend, IPC, validátor ISDOC, parser a souborový systém běží
doopravdy nad dočasným domovem a samostatnou kopií vaultu.

```sh
bun run test:e2e -- test/e2e/workflows/external-invoices.spec.ts --workers=2
```

Marketingový vzor iDokladu má neplatné IČO odběratele `12345678`, Aurora
neplatné IČO dodavatele `87654321`. Jejich odmítnutí není pozitivní test
kompatibility. Ten zajišťují nezměněné skutečné doklady s platnými údaji.
Přesné zaokrouhlení shora z Aurory navíc hlídá syntetický regresní vzorek
`desktop/test/fixtures/gross-price.isdoc` s platnými smyšlenými IČO.
