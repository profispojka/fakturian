---
kind: use-case
eyebrow: Chci data u sebe
title: Fakturace, která nic neposílá na cizí server
description: Vault je složka na tvém disku. Žádný účet, žádná registrace, žádná telemetrie. Online jsou jen dvě volitelné funkce, které si zapínáš sám.
lede: Nejde o nedůvěru k jedné službě. Jde o to, že účetnictví je citlivý provozní záznam a nemusí být nikde jinde než u tebe.
shot: usecase-bez-cloudu
shotAlt: Nastavení datové složky s cestou k vaultu na disku
video: vault
faq:
    - q: Co přesně jde na internet?
      a: Jen dvě věci a jen když si o ně řekneš — dotažení firmy z ARESu podle IČO a stažení plateb z Fio banky. Nic jiného appka neodesílá.
    - q: Sbírá appka analytiku?
      a: Ne. Žádná telemetrie, žádné hlášení chyb na server, žádné ověřování licence. Appka se nikam nehlásí ani při spuštění.
    - q: Kde jsou uložené tokeny do banky?
      a: V Klíčence macOS, ne v souboru ve vaultu. U Fia doporučujeme token jen pro čtení.
    - q: Jak to funguje s GDPR?
      a: 'Zpracování zůstává u tebe: data jsou na tvém zařízení a appka je nikam nepředává. Nemáme přístup k ničemu, takže nefiguruje žádný zpracovatel navíc.'
    - q: Jak zálohovat, když není cloud appky?
      a: Tím, kam složku dáš — iCloud Drive, Dropbox, Time Machine, Git nebo USB. Appka k tomu přidává rotující snímky posledních verzí.
    - q: Není lokální appka riziko, když mi shoří notebook?
      a: 'Proto je vault obyčejná složka: dej ji do synchronizovaného úložiště a máš offsite zálohu bez toho, aby data držela fakturační služba.'
related:
    - /reseni/offline
    - /pro/male-firmy
---

## Co je na tom dnes otravné

Cloudová fakturace je pohodlná, dokud si nepoložíš tři otázky: kdo k datům
může, co se s nimi stane, když služba skončí, a jak z ní odejít, až přijde
čas.

Odpověď bývá „export do CSV" — což je jiný způsob, jak říct, že tvoje doklady
jsou uvnitř cizího systému a ven vede jen úzká branka.

## Jak to řeší Fakturian

### Vault je složka, ne účet

```
Vault/
  faktury/          2026001.pdf (PDF s vloženým ISDOC)
  prijate/          přijaté doklady tak, jak přišly
  .fakturian/       nastaveni.json  vydaje.json  platby.json
```

Nic z toho není zamčené: faktury otevřeš v čemkoli, JSON soubory v textovém
editoru. Odejít od appky znamená nechat si tu složku.

### Žádná registrace, žádné přihlašování

Appka nemá účty. Spustíš ji a fakturuješ. Nemá ani ověřování licence — kdyby
ho měla, potřebovala by server, a ten by popíral celý smysl.

### Online jen to, co si zapneš

| Funkce | K čemu je                 | Kdy běží     |
| ------ | ------------------------- | ------------ |
| ARES   | doplnění firmy podle IČO  | když klikneš |
| Fio    | stažení plateb a párování | když klikneš |

Bez internetu appka normálně funguje, jen tyhle dvě věci nejsou dostupné.
Odeslání e-mailem používá tvého mailového klienta — appka sama nic neodesílá.

### Zálohu si volíš ty

Vault v iCloudu, Dropboxu nebo Google Drive znamená synchronizaci mezi
zařízeními i zálohu mimo dům. Time Machine přidá historii verzí, Git plné
verzování. K tomu appka drží rotující snímky datových souborů, ze kterých se
dá vrátit omyl. Jednorázovou kopii uděláš ve Finderu — je to obyčejná složka.

## Jak začít

1. **Rozmysli si, kde má složka ležet** — a tím zároveň, jak se bude zálohovat.
2. **Nezapínej žádnou integraci**, pokud ji nechceš. Appka funguje i tak.
3. **Zkontroluj po měsíci**, že se složka opravdu synchronizuje tam, kam má.

## Na co si dát pozor

- Lokální data znamenají **vlastní odpovědnost za zálohu**. Appka ti pomůže,
  ale rozhodnutí je tvoje.
- Vault používej **z jednoho počítače v jednu chvíli**, i když leží v cloudové
  složce.
- Appka je **pro neplátce DPH** a běží **na macOS**.
