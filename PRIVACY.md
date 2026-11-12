# Zásady ochrany osobních údajů

Fakturian je **desktopová appka bez serveru a bez účtu**. Neexistuje žádný
Fakturian backend, kam by appka data posílala — provozovatel appky (binaro.cz)
proto k žádným fakturám, odběratelům ani jiným datům nemá přístup a nemůže je
ani na požádání smazat, protože je nikdy nemá u sebe.

## Kde appka data drží

Všechna data — faktury, dobropisy, odběratelé, vlastní firemní údaje, ceník,
náklady, vykázané dny — jsou obyčejné soubory ve složce, kterou si
uživatel sám zvolí („vault"). Appka je čte a zapisuje jen tam. Zálohu,
synchronizaci mezi zařízeními i smazání dat řeší uživatel sám tím, kam vault
umístí (iCloud Drive, Dropbox, Time Machine, USB, …) — Fakturian do toho
nijak nezasahuje.

Pokud vault obsahuje osobní údaje třetích osob (jméno a adresu odběratele na
faktuře, kontaktní osobu apod.), je jejich **správcem uživatel appky** jako
podnikatel vystavující faktury — ne autoři appky. Fakturian je vůči těmto
datům jen nástroj, který je zpracovává lokálně na uživatelově počítači.

## Dva volitelné online dotazy

Appka běží offline. Online se připojuje jen ve dvou situacích a vždy až po
akci uživatele:

- **ARES** (`ares.gov.cz`, ekonomické subjekty ČR) — při dotažení firmy podle
  IČO appka pošle dotaz na tento veřejný rejstřík Ministerstva financí. Posílá
  se jen IČO; appka po odpovědi nic dalšího neukládá ani neposílá jinam.
- **Fio banka API** (`fioapi.fio.cz`) — volitelná synchronizace plateb.
  Vyžaduje token, který si uživatel sám vygeneruje ve svém internetbankingu.
  Token appka uloží do **macOS Keychain**, ne do souborů vaultu, a nikam dál
  ho neposílá. Stažené transakce appka použije jen lokálně ke spárování
  plateb s fakturami.

Žádný z těchto dotazů neprochází přes server Fakturianu — appka je posílá
přímo z počítače uživatele na cílovou službu.

## Co appka nedělá

Fakturian neobsahuje žádnou telemetrii, analytiku, sledování používání ani
crash reporting směrem ven z počítače uživatele. Neexistuje žádná reklama ani
SDK třetí strany kromě výše popsaných přímých volání a systémové klíčenky.
Appka si nezakládá žádný uživatelský účet.

## Log na disku

Appka zapisuje technický log jen na disk uživatele, do
`~/Library/Logs/com.fakturian.desktop/Fakturian.log`. Do logu jdou chyby při
startu a nezachycené chyby hlavního procesu, pád nebo nenačtení stránky appky,
příkaz, který nepřišel ze stránky appky (i s adresou, odkud přišel), poškozený
nebo neuložitelný stav okna, varování mostu MCP a selhání přesunu dokladu do
Koše (i s cestou k souboru, která nese číslo dokladu). Obsah faktur ani tokeny
se do logu nezapisují. Log se nikam neodesílá.

## Dotazy

Dotazy k těmto zásadám nebo k appce samotné směřuj na jejího provozovatele,
binaro.cz.
