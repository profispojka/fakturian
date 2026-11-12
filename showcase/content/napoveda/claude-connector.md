---
kind: help
group: Integrace
order: 12
title: Claude connector (MCP)
description: Registrace MCP serveru, seznam nástrojů, které agent má k dispozici, a důvod, proč musí být appka během práce otevřená.
related:
    - /napoveda/reseni-potizi
    - /napoveda/datova-slozka
---

Fakturian vystavuje **MCP server**, takže se AI agenta můžeš zeptat na svoje
doklady — nebo ho nechat jeden vystavit.

## Jak to funguje

```
Claude ──stdio── Fakturian --mcp ──lokální socket── běžící Fakturian ── vault
```

Server sám do vaultu nezapisuje ani nečte. Posílá požadavky běžící appce a ta
odpovídá. Důvod: souběžný zápis do JSONu se neprojeví chybou, ale tichou
ztrátou dat. Takhle zůstává jediným zapisovatelem appka.

Socket leží v `~/Library/Application Support/com.fakturian.desktop/mcp.sock` —
schválně mimo vault, protože ten se synchronizuje do cloudu.

## Registrace

```sh
claude mcp add fakturian -- "/Applications/Fakturian.app/Contents/MacOS/app" --mcp
```

Server je tatáž binárka jako appka, jen spuštěná s `--mcp` — nic dalšího si
instalovat nemusíš. Tentýž příkaz i s cestou k **tvé** instalaci najdeš v appce
na stránce **Integrace**, odkud se dá zkopírovat.

## Co agent umí

| Nástroj            | Co dělá                                                         |
| ------------------ | --------------------------------------------------------------- |
| `list_invoices`    | seznam faktur: číslo, odběratel, data, částka, zaplaceno       |
| `get_invoice`      | detail faktury včetně položek a stavu úhrady                    |
| `list_contacts`    | odběratelé včetně poznámek                                      |
| `list_expenses`    | výdaje: dodavatel, popis, částka, datum                         |
| `pricelist_status` | ceník za rok: vykázáno, zbývá do limitu, na kterých fakturách   |
| `summary`          | obrat, náklady, marže, dlužníci, stav limitu plátcovství        |
| `create_invoice`   | **vystaví fakturu** — číslo přidělí appka, uloží se PDF s ISDOC |

## Na co si dát pozor

- **Appka musí běžet.** Když neběží, server to řekne rovnou („Fakturian neběží.
  Spusť appku…") místo aby vracel prázdné výsledky.
- **Vystavení faktury potvrzuješ v okně appky.** Otázka ukáže odběratele,
  součet, řádky i poznámku; do té doby agent čeká. Potvrzený doklad je ostrý,
  se skutečným číslem z řady, a zrušit ho jde jen smazáním v appce.
- **Mazat agent neumí.** Smazání potvrzuje člověk v appce.
- **Práva** si dál omezíš v MCP klientovi. Čtecí nástroje se v appce neptají.
