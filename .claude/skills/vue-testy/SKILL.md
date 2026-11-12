---
name: vue-testy
description: Jak se ve Fakturianu testuje Vue vrstva — skutečný Nuxt runtime a Nuxt UI bez stubů, mountUi/layer/goto z test/setup, skutečný router a potvrzovací dialog, vyplňování formulářů, falešný backend a pasti, na které se opakovaně naráží. Použij při psaní nebo úpravě jakéhokoli testu v test/nuxt/ a při ladění padajícího testu komponenty, stránky nebo composable.
---

# Testy Vue vrstvy

Hledání prvků a `data-testid` popisuje skill `test-ids`. Celý model kvality je v
`docs/10-KVALITA.md`.

## Jak je to poskládané

`vitest.config.ts` má dva projekty: `unit` (`vitest.unit.config.ts`, `test/*.spec.ts`, prostředí
`node`, čistá logika) a `nuxt` (`vitest.nuxt.config.ts`, `test/nuxt/*.spec.ts`, skutečný Nuxt
runtime přes `@nuxt/test-utils`). Nuxt runtime žije
po celý soubor; `test/setup/nuxt-state.ts` před každým testem uklidí stav, `document.body`
i adresu a odmountuje komponenty.

Spouštění: `bunx vitest run test/nuxt/page-invoice.spec.ts`. Projekt `nuxt` staví do `.nuxt`
stejně jako dev server — při běžícím serveru (port 1420) pusť jen `--project unit`.

## Žádné stuby

Komponenty a stránky se testují proti **skutečnému Nuxt UI**. `test/setup/ui-stubs.ts` se nezakládá
a `nuxt.config.ts` nedostane hook, který by `U*` vyřazoval z auto-importu. Stub testuje sám sebe:
stubový `UForm` by emitoval `submit` bez validace a test by tvrdil, že se uloží dodavatel, kterého
skutečný formulář odmítne.

Router i potvrzovací dialog jsou skutečné. Jediná náhrada auto-importu v sadě je `useColorMode()`
(`mockNuxtImport`), protože plugin `@nuxtjs/color-mode` v testovacím runtimu neběží. Mockuje se
okraj appky — most hlavního procesu `globalThis.fakturian` nahrazuje před každým testem falešný
backend z `test/setup/backend.ts` (`resetBackend()` v `nuxt-state.ts`), dál `vue-echarts`.

## Nástroje z `test/setup/`

| co                                              | k čemu                                                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `mountUi(component, …)` (`mount.ts`)            | mount v `UApp`, připojený k `document.body`; vrací wrapper komponenty                              |
| `mountPage(path)`                               | stránka přes skutečný `NuxtPage` na adrese `path`, i s rodičem sekce                               |
| `layer()`                                       | obsah teleportovaný do `document.body` (modály, nabídky, popovery)                                 |
| `goto()`, `currentPath()`                       | skutečná navigace a adresa, na které appka stojí                                                   |
| `answerDialog(true \| false)`                   | klik ve skutečném `ConfirmDialog`; otázku čti z `dialog-heading` a `dialog-message` přes `layer()` |
| `dialogDestructive()`                           | je potvrzovací tlačítko červené                                                                    |
| `shortcut(key)`                                 | ⌘+klávesa do okna, vrací událost                                                                   |
| `LISTBOX` + `pick()`, `CHECKBOX` + `check()`    | rozbalovací seznamy a zaškrtávátka                                                                 |
| `pickDate()`, `enterDate()`                     | datumová pole                                                                                      |
| `date()`, `period()` (`dates.ts`)               | datum a období ve fixture                                                                          |
| `backend` (`backend.ts`)                        | falešný hlavní proces: `returns(…)`, `fails(…)`, zaznamenaná volání                                |
| `prepareVault()`, `saved()` (`vault.ts`)        | obsah vaultu před testem a co se do něj zapsalo                                                    |
| `mountInvoice()`, `save(c)` (`invoice-page.ts`) | stránka faktury a uložení i s čekáním na konec ukládání                                            |

## Router a dialog

