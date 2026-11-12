---
name: zod-validace
description: Jak se ve Fakturianu píše validace přes zod — hláška přímo ve schématu, vlastní validace (IČO, PSČ, účet, datum) v src/utils/zod/schemas.ts, cizí data přes safeParse, kde schéma bydlí. Použij při psaní nebo úpravě jakéhokoli zod schématu (src/schemas/, src/utils/zod*, src/utils/validators.ts, formuláře, odpovědi IPC, soubory vaultu, argumenty MCP) a při každé nové kontrole vstupu.
---

# Validace přes zod

Princip hranice („Dovnitř jen kvalitní data", „Žádné migrace") je v AGENTS.md. Tady je, jak ho
psát do schématu. Lint hlídá `fakturian/zod-no-parse` a import `zod` mimo `src/utils/zod*`
(`no-restricted-imports`).

## Hláška stojí ve schématu

Text, který uvidí uživatel, se píše rovnou ke kontrole. Žádná globální mapa hlášek, žádné
konstanty s texty, žádné `params` s kódem problému:

```ts
name: z.string().trim().min(1, 'Povinné pole.'),
amountCents: z.number('Zadej číslo.').int('Zadej celé číslo.').refine((cents) => cents !== 0, 'Vyplň částku.'),
```

- **Povinný text** je `z.string().trim().min(1, 'Povinné pole.')`.
- **Číslo z formuláře** dostane hlášku i za chybějící nebo nečíselnou hodnotu: `z.number('Zadej číslo.')`.
- **Pravidlo nad víc poli** hlásí `checks.addIssue({ code: 'custom', path: ['lines'], message: \`…\` })`v`superRefine`; hláška se skládá na místě.
- Schéma souboru vaultu nebo odpovědi IPC hlášky nepíše. Poškozený soubor dostane vestavěnou
  češtinu zodu, kterou zapíná `src/utils/zod.ts` (`z.config(z.locales.cs())`).

Nesouvisí s tím věta, kterou kód skládá **kolem** výsledku validace — ta patří k akci:

```ts
const report = importReportSchema.safeParse(raw);
if (!report.success) throw new Error(`Zpráva o importu má poškozený obsah (${issuesText(report.error)}).`);
return report.data;
```

## `z` se bere z `~/utils/zod`

Modul zapíná českou lokalizaci a přidává vlastní validace ze `src/utils/zod/schemas.ts`, každou
i s hláškou: `z.ico()`, `z.zip()`, `z.bankAccount()`, `z.bankCode()`, `z.dateString()`,
`z.isdocDate()`, `z.isdocDateOrBlank()`. Nová vlastní validace přibude tam, když ji potřebuje víc
schémat. Datum se neověřuje vlastním `regex`em.

## Co umí zod, nepíše se znovu

Před vlastní kontrolou formátu ověř ve zdrojáku (`node_modules/zod/v4/core/schemas.js`), co zod
umí. `z.iban()` hlídá i kontrolní součet mod-97, takže vlastní `isValidIban` by byla duplicita.
Vlastní validátor v `src/utils/validators.ts` má místo jen tam, kde zod formát nemá.

## Schéma na hranici

- **Povinná hodnota nemá `.default()`, `.catch()` ani `.prefault()`.** Výjimka je `.default()`
  nad celým souborem evidence — chybějící soubor vrací hlavní proces jako `{}` a prázdná evidence je
  platný stav.
- **Nepovinné je `undefined`, prázdný řetězec je vadná hodnota.** Schéma nepovinného pole je
  holé `z.email('Neplatný e-mail.').optional()`, žádné „…nebo prázdné". Prázdné pole převádí na
  `undefined` ten, kdo hodnotu přinesl: formulář přes `<UInput v-model.trim.optional>`, import
  a převzetí v mapování odpovědi hlavního procesu (`c.email.trim() || undefined`
  v `utils/import.ts`).
- **Cizí argumenty (MCP, import) jdou přes `z.strictObject`**, aby překlepnutý klíč neprošel.
- **Cizí data: `safeParse` s `if` na místě**, ne `.parse()` — ten pošle do UI `ZodError`
  s víceřádkovým JSONem. Kolem `safeParse()` se nezakládá společná obálka.

## Kde schéma bydlí

- Schéma, jeho typ, `empty*()` a `newInvoice()` patří do `src/schemas/`.
- Mez, kterou čte jediné schéma, stojí u něj (`MAX_DUE_DAYS` v `schemas/suppliers.ts`); když musí
  sedět s hlavním procesem v `desktop/`, řekne to komentář. Výchozí hodnota pro `empty*()` je
  v `constants/` (`DEFAULT_DUE_DAYS`, `DEFAULT_TEMPLATE`).

## Testy

- Schémata souborů vaultu běží v testech doopravdy, včetně cesty „poškozený JSON"
  (`fakturian/no-contract-mock`).
- Fixture, která jde do formuláře, musí schématem projít, jinak `UForm` `@submit` nezavolá.
- Test odmítnutí porovná celou hlášku pevným řetězcem, i s cestou pole
  (`toEqual([{ path: ['lines'], message: 'Součet faktury nesmí být záporný.' }])`). `czechList`
  dává za „a" nezlomitelnou mezeru (`a PSČ`).
