import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

import { blankLineAroundMultilineStatements } from '../../tools/lint/rules/blank-line-around-multiline-statements.ts';
import { complexity } from '../../tools/lint/rules/complexity.ts';
import { maxEmits } from '../../tools/lint/rules/max-emits.mjs';
import { noComposablesOutsideRoot } from '../../tools/lint/rules/no-composables-outside-root.mjs';
import { noDelete } from '../../tools/lint/rules/no-delete.ts';
import { noIife } from '../../tools/lint/rules/no-iife.ts';
import { noProvideInject } from '../../tools/lint/rules/no-provide-inject.ts';

RuleTester.describe = describe;
RuleTester.it = it;

new RuleTester({
	languageOptions: {
		parserOptions: {
			lang: 'ts',
		},
	},
}).run('no-composables-outside-root', noComposablesOutsideRoot, {
	valid: [
		{
			name: 'modulová inicializace v TypeScriptu je mimo rozsah pravidla',
			filename: 'src/utils/examDevice.ts',
			code: 'import { useLocalStorage } from "@vueuse/core"; export const examDeviceId = useLocalStorage("den:examDeviceId", () => crypto.randomUUID());',
		},
		{
			name: 'kořen běžného modulu není omezený na Vue soubory',
			filename: 'src/utils/example.ts',
			code: 'const state = useState("shared"); const route = Nuxt.useRoute();',
		},
		{
			name: 'celá složka plugins dovoluje composables i ve vnořených callbackách',
			filename: 'src/plugins/api.ts',
			code: 'defineNuxtPlugin(app => app.runWithContext(() => useAuth())); function action() { useRoute(); }',
		},
		{
			name: 'výjimka plugins platí i v podsložce a na Windows',
			filename: 'C:\\repo\\src\\plugins\\nested\\auth.ts',
			code: 'const callback = () => useAuth();',
		},
		{
			name: 'kořen script setup včetně podmínky a použití výsledku v handleru',
			filename: 'src/components/example.vue',
			code: 'const router = useRouter(); if (enabled) useHead({ title: "Detail" }); const save = () => router.push("/");',
		},
		{
			name: 'deklarovaný composable',
			code: 'export function useExample() { return useRoute(); }',
		},
		{
			name: 'šipkový composable',
			code: 'export const useExample = () => useRoute();',
		},
		{
			name: 'Nuxt plugin i route middleware mají vlastní kořen',
			code: 'defineNuxtPlugin(() => useAuth()); defineNuxtRouteMiddleware(() => useAuth());',
		},
		{
			name: 'objektový plugin a Vue setup',
			code: 'defineNuxtPlugin({ setup() { useAuth(); } }); defineComponent({ setup: () => useRoute() });',
		},
		{
			name: 'inline route middleware jako funkce i pole',
			code: 'definePageMeta({ middleware: () => useAuth() }); definePageMeta({ middleware: [() => useAuth()] });',
		},
		{
			name: 'useOverlay zůstává povolené i v callbacku nebo utilitě',
			code: 'function confirm() { return useOverlay(); } watch(flag, () => useOverlay());',
		},
		{
			name: 'výjimka platí i pro alias importu useOverlay',
			code: 'import { useOverlay as overlay } from "#imports"; function confirm() { return overlay(); }',
		},
		{
			name: 'importovaný běžný název useOverlay nestíní',
			code: 'import { useOverlay as overlay } from "#imports"; const useExample = () => { const overlay = () => 1; return overlay(); };',
		},
		{
			name: 'běžné funkce a reaktivní primitiva jsou mimo rozsah pravidla',
			code: 'function save() { const state = ref(0); return computed(() => state.value); }',
		},
	],
	invalid: [
		{
			name: 'podobný název složky není výjimkou plugins',
			filename: 'src/plugins-other/api.ts',
			code: 'const callback = () => useAuth();',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useAuth',
					},
				},
			],
		},
		{
			name: 'výjimka API nepovolí jiné composables v témže souboru',
			filename: 'src/utils/api/api.ts',
			code: 'export const api = () => useRoute();',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useRoute',
					},
				},
			],
		},
		{
			name: 'výjimka API nepovolí jiné funkce v témže souboru',
			filename: 'src/utils/api/api.ts',
			code: 'export const getClient = () => useNuxtApp().$api;',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useNuxtApp',
					},
				},
			],
		},
		{
			name: 'API accessor vyžaduje přesnou cestu souboru',
			filename: 'src/utils/api/api.ts.other',
			code: 'export const api = () => useNuxtApp().$api;',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useNuxtApp',
					},
				},
			],
		},
		{
			name: 'API accessor nepovolí funkční deklaraci',
			filename: 'src/utils/api/api.ts',
			code: 'export function api() { return useNuxtApp().$api; }',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useNuxtApp',
					},
				},
			],
		},
		{
			name: 'API accessor nepovolí argumenty useNuxtApp',
			filename: 'src/utils/api/api.ts',
			code: 'export const api = () => useNuxtApp("other").$api;',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useNuxtApp',
					},
				},
			],
		},
		{
			name: 'API accessor musí vracet vlastnost',
			filename: 'src/utils/api/api.ts',
			code: 'export const api = () => useNuxtApp();',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useNuxtApp',
					},
				},
			],
		},
		{
			name: 'API accessor nepovolí computed přístup k vlastnosti',
			filename: 'src/utils/api/api.ts',
			code: 'export const api = () => useNuxtApp()["$api"];',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useNuxtApp',
					},
				},
			],
		},
		{
			name: 'API accessor nepovolí jinou vlastnost',
			filename: 'src/utils/api/api.ts',
			code: 'export const api = () => useNuxtApp().$config;',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useNuxtApp',
					},
				},
			],
		},
		{
			name: 'API accessor vyžaduje přímý výraz místo bloku',
			filename: 'src/utils/api/api.ts',
			code: 'export const api = () => { return useNuxtApp().$api; };',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useNuxtApp',
					},
				},
			],
		},
		{
			name: 'API accessor musí být pojmenovaná proměnná',
			filename: 'src/utils/api/api.ts',
			code: 'export default () => useNuxtApp().$api;',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useNuxtApp',
					},
				},
			],
		},
		{
			name: 'API accessor musí být const',
			filename: 'src/utils/api/api.ts',
			code: 'export let api = () => useNuxtApp().$api;',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useNuxtApp',
					},
				},
			],
		},
		{
			name: 'API accessor musí být exportovaný',
			filename: 'src/utils/api/api.ts',
			code: 'const api = () => useNuxtApp().$api;',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useNuxtApp',
					},
				},
			],
		},
		{
			name: 'handler v komponentě',
			filename: 'src/components/example.vue',
			code: 'const save = () => useRouter().push("/");',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useRouter',
					},
				},
			],
		},
		{
			name: 'vnořená funkce composable',
			code: 'export function useExample() { return () => useRoute(); }',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useRoute',
					},
				},
			],
		},
		{
			name: 'název use vnořenou funkci nepovýší na kořen',
			code: 'export function useExample() { function useNested() { return useRoute(); } return useNested; }',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useRoute',
					},
				},
			],
		},
		{
			name: 'pojmenovaný callback není samostatný composable',
			filename: 'src/components/example.vue',
			code: 'watch(flag, function useCallback() { return useRoute(); });',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useRoute',
					},
				},
			],
		},
		{
			name: 'computed a watcher callback',
			code: 'export function useExample() { computed(() => useRoute()); watch(flag, () => useAuth()); }',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useRoute',
					},
				},
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useAuth',
					},
				},
			],
		},
		{
			name: 'synchronní map v setupu je také vnořená funkce',
			filename: 'src/components/example.vue',
			code: 'const media = categories.map(category => useMedia(category));',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useMedia',
					},
				},
			],
		},
		{
			name: 'callback modulové inicializace zůstává vnořenou funkcí',
			filename: 'src/utils/example.ts',
			code: 'export const device = useLocalStorage("device", () => useRoute().path);',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useRoute',
					},
				},
			],
		},
		{
			name: 'utilita je běžná funkce, i když se volá ze setupu',
			code: 'export const api = () => useNuxtApp().$api;',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useNuxtApp',
					},
				},
			],
		},
		{
			name: 'mimo plugins runWithContext zákaz nezruší',
			code: 'defineNuxtPlugin(app => app.runWithContext(() => useAuth()));',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useAuth',
					},
				},
			],
		},
		{
			name: 'callback uvnitř middleware',
			code: 'definePageMeta({ middleware: [() => watch(flag, () => useAuth())] });',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useAuth',
					},
				},
			],
		},
		{
			name: 'přejmenovaný import',
			code: 'import { useRoute as getRoute } from "#imports"; function save() { return getRoute(); }',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useRoute',
					},
				},
			],
		},
		{
			name: 'jiný composable přejmenovaný na useOverlay výjimku nedostane',
			code: 'import { useRoute as useOverlay } from "#imports"; function save() { return useOverlay(); }',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useRoute',
					},
				},
			],
		},
		{
			name: 'namespace i statická computed property',
			code: 'function save() { Vue.useAttrs(); Nuxt["useRoute"](); }',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useAttrs',
					},
				},
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useRoute',
					},
				},
			],
		},
		{
			name: 'typový cast volané funkce',
			code: 'function save() { (useRoute as () => object)(); }',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useRoute',
					},
				},
			],
		},
		{
			name: 'metoda setup v obyčejném objektu není kořen',
			code: 'const options = { setup() { useRoute(); } };',
			errors: [
				{
					messageId: 'outsideRoot',
					data: {
						name: 'useRoute',
					},
				},
			],
		},
	],
});

