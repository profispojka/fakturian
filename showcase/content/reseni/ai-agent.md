---
kind: use-case
eyebrow: Pracuju s AI agentem
title: Zeptej se Claude na svoje faktury
description: Fakturian vystavuje MCP server, takže agent pracuje nad tvým skutečným vaultem. Čte doklady, výdaje i vykázané položky ceníku a umí vystavit fakturu.
lede: Agent nemusí hádat z e-mailů ani se prokousávat cizím API. Data jsou soubory na disku a appka mu je podá přes lokální socket.
shot: usecase-ai-agent
shotAlt: Stránka Integrace s příkazem pro registraci Claude connectoru a cestou k socketu
video: mcp
faq:
    - q: Jak se to zapne?
      a: Jedním příkazem, který je i v appce na stránce Integrace — claude mcp add fakturian -- <cesta-k-Fakturianu> --mcp. Server je tatáž appka spuštěná s přepínačem, takže nic dalšího instalovat nemusíš. Pak stačí mít Fakturian otevřený.
    - q: Proč musí appka běžet?
      a: Aby do datových souborů zapisoval pořád jen jeden proces. Souběžný zápis do JSONu se neprojeví chybou, ale tichou ztrátou dat, kterou objevíš za měsíc.
    - q: Co všechno agent umí?
      a: Vypsat faktury i jejich detaily, odběratele, výdaje, ceník s vykázáním a ročními limity a souhrn (obrat, náklady, dlužníci, limit plátcovství). A vystavit fakturu.
    - q: Může agent smazat doklad?
      a: Ne. Mazat smí jen člověk v appce, kde se to potvrzuje otázkou, takže to server nenabízí.
    - q: Je vystavení faktury agentem „nanečisto"?
      a: Není. Vystavení potvrzuješ v okně appky, kde vidíš odběratele, součet i řádky. Potvrzený doklad dostane skutečné číslo z řady a uloží se jako PDF s ISDOC; zrušit ho jde jen smazáním v appce.
    - q: Jak omezím, co agent smí?
      a: Vystavení faktury se vždycky ptá v okně appky, čtecí nástroje ne. Další omezení nastavíš v právech svého MCP klienta.
    - q: Posílají se moje data do cloudu AI?
      a: Do modelu jde to, co mu v konverzaci pošleš nebo co si vyžádá nástrojem, stejně jako u jakéhokoli jiného MCP serveru. Fakturian sám nic neodesílá.
related:
    - /reseni/bez-cloudu
    - /pro/programatory
---

## Co je na tom dnes otravné

Agenti jsou dobří v tom, co mají po ruce. Když je účetnictví v cloudové službě,
je odděleno API klíčem, oprávněními a tvarem dat, který se agentovi popisuje
hůř, než se vyplatí — takže nakonec kopíruješ čísla do chatu ručně.

Přitom otázky, které si člověk klade, jsou jednoduché: kolik mi kdo dluží, kolik
jsem letos protočil, kolik dní dovolené mi ještě zbývá.

## Jak to řeší Fakturian

### MCP server nad tvým vaultem

```
Claude ──stdio── Fakturian --mcp ──lokální socket── běžící Fakturian ── vault
```

Server sám do vaultu nezapisuje ani nečte. Posílá požadavky běžící appce a ta
odpovídá — jediným zapisovatelem tak zůstává appka a souběh nemůže nastat.

### Co agent umí

| Nástroj                        | K čemu                                             |
| ------------------------------ | -------------------------------------------------- |
| `list_invoices`, `get_invoice` | seznam a detail dokladů                            |
| `list_contacts`                | odběratelé včetně poznámek                         |
| `list_expenses`                | výdaje: dodavatel, popis, částka, datum            |
| `pricelist_status`             | ceník a jeho vykázání za rok                       |
| `summary`                      | obrat, náklady, marže, dlužníci, limit plátcovství |
| `create_invoice`               | vystaví doklad — číslo přidělí appka               |

### Otázky, které dávají smysl

- „Kolik mi letos dluží Studio Kolmá a kdy byla poslední platba?"
- „Kolik hodin konzultací mi letos zbývá do ročního limitu?"
- „Vystav fakturu za srpen podle té červencové, jen s dvaceti hodinami."
- „Jak jsem daleko od limitu plátcovství?"

### Cena za to

**Agent funguje jen když máš Fakturian otevřený.** Když neběží, server to řekne
rovnou, místo aby vracel prázdné výsledky. Je to vědomá výměna: raději jasná
hláška než tiše rozbitá data.

## Jak začít

1. **Zaregistruj server** příkazem ze stránky Integrace.
2. **Nech appku otevřenou** a zeptej se agenta na cokoli z tabulky výš.
3. **Vystavení dokladu si napřed vyzkoušej** na něčem, co ti nevadí
   smazat — je to ostrá akce se skutečným číslem.

## Na co si dát pozor

- **Vystavení faktury potvrzuješ v appce**; čtení omezíš v MCP klientovi.
- Socket leží mimo vault (v Application Support), aby se nesynchronizoval do
  cloudu.
- Appka je **pro neplátce DPH** a běží **na macOS**.