- **Stránka se montuje jen přes `mountPage(path)`**, nikdy `mountUi(Stranka)`. Vykreslí ji
  `NuxtPage` jako v appce: hlídky odchodu dostanou záznam routy od `RouterView` a se změnou id
  v adrese (`/expense/v1` → `/expense/new`) se stránka namontuje znovu. Wrapper patří `NuxtPage`,
  takže `c.find` platí i po přechodu; prvek najitý před přechodem už v dokumentu není.
- **Odchod ze stránky se vyvolá navigací.** `await goto('/invoice')` projde `onBeforeRouteLeave`
  doopravdy; jestli hlídka pustila, řekne `currentPath()`. Zaznamenané `navigateTo()` by prošlo
  i tehdy, když navigaci hlídka zruší.
- **Na otázku se odpovídá klikem** (`answerDialog`). Otevřená otázka se v testu nenechává — volání,
  které na ni čeká, by se dokončilo uprostřed dalšího testu v jeho vynulovaném stavu.

## Formuláře se vyplňují v testu, řádek po řádku

Žádné `fillDetails(c)` ani smyčka nad mapou `pole → hodnota`:

```ts
await c.find('[name="ico"]').setValue('12345679');
await c.find('[name="name"]').setValue('Jan Novák');
await c.find('[name="address.zip"]').setValue('60200');
```

Z testu je vidět, co se do formuláře dostalo, a rozbité pole ukáže vitest přímo. Fixture jako
konstanta (`VALID_SUPPLIER`, `completeSupplier()`) je v pořádku, když se předává komponentě nebo
backendu. Pomocník smí nést postup s čekáním (`save(c)` čeká na konec ukládání), ne vyplňování.

## Pasti

1. **`<UApp>` je povinný obal** (`mountUi` ho dává). Bez něj `UTooltip` spadne na chybějícím
   `TooltipProvider` a `useOverlay()` nemá kdo vykreslit.
2. **Teleport se nestubuje.** `stubs: { teleport: true }` přes portál Reka UI nevykreslí nic;
   modály se hledají přes `layer()`.
3. **Modál mountovaný sám za sebe se vykreslí až s `open`:** `attrs: { open: true }` a pak
   `flushPromises()`.
4. **`UForm` validuje asynchronně a při chybě `@submit` nezavolá.** Fixture musí projít schématem;
   po odeslání se čeká `flushPromises()`, ne `nextTick()`.
5. **Prvky nejsou nativní.** `USelect` je tlačítko s `role="combobox"` a reaguje na `pointerup`
   nebo Enter, `USelectMenu` má `aria-haspopup="listbox"` a reaguje na klik (`pick()` posílá
   obojí), `UCheckbox` je `[role="checkbox"]`.
6. **`UButton` s `to` je odkaz** — cíl je v `href`.
7. **Pole formuláře nesou `name` z `UFormField`** (`[name="address.zip"]`).
8. **Mock `useTimeoutFn` z `@vueuse/core` zasáhne i Nuxt UI.** Vracej celé rozhraní (`start`,
   `stop`, `isPending`), jinak `UTooltip` spadne na `clearTimer is not a function`.
9. **Hledání v paletě běží mimo tik vykreslení** — čekej `vi.waitFor()`.
10. **Toast z `useToast().add()` je v `toasts` až po `nextTick`.** Před asercí `flushPromises()`.
    Jeden toast je v DOM kvůli čtečce víckrát, počty ber ze stavu.
11. **`UAvatar` pouští atributy na `<img>`**, bez obrázku na záložní span — `data-testid` nesedí
    na obalu.
12. **Částky porovnávej proti `czkFromCents()`**, oddělovač tisíců je nedělitelná mezera.
13. **`payload.state` je hluboce reaktivní:** spread nad `data.value` vloží proxy a
    `structuredClone` v `useVaultFile.save()` spadne na `could not be cloned` — proto `toRaw`.
14. **Pokrytí se při jakémkoli pádu nevygeneruje** (`required-tests-reporter` hodí na konci běhu).
    Pokrytí jednoho souboru se měří na podmnožině specs, které projdou, s `--coverage.include`.
15. **happy-dom nemá `PromiseRejectionEvent`** — test `unhandledrejection` pošle obyčejný `Event`
    s `reason`.