new RuleTester({
	languageOptions: {
		parserOptions: {
			lang: 'ts',
		},
	},
}).run('max-emits', maxEmits, {
	valid: [
		{
			name: 'přesně tři explicitní události a libovolné modely',
			code: "defineModel('first'); defineModel('second'); defineModel('third'); defineModel('fourth'); defineEmits<{ save: []; close: []; retry: [] }>();",
		},
		{
			name: 'adresní blok má dva emity a dva nezapočítané modely',
			code: "defineModel<Address>(); defineModel<number>('ruianId'); defineEmits<{ select: [address: Address]; manual: [manual: boolean] }>();",
		},
		{
			name: 'přetížení stejné události se nepočítá víckrát',
			code: "defineEmits<{ (e: 'save', value: string): void; (e: 'save', value: number): void; (e: 'close'): void; (e: 'retry'): void }>();",
		},
		{
			name: 'volání emit není další deklarace',
			code: "const emit = defineEmits(['save', 'close', 'retry']); emit('save'); emit('save');",
		},
		{
			name: 'payload ani jiný objekt s emits nejsou rozhraní komponenty',
			code: "defineEmits<{ save: [value: { a: string; b: string; c: string; d: string }] }>(); const config = { emits: ['a', 'b', 'c', 'd'] };",
		},
		{
			name: 'konfigurovatelný limit',
			code: "defineEmits(['a', 'b', 'c', 'd']);",
			options: [{ max: 4 }],
		},
	],
	invalid: [
		{
			name: 'čtyři události v pojmenovaných tuplech',
			code: 'defineEmits<{ save: []; close: []; retry: []; remove: [] }>();',
			errors: [
				{
					messageId: 'tooMany',
					data: {
						count: 4,
						max: 3,
					},
				},
			],
		},
		{
			name: 'sedm přetížení hlásí jednu chybu',
			code: "defineEmits<{ (e: 'close'): void; (e: 'download'): void; (e: 'downloadForSigning'): void; (e: 'uploadSigned', file: File): void; (e: 'startNia'): void; (e: 'startDenSign'): void; (e: 'previewSource'): void }>();",
			errors: [
				{
					messageId: 'tooMany',
					data: {
						count: 7,
						max: 3,
					},
				},
			],
		},
		{
			name: 'unie názvů v přetížení',
			code: "defineEmits<{ (e: 'a' | 'b' | 'c' | 'd'): void }>();",
			errors: [
				{
					messageId: 'tooMany',
					data: {
						count: 4,
						max: 3,
					},
				},
			],
		},
		{
			name: 'lokální typový alias',
			code: 'type Events = { save: []; close: []; retry: []; remove: [] }; defineEmits<Events>();',
			errors: [
				{
					messageId: 'tooMany',
					data: {
						count: 4,
						max: 3,
					},
				},
			],
		},
		{
			name: 'lokální rozhraní',
			code: 'interface Events { save: []; close: []; retry: []; remove: [] } defineEmits<Events>();',
			errors: [
				{
					messageId: 'tooMany',
					data: {
						count: 4,
						max: 3,
					},
				},
			],
		},
		{
			name: 'zděděné lokální rozhraní',
			code: 'interface Base { save: []; close: [] } interface Events extends Base { retry: []; remove: [] } defineEmits<Events>();',
			errors: [
				{
					messageId: 'tooMany',
					data: {
						count: 4,
						max: 3,
					},
				},
			],
		},
		{
			name: 'funkční typ s unií názvů událostí',
			code: "defineEmits<(e: 'a' | 'b' | 'c' | 'd') => void>();",
			errors: [
				{
					messageId: 'tooMany',
					data: {
						count: 4,
						max: 3,
					},
				},
			],
		},
		{
			name: 'explicitně deklarované update události se počítají',
			code: "defineEmits<{ 'update:value': [value: string]; save: []; close: []; retry: [] }>();",
			errors: [
				{
					messageId: 'tooMany',
					data: {
						count: 4,
						max: 3,
					},
				},
			],
		},
		{
			name: 'runtime pole',
			code: "defineEmits(['a', 'b', 'c', 'd']);",
			errors: [
				{
					messageId: 'tooMany',
					data: {
						count: 4,
						max: 3,
					},
				},
			],
		},
		{
			name: 'runtime objekt s validátory',
			code: 'defineEmits({ save: null, close: null, retry: null, remove: null });',
			errors: [
				{
					messageId: 'tooMany',
					data: {
						count: 4,
						max: 3,
					},
				},
			],
		},
		{
			name: 'Options API v defineComponent',
			code: "defineComponent({ emits: ['a', 'b', 'c', 'd'] });",
			errors: [
				{
					messageId: 'tooMany',
					data: {
						count: 4,
						max: 3,
					},
				},
			],
		},
		{
			name: 'Options API v default exportu',
			code: 'export default { emits: { save: null, close: null, retry: null, remove: null } };',
			errors: [
				{
					messageId: 'tooMany',
					data: {
						count: 4,
						max: 3,
					},
				},
			],
		},
		{
			name: 'nulový limit nezapočítá model',
			code: "defineModel('value'); defineEmits<{ close: [] }>();",
			options: [{ max: 0 }],
			errors: [
				{
					messageId: 'tooMany',
					data: {
						count: 1,
						max: 0,
					},
				},
			],
		},
	],
});

