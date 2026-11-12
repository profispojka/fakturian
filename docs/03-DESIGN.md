# Fakturian — Design a nativní vzhled (macOS)

Cíl: appka má působit jako **nativní pro-nástroj**, ne jako web v okně. Běží
v okně Electronu (Nuxt + Nuxt UI); nativní dojem je vrstva detailů, které
shrnuje tenhle dokument. Jak se vzhled píše v kódu (Tailwind, tokeny,
`main.css` vs. `<style>` blok, stupnice a zlomy), je ve skillu
`.claude/skills/styly/SKILL.md` a v [AGENTS.md](../AGENTS.md).

> **Řeč appky.** Tichá neutrální plocha, prostory oddělené **vlásečnicí**.
> Barva se objeví jen tam, kde nese informaci (zaplaceno, po splatnosti, limit
> DPH); všechno ostatní mluví stupni šedi a odsazením.
>
> Průsvit má levý panel (systémový materiál `sidebar` a `backdrop-blur`)
> a plovoucí plochy: nabídky a paleta jsou poloprůhledné s rozostřením pozadí,
> modaly mají pod sebou lehce rozostřenou plachtu. Plovoucí plochy mají velké
> zaoblení (`rounded-3xl`), karty uvnitř stránky nesou nasvícenou hranu
> (`bevel` v `main.css`: horní hrana světlejší, dolní tmavší).
>
> Referencí je Cursor a sesterská appka **Palmtree** (`../palmtree/app`) —
> stejný jazyk ploch.

---

## 1. Okno a titulkový pruh

- **Skrytý titlebar** — `titleBarStyle: 'hidden'` v `desktop/window.ts`.
  Semafory zůstávají na místě systémového titulku a obsah jde „pod" ně; panel
  i průvodce pro ně nechávají nahoře pruh výšky `--topbar`.
- **Matný levý panel.** Okno má průhledné pozadí a `vibrancy: 'sidebar'`;
  stránka v okně appky dostane třídu `native` (`plugins/native-chrome.client.ts`),
  která vypne plochu `html` a `body`. Pracovní plocha vpravo je neprůhledná.
- **Vzhled okna** (vibrancy, semafory) jde za přepínačem motivu v Nastavení,
  ne za systémem: plugin ho posílá příkazem `set_window_theme`.
- **Okno na pozadí** tlumí zvýraznění řádků jako macOS (`.window-inactive`,
  přepíná `plugins/native-chrome.client.ts` podle události `focus-changed`).
- **Tažení okna** — `data-drag-region` na horních lištách a hlavičkách;
  `main.css` z něj dělá `-webkit-app-region: drag`. Taková plocha nedostane
  žádnou událost myši, proto se ovládací prvky v ní vracejí na `no-drag`.
- **Persistence okna** — velikost a pozici ukládá `desktop/window.ts` do
  `.window-state.json` v podpůrné složce appky.
- **Nejmenší velikost okna** je `MIN_WINDOW_SIZE` v `desktop/window-size.ts`;
  z jeho šířky bere `lint:scales` nejmenší zlom.

---

## 2. Layout

```
┌──────────────┬───────────────────────────────┐
│ ● ● ●        │  hlavička stránky              │
│ (A) Firma    │                                │
│     IČO …    │                                │
│ [+ Vytvořit ⌘N]                               │
│   Přehled    │   obsah stránky (roluje)       │
│  Doklady     │                                │
│   Faktury  3 │                                │
│   Výdaje     │                                │
│  Evidence    │                                │
│   Odběratelé │                                │
│   Ceník      │                                │
│              │                                │
│   Integrace  │  stav / počet    Zrušit  Uložit│  ← patička stránky
│   Nastavení  │                                │
└──────────────┴───────────────────────────────┘
```

Rozvržení drží `src/layouts/default.vue` (panel) a třídy `.page`,
`.page-header`, `.page-body`, `.detail-*` v `src/assets/css/main.css` (stránka).

