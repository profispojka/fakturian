import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { MIN_WINDOW_SIZE } from '../desktop/window-size.ts';
import { noops, offenders, scaleIndex } from '../tools/lint/check-tailwind-scales.ts';

const floor = MIN_WINDOW_SIZE.width;
const index = scaleIndex(readFileSync(new URL('../src/assets/css/main.css', import.meta.url), 'utf8'), floor);

const found = (source: string) => offenders(source, index).map((hit) => `${hit.found} → ${hit.want}`);

// Appka má všechny barvy jako aliasy na tokeny režimu; barvu s vlastní hodnotou zkouší vlastní vzorek.
const literalIndex = scaleIndex('@theme {\n\t--color-paper-text: rgb(0 0 0 / 0.16);\n}', floor);

describe('rejstřík škál', () => {
	it('čte stupně písma z @theme', () => {
		expect(index.text.get('13px')).toBe('text-ui');
		expect(index.text.get('18px')).toBe('text-stat');
	});

	it('nebere doplňky stupně jako samostatný stupeň', () => {
		// `--text-stat--line-height: 1` popisuje stupeň `text-stat`; kdyby se zapsal jako stupeň, hlásila
		// by kontrola `text-[1]`.
		expect(index.text.get('1')).toBeUndefined();
	});

	it('odliší barvu s vlastní hodnotou od aliasu na token appky', () => {
		expect(index.alias.get('ink-2')).toBe('ink-2');
		expect(literalIndex.literal.get('rgb(000/0.16)')).toBe('paper-text');
	});

	it('přečte @theme s odsazenou závorkou, komentářem a deklarací na jednom řádku', () => {
		const theme = scaleIndex(
			'@media screen {\n  @theme { /* } */ --text-ui: 13px; --radius-card: 8px; }\n}',
			floor,
		);
		expect([...theme.text]).toEqual([['13px', 'text-ui']]);
		expect([...theme.radius]).toEqual([['8px', 'card']]);
	});
});

describe('nálezy', () => {
	it('hlásí stupeň písma zapsaný v pixelech', () => {
		expect(found('<p class="text-[18px]">x</p>')).toEqual(['text-[18px] → text-stat']);
	});

	it('hlásí poloměr a řádkování ze škály', () => {
		expect(found('<p class="rounded-[10px] leading-[1.45]">x</p>')).toEqual([
			'rounded-[10px] → rounded-row',
			'leading-[1.45] → leading-prose',
		]);
	});

	it('pozná barvu i přes rozdílný zápis mezer', () => {
		const hits = offenders('<rect class="fill-[rgb(0_0_0/0.16)]" />', literalIndex);
		expect(hits.map((hit) => `${hit.found} → ${hit.want}`)).toEqual(['fill-[rgb(0_0_0/0.16)] → fill-paper-text']);
	});

	it('hlásí token psaný přes var(), na který je pojmenovaná utilita', () => {
		expect(found('<p class="text-(--ink-2) border-(--line-soft)">x</p>')).toEqual([
			'text-(--ink-2) → text-ink-2',
			'border-(--line-soft) → border-line-soft',
		]);
	});

	it('nabídne modifikátor krytí místo ručního color-mix', () => {
		expect(found('@apply bg-[color-mix(in_srgb,var(--pane)_90%,transparent)];')).toEqual([
			'bg-[color-mix(…pane 90%…)] → bg-pane/90',
		]);
	});

	it('mlčí o hodnotě, na kterou žádný token není', () => {
		expect(found('<p class="min-h-[54px] text-[9px] bg-[position:right_8px_center]">x</p>')).toEqual([]);
	});

	it('mlčí nad zdrojem, který škály dodržuje', () => {
		expect(found('<p class="text-stat text-ink-2 rounded-row leading-prose">x</p>')).toEqual([]);
	});

	it('vede řádek, na kterém nález stojí', () => {
		expect(offenders('<p>ok</p>\n<p class="text-[18px]">x</p>', index)[0]?.line).toBe(2);
	});
});

describe('zlomy', () => {
	it('bere nejužší okno z `MIN_WINDOW_SIZE`', () => {
		// Kdyby se hodnota nenašla, byla by nula a kontrola mrtvých zlomů by tiše nehlásila nic — proto
		// aserce na číslo, ne jen na „je definováno".
		expect(floor).toBe(760);
	});

	it('hlásí zlom pod hranicí okna jako mrtvý, ne jako přejmenování', () => {
		expect(found('<div class="min-[561px]:grid-cols-2">x</div>')).toEqual([
			`min-[561px]: → smazat — vždycky pravda, okno se pod ${floor} px nezmenší`,
		]);
	});

	it('pozná i mrtvý zlom přesně na hranici', () => {
		expect(found(`<div class="min-[${floor}px]:grid-cols-2">x</div>`)).toHaveLength(1);
	});

	it('nabídne jméno zlomu, na který token je', () => {
		expect(found('<div class="min-[820px]:grid-cols-2">x</div>')).toEqual(['min-[820px]: → split:']);
	});

	it('spáruje max- s tokenem o pixel výš', () => {
		expect(found('<div class="max-[959px]:max-w-80">x</div>')).toEqual(['max-[959px]: → max-wide:']);
	});

	it('mlčí o zlomu nad hranicí, na který token není', () => {
		expect(found('<div class="min-[1400px]:grid-cols-4">x</div>')).toEqual([]);
	});

	it('mlčí o zlomech psaných jménem', () => {
		expect(found('<div class="split:grid-cols-2 wide:grid-cols-3 max-wide:max-w-80">x</div>')).toEqual([]);
	});

	it('hlásí výchozí zlom Tailwindu', () => {
		expect(found('<div class="md:grid-cols-2 2xl:hidden">x</div>')).toEqual([
			'md: → split: nebo wide: — výchozí zlomy jsou jen kvůli Nuxt UI',
			'2xl: → split: nebo wide: — výchozí zlomy jsou jen kvůli Nuxt UI',
		]);
	});
});

describe('utility, které preflight už nuluje', () => {
	const noop = (source: string) => noops(source).map((hit) => `${hit.line}: ${hit.found}`);

	it('hlásí je na obyčejném elementu', () => {
		expect(noop('<ul class="list-none m-0 flex">\n<li class="border-0 px-0" /></ul>')).toEqual([
			'1: list-none',
			'1: m-0',
			'2: border-0',
			'2: px-0',
		]);
	});

	it('mlčí o nich s vykřičníkem, za variantou a na komponentě Nuxt UI', () => {
		expect(noop('<div class="m-0! split:p-0" />\n<UButton class="p-0" />')).toEqual([]);
	});
});