const multilineConst = ['const columns = [', "\t'name',", '];'].join('\n');

new RuleTester().run('blank-line-around-multiline-statements', blankLineAroundMultilineStatements, {
	valid: [
		{
			name: 'jednořádkové příkazy zůstávají pohromadě',
			code: ['const route = useRoute();', 'const gid = route.params.id;'].join('\n'),
		},
		{
			name: 'víceřádkový příkaz už oddělený prázdným řádkem',
			code: ['const route = useRoute();', '', multilineConst, '', 'const gid = route.params.id;'].join('\n'),
		},
		{
			name: 'blok importů rovná oxfmt',
			code: ['import {', '\tref,', "} from 'vue';", "import dayjs from 'dayjs';"].join('\n'),
		},
		{
			name: 'do těla funkce pravidlo nesahá',
			code: ['function load() {', '\tconst a = 1;', '\tif (a) {', '\t\treturn;', '\t}', '}'].join('\n'),
		},
	],
	invalid: [
		{
			name: 'víceřádkový příkaz nalepený z obou stran',
			code: ['const route = useRoute();', multilineConst, 'const gid = route.params.id;'].join('\n'),
			output: ['const route = useRoute();', '', multilineConst, '', 'const gid = route.params.id;'].join('\n'),
			errors: [
				{
					messageId: 'missing',
					line: 2,
				},
				{
					messageId: 'missing',
					line: 5,
				},
			],
		},
		{
			name: 'komentář nad příkazem zůstává u něj',
			code: ['const route = useRoute();', '// Sloupce se za běhu nemění.', multilineConst].join('\n'),
			output: ['const route = useRoute();', '', '// Sloupce se za běhu nemění.', multilineConst].join('\n'),
			errors: [{ messageId: 'missing' }],
		},
		{
			name: 'komentář za předchozím příkazem zůstává na jeho řádku',
			code: ['const route = useRoute(); // identita z routy', multilineConst].join('\n'),
			output: ['const route = useRoute(); // identita z routy', '', multilineConst].join('\n'),
			errors: [{ messageId: 'missing' }],
		},
	],
});