- **Panel s textovými řádky** přes celou šířku sloupce (`UNavigationMenu`).
  Ikonová lišta tu nefunguje: účetní appka nemá pro „Odběratele" ani „Ceník"
  ikonu, kterou by šlo poznat bez popisku.
- **Nahoře dodavatel** — avatar, jméno a IČO, které jde kliknutím zkopírovat.
- **„Vytvořit"** (⌘N) je jediné pole se značkovou barvou v panelu — a je to
  **akce, ne cesta**. Otevře nabídku nových záznamů (`QUICK_NEW_ITEMS`
  v `constants/quicknew.ts`).
- **Sekce** jsou jedna tabulka v `src/constants/palette.ts`, ze které čte panel
  i paleta. Dvě skupiny: napřed to, co vzniká každý den (Doklady), pak evidence,
  ze které se doklady plní. Přehled stojí mimo skupiny. Odznak u sekce (titulek
  a která hodnota z `useMenuStats`) stojí v téže tabulce.
- **Integrace a Nastavení dole** se nerolují se seznamem. Napojení na cizí služby
  (Fio, MCP) žije v Integracích, ne jako další oddíl v Nastavení.
- **Vybraný řádek** se pozná zesvětlenou plochou a plným kontrastem textu, ne
  barevným polem.
- **Stránka** má nahoře hlavičku a pod ní rolující tělo; roluje jen tělo, nikdy
  okno.
    - **Výpisy** mají v hlavičce hledání a tlačítko palety, dole patičku s počtem
      záznamů, stavovou hláškou (`StatusbarFeedback`) a akcemi („Přidat …",
      „Načíst doklad").
    - **Detail a formuláře** (`.detail-page`) mají hlavičku i patičku
      (`.detail-footer`) plovoucí nad tělem s přechodem do pozadí. Patička nese
      stavovou hlášku a akce stránky, poslední u pravé hrany je hlavní.
- **Jedno „Uložit" na stránku, v patičce.** Celá stránka je `UForm` a „Uložit"
  je jeho `type="submit"`, takže validace a hlášky u polí proběhnou stejně jako
  po Enteru. Tlačítko nese `data-save` a ⌘S ho mačká.
- **Výsledek akce hlásí patička**, ne řádek v obsahu — obsah pak neposkakuje
  podle toho, co se zrovna povedlo.
- **Verze appky a přepínač vzhledu** jsou v Nastavení
  (`components/settings/AppearanceToggle.vue`).

---

## 3. Klávesové zkratky a menu

Zkratky registruje `defineShortcuts()`; pravidla (`usingInput`, plachta pod
modalem, kdo klávesu vlastní) jsou v [AGENTS.md](../AGENTS.md).

| Zkratka | Kde                              | Akce                                                             |
| ------- | -------------------------------- | ---------------------------------------------------------------- |
| ⌘P      | všude (`app.vue`)                | paleta příkazů                                                   |
| ⌘N      | všude (`app.vue`)                | nová faktura                                                     |
| ⌘,      | všude (`app.vue`)                | Nastavení                                                        |
| ⌘S      | všude (`app.vue`)                | zmáčknout „Uložit" stránky (`data-save`)                         |
| ⌘W / ⌘Q | nativní menu (`desktop/menu.ts`) | zavřít okno / ukončit; rozepsané změny chrání potvrzovací dialog |

> **Pravidlo:** zkratka ukázaná v rozhraní (`UKbd`) musí fungovat. Seznam
> zkratek, který lže, je horší než žádný.

Nativní menu obsahuje nabídky aplikace, souboru, úprav, zobrazení a okna;
vývojářské nástroje jsou v Zobrazení jen mimo zabalenou appku. Vlastní položka
Ukončit zavírá okno přes stejnou ochranu rozepsaných změn jako ⌘W a stejnou
ochranou projde i ukončení z Docku.

---

## 4. Paleta příkazů (⌘P)

Jedno centrované okno, ze kterého se ovládá celá appka
(`components/CommandPalette.vue`).

- **Hledání přes akce i objekty** — sekce, „Nová faktura", faktury (podle čísla
  i odběratele), odběratelé, položky ceníku.
