---
name: test-ids
description: Jak se ve Fakturianu hledají prvky v testech Vue vrstvy — výhradně přes data-testid, psané napřímo bez pomocných funkcí, jak se značky pojmenovávají a kam se dávají. Použij při psaní nebo úpravě jakéhokoli testu, který sahá do DOM (test/nuxt/*.spec.ts), a při doplňování značek do komponent a stránek v src/.
---

# Testovací značky

Prvek se v testu hledá **jedině** přes `data-testid` — ne podle textu, třídy ze stylu ani pořadí
ve `findAll()`. Text se mění korekturou, třída přebarvením a index posunem šablony; značka je
zapsaný kontrakt, ve zdrojáku je vidět, že na prvek sahá test. Hlídá `fakturian/test-id-selector`
v `test/nuxt/**`.

## Selektor se píše napřímo

```ts
await c.find('[data-testid="action-save"]').trigger('click');
expect(c.find('[data-testid="statusbar-total"]').text()).toBe('12 100,00 Kč');
c.findAll('[data-testid^="menu-section"]');
```

Žádné obaly kolem selektoru (`tid('action-save')`, `button(c, 'Uložit')`) — funkce jen schová, na
co se sahá. Pomocník, který nese postup s čekáním, je jiná věc (`save(c)` ve skillu `vue-testy`).

## Pojmenování

- kebab-case, anglicky, podle domény: `action-save`, `item-quantity`, `customer-picker-item`.
- Předpona drží skupinu (`item-label`, `item-quantity`), sourozence pak vezme `^=`.
- **Předpony nesmí zasahovat do sebe.** `menu-new` a `menu-new-invoice` by se přes
  `[data-testid^="menu-new-"]` potkaly s `menu-new-background` — proto se pozadí jmenuje
  `menu-background`. Překryv se pozná až padajícím testem.
- Pole formuláře podle jména ve schématu: `form.bankAccount` → `field-bankAccount`,
  `form.address.zip` → `field-address-zip`.
- Značka nad opakovaným prvkem se skládá: ``:data-testid="`menu-section${item.to}`"``.

## Kam značku dát

Komponenty Nuxt UI propouštějí atributy na vykreslený prvek, takže se píše rovnou na ně
(`<UButton data-testid="action-save">`). Stav se čte na prvku nalezeném podle značky přes druhý
atribut (`attributes('data-selected')`), ne zvláštním selektorem — Vue `data-*` při `false`
nevykreslí.

Když komponenta nabízí slot, nakresli si prvek sám a dej mu značku: `ConfirmDialog` má
`<template #title><span data-testid="dialog-heading">` místo holého `:title`.

## Výjimka: vnitřek Nuxt UI

Do markupu, který si appka nekreslí, se značka dostat nedá. Tam se hledá přes roli nebo slot:

- `[role="option"]` — řádky nabídky `USelect`, `USelectMenu` a `UCommandPalette`;
- `LISTBOX` a `CHECKBOX` z `test/setup/mount.ts` — spouštěč nabídky a zaškrtávátko;
- `[role="group"]`, `[data-slot="label"]` — skupiny v paletě;
- `[data-slot="links"] button` — akce `UError`;
- `button[aria-label="Close"]` — křížek `UModal`.

## Teleport

Modály, nabídky a popovery se vykreslují do `document.body`, hledají se přes `layer()`:

```ts
await layer().find('[data-testid="dialog-confirm"]').trigger('click');
```

Když test potřebuje `props()` (barvu, `loading`), jde přes strom komponent, který teleport
přemosťuje:

```ts
c.findAllComponents(UButton).find((b) => b.attributes('data-testid') === 'dialog-confirm');
```