new RuleTester().run('no-iife', noIife, {
	valid: [
		{
			name: 'pojmenovaná funkce volaná zvlášť',
			code: ['const load = async () => {};', 'load();'].join('\n'),
		},
		{
			name: 'callback předaný jiné funkci',
			code: 'items.map((item) => item.id);',
		},
	],
	invalid: [
		{
			name: 'šipka volaná v místě definice',
			code: '(() => {})();',
			errors: [{ messageId: 'iife' }],
		},
		{
			name: 'async funkce volaná v místě definice',
			code: '(async function () {})();',
			errors: [{ messageId: 'iife' }],
		},
	],
});

new RuleTester().run('no-delete', noDelete, {
	valid: [
		{
			name: 'vynechání pole destrukturalizací',
			code: 'const { removed, ...remaining } = source;',
		},
		{
			name: 'metoda delete a vlastnost stejného jména zůstávají povolené',
			code: "items.delete(key); const actions = { delete: 'Smazat' }; actions.delete;",
		},
	],
	invalid: [
		{
			name: 'smazání pojmenované vlastnosti',
			code: 'delete source.removed;',
			errors: [{ messageId: 'forbidden' }],
		},
		{
			name: 'smazání dynamické vlastnosti uvnitř výrazu',
			code: 'const removed = delete source[key];',
			errors: [{ messageId: 'forbidden' }],
		},
		{
			name: 'smazání přes optional chaining',
			code: 'delete source?.removed;',
			errors: [{ messageId: 'forbidden' }],
		},
	],
});

