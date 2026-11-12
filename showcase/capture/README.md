# Capture toolkit

Screenshoty a prezentační videa přímo z běžící aplikace. Žádné ruční focení,
žádný Figma mockup — na webu je vidět skutečný produkt s demo daty.

Zkopíruj celou složku do repa webu (`showcase/capture/`) a uprav configy;
je součástí projektu, ne skillu, aby se dala verzovat a doladit.

## Instalace

```bash
bun add -d playwright
bunx playwright install chromium
# ffmpeg systémově: brew install ffmpeg
```

## Tři kroky

```bash
# 1. obrázky (light + dark, výřezy, přiblížené detaily)
node capture/shoot.ts --config showcase/shots.config.ts

# 2. snímky videa podle scénáře
node capture/record.ts --scene showcase/scenes/quick-start.ts

# 3. mp4 + webm + poster (+ volitelně gif a podkres)
node capture/encode.ts --frames showcase/media/raw/quick-start --gif

# na závěr kontrola hotového webu
node capture/audit.ts --dist showcase/.output/public
```

Užitečné přepínače: `--headed` (dívat se na to, když něco nesedí),
`--only <name|group>` u `shoot.ts`, `--width`, `--music`, `--crf` u `encode.ts`.

## Jak to funguje

`lib/stage-runtime.ts` se injektuje do stránky a přidá dvě věci:

- **kameru** — zoom a posun jako CSS transform na `<body>`. Prohlížeč obsah
  pro každý snímek přerenderuje, takže i čtyřnásobné přiblížení je ostré;
  ořezávat hotový obrázek by dalo rozmazaninu.
- **overlay** — kurzor, ripple po kliknutí, titulky a title card leží mimo
  `<body>`, aby je kamera nezvětšovala. Jejich stav řídí renderer pro každý
  snímek zvlášť; žádné CSS transitions, takže nic neposkakuje.

`record.ts` video **neskládá v reálném čase**: pro každý snímek nastaví
kameru, kurzor a titulek a teprve pak fotí. Rychlost appky tím pádem nemá na
plynulost vliv a stejný scénář dá pokaždé stejné video. Renderuje se ~5–15 s
videa za minutu.

## Zápis scénáře

Jeden krok = jeden „beat". Vše je volitelné:

| pole               | co dělá                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `duration`         | délka beatu v sekundách (výchozí 1,8)                                                           |
| `card`             | `{ kicker, title, subtitle }` — celoplošný titulek                                              |
| `caption`          | titulek dole; stejný text ve dvou beatech za sebou nebliká                                      |
| `chip`             | odznak nahoře, typicky klávesová zkratka                                                        |
| `focus`            | cíl kamery: selektor, `{ selector, zoom, padding }` nebo `{ x, y, zoom }`; `null` = celý pohled |
| `click` / `hover`  | kurzor na prvek dojede a klikne (ripple se vykreslí sám)                                        |
| `type`             | `{ selector, text, clear }` — psaní po znacích                                                  |
| `press`            | klávesa (`Enter`, `ControlOrMeta+k`, …)                                                         |
| `goto`             | navigace na cestu (kamera se vrátí na celý pohled)                                              |
| `scroll`           | `{ y }` nebo `{ selector }`                                                                     |
| `at`               | kdy v rámci beatu akce proběhne (0–1, výchozí 0,45)                                             |
| `before` / `after` | vlastní krok: `async (page, stage) => {}`                                                       |
| `chapter`          | pojmenuje kapitolu (uloží se do `scene.json`)                                                   |

Titulky se automaticky ukládají jako `.vtt` vedle snímků — připoj je k videu
přes `<track kind="captions">`, ať video funguje i bez zvuku a najde ho
vyhledávač.

## Na co si dát pozor

- **Foť produkční build, ne dev server.** Dev overlay a nedonačtené chunky
  se jinak propíšou do obrázků.
- **Selektory z appky, ne z frameworku.** `[data-demo="new"]` přežije
  refaktor, `.btn-primary_x3f` ne.
- **Stálé datum** (`fixedTime`) — jinak se obrázky mění při každém běhu.
- **Snímky jsou velké.** 20 s ve 2× je ~1 GB v `media/raw/`; do gitu patří
  jen hotová videa, `raw/` dej do `.gitignore`.
- **Demo data si vymysli, ale ať sedí.** A nikdy do nich nedávej skutečné
  zákazníky, e-maily nebo čísla účtů.