- **Ovládání:** psaní filtruje, ↑/↓ procházejí, `Enter` potvrdí, `Esc` zavře.
  Patka palety ty klávesy vypisuje.
- **Vybraná položka** se pozná stejně jako řádek v panelu, ne barevným polem —
  v seznamu, kterým se projíždí šipkami, by barva blikala.
- Index se staví **v paměti z composables**, žádný index na disku.

---

## 5. Typografie

- **Systémový font** (SF Pro), vyhlazení `antialiased`.
- **Čísla vždy tabulární** a v tabulkách zarovnaná doprava. Účetní výpis, ve
  kterém tancují číslice, se nedá číst.
- Stupně písma jsou po jednom pixelu a pro čísla, která se čtou první (částka na
  Přehledu, vykázáno z limitu), jsou dva větší stupně s vlastním prostrkáním.

---

## 6. Tokeny a barvy

Hodnoty tokenů (poloměry, písmo, výšky, zlomy, barvy pro světlý i tmavý režim)
jsou jen v `src/assets/css/main.css` (`@theme`, `:root`, `.dark`) — tenhle
dokument je neopisuje. Záměr za nimi:

- **Poloměry jsou nízko** u všeho, co leží ve stránce: oddělení nese linka, ne
  obrys. Velké zaoblení mají jen plovoucí plochy.
- **Výšky po dvou pixelech.** Nová hodnota mimo stupně znamená, že chybí stupeň.
- **Dvě palety, světlá a tmavá**, obě plnohodnotné a na stejných rolích.
  Neutrály jsou čistě neutrální (R = G = B). Plochy se liší tónem jen nepatrně,
  aby se pracovní plocha nepletla s panelem; oddělení dělá linka.
- **Akcent je zelený** — identita Fakturianu a zároveň barva „zaplaceno".
- **Červená patří jen chybám a po splatnosti.** Potvrzovací tlačítka nesou
  akcent a mazání jen podbarvení; kdyby plnou červenou nesla i destruktivní
  akce, přestala by barva něco znamenat.

---

## 7. Chování

- **Výběr textu** vypnutý na UI chromu, povolený v datových polích a přes třídu
  `.selectable`.
- **Kontextové menu prohlížeče** zakázané mimo datová pole
  (`plugins/context-menu.client.ts`), `overscroll-behavior: none`.
- **Vzhled podle systému** s přepínačem v Nastavení; přepíná `useColorMode()`
  (třída `.dark` na `<html>`).
- **Odezva na stisk** — ztlumení tlačítka na `:active`. Bez ní tlačítko „nic
  neudělá", dokud akce nedoběhne, a u ARESu nebo Fio to jsou vteřiny.
- **Krátké přechody** na barvách tlačítek; řádky tabulek a panelu bez přechodu —
  reakce na najetí má být okamžitá.
- **Nativní notifikace** po synchronizaci plateb z Fio.

---

## 8. Nuxt UI se přemapuje, ne nahrazuje

Formuláře stojí na Nuxt UI (UInput, UButton, USelect, UModal, UForm) — knihovně
stylem „moderní web". Přepsat komponenty na holé prvky by znamenalo přijít
o validaci formulářů a přístupnost, které tam fungují.

- `main.css` mapuje proměnné Nuxt UI (`--ui-bg`, `--ui-border`, `--ui-text` …)
  na tokeny appky.
- Společný vzhled komponent (varianty, sloty) nastavuje `src/app.config.ts`.
- Vlastní třídy ze slovníku designu (`.ftable`, `.form-grid`, `.state` …)
  používají místa, kde by komponenta jen překážela.

Ovládací prvky kreslí stránka; formulářové prvky AppKitu ani systémové sklo
v okně nejsou. Nativní je jen vibrancy pod průhlednou stránkou.
