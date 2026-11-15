# E2E vault

Obsah `vault/` je syntetický a smí se používat jen pro automatické testy. Sada ho
kopíruje do nové dočasné složky (`fixtureVault()` v `test/e2e/app.ts`); aplikace
běží s dočasným domovem, takže nikdy nepracuje s osobním vaultem ani s uloženou
cestou běžného Fakturianu.

Každý test dostane vlastní kopii. Test, který potřebuje už vystavenou fakturu
(`reopen-invoice`, `export-pdf`, `invoice-lifecycle`, `change-vault`), ji do
kopie dostane z generátoru `desktop/examples/e2e-invoice.ts`: faktura `RRRR0001`
s dnešním datem sady pro odběratele níže, uložená produkční cestou, takže PDF
i vložený ISDOC mají tvar, jaký vyrábí appka.

Dodavatel i odběratel mají záměrně nereálné kontaktní údaje. IČO `12345679`
prochází kontrolním součtem používaným formulářem.

`external-invoices/` obsahuje původní veřejná PDF z jiných fakturačních
systémů pro skutečný import a převzetí. Jejich původ, hashe a očekávání
popisuje samostatný [README](external-invoices/README.md).