new RuleTester().run('no-provide-inject', noProvideInject, {
	valid: [
		{
			name: 'template ref zůstává povolený',
			code: "const element = useTemplateRef('element');",
		},
		{
			name: 'Nuxt plugin vrací provide jako vlastnost',
			code: 'export default () => ({ provide: { api } });',
		},
	],
	invalid: [
		{
			name: 'inject',
			code: "const value = inject('key');",
			errors: [
				{
					messageId: 'forbidden',
					data: {
						name: 'inject',
					},
				},
			],
		},
		{
			name: 'provide',
			code: "provide('key', value);",
			errors: [
				{
					messageId: 'forbidden',
					data: {
						name: 'provide',
					},
				},
			],
		},
		{
			name: 'volání přes namespace',
			code: "Vue.provide('key', value);",
			errors: [
				{
					messageId: 'forbidden',
					data: {
						name: 'provide',
					},
				},
			],
		},
	],
});

new RuleTester({
	languageOptions: {
		parserOptions: {
			lang: 'ts',
		},
	},
}).run('complexity', complexity, {
	valid: [
		{
			name: 'optional chaining, ?? a výchozí parametr nevětví',
			code: 'const label = (x = {}) => x?.a?.b?.c ?? x?.d ?? "—";',
			options: [{ max: 1 }],
		},
		{
			name: '&& a || při skládání hodnoty jsou data',
			code: 'const fields = (m) => [{ value: m.a && format(m.a) }, { value: m.b || m.c }, { hidden: !m.d && !m.e }];',
			options: [{ max: 1 }],
		},
		{
			name: 'vnořená funkce má vlastní složitost',
			code: 'function outer(xs) { if (xs) return xs.map((x) => { if (x) return 1; return 2; }); return []; }',
			options: [{ max: 2 }],
		},
	],
	invalid: [
		{
			name: 'podmínky, cykly, case a catch',
			code: 'function f(x) { if (x.a) return 1; for (const y of x.l) { try { y(); } catch { return 2; } } switch (x.t) { case 1: return 3; case 2: return 4; default: return x.b ? 5 : 6; } }',
			options: [{ max: 6 }],
			errors: [
				{
					messageId: 'tooComplex',
					data: {
						count: 7,
						max: 6,
					},
				},
			],
		},
		{
			name: '&& a || v podmínce a jako samostatný příkaz',
			code: 'function f(x) { if (x.a && (x.b || !x.c)) return 1; x.ok && run(); while (x.n || x.m) x.n--; }',
			options: [{ max: 5 }],
			errors: [
				{
					messageId: 'tooComplex',
					data: {
						count: 7,
						max: 5,
					},
				},
			],
		},
	],
});
