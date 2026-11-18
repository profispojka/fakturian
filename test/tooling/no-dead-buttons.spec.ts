import { globSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// Tlačítko bez akce vypadá funkčně, ale nedělá nic — dokud fičura není hotová, je skryté.
// Komentáře se vybílí (ne smažou), aby seděly řádky v hlášce.
const blank = (match: string) => match.replace(/[^\n]/g, ' ');

const stripComments = (source: string) =>
	source
		.replace(/<!--[\s\S]*?-->/g, blank)
		.replace(/\/\*[\s\S]*?\*\//g, blank)
		.replace(/\/\/[^\n]*/g, blank);

const templateOf = (source: string) => stripComments(source).replace(/<(script|style)\b[\s\S]*?<\/\1>/g, blank);

const scriptOf = (source: string) =>
	[...stripComments(source).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

// Konec otevírací značky — přeskakuje '>' uvnitř hodnot atributů (`@click="a > b ? x() : y()"`).
function openTagEnd(source: string, start: number): number {
	let quote = '';
	for (let i = start; i < source.length; i++) {
		const char = source[i];
		if (quote) {
			if (char === quote) quote = '';
		} else if (char === '"' || char === "'") {
			quote = char;
		} else if (char === '>') {
			return i;
		}
	}
	return source.length;
}

const attrsOf = (tag: string): Map<string, string> => {
	const attrs = new Map<string, string>();
	for (const match of tag.matchAll(/([@:#a-zA-Z][\w.:@[\]-]*)(?:=(?:"([^"]*)"|'([^']*)'))?/g)) {
		attrs.set(match[1]!, match[2] ?? match[3] ?? '');
	}
	return attrs;
};

const NOOP = /^(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>\s*(?:\{\s*\}|undefined|null|void 0)$/;

const isNoop = (expression: string): boolean => {
	const code = stripComments(expression).replace(/\s+/g, ' ').trim().replace(/;$/, '');
	return code === '' || ['undefined', 'null', 'noop', 'void 0', '{}'].includes(code) || NOOP.test(code);
};

// Handler jako holý identifikátor — dohledej ho ve <script> a koukni, jestli má prázdné tělo.
function resolvesToEmptyFn(expression: string, script: string): boolean {
	const name = expression.trim();
	if (!/^[\w$]+$/.test(name)) return false;
	const declaration = new RegExp(
		`(?:const|let|var)\\s+${name}\\s*(?::[^=]+)?=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[\\w$]+)\\s*(?::[^=]*)?=>\\s*\\{([\\s\\S]*?)\\n?\\}|function\\s+${name}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n?\\}`,
	);
	const match = declaration.exec(script);
	if (!match) return false;
	return (match[1] ?? match[2] ?? '').trim() === '';
}

// UDropdownMenu, UPopover i UPagination obsluhují klik na tlačítku uvnitř samy (trigger, as-child), handler netřeba.
function insideDropdown(template: string, index: number): boolean {
	let depth = 0;
	for (const match of template.matchAll(/<(\/?)(?:UDropdownMenu|UPopover|UPagination)\b/g)) {
		if (match.index > index) break;
		depth += match[1] ? -1 : 1;
	}
	return depth > 0;
}

// Spouštěč UCollapsible = první potomek výchozího slotu (as-child); tlačítka v `#content` výjimku nemají.
function isCollapsibleTrigger(template: string, index: number): boolean {
	const open = template.lastIndexOf('<UCollapsible', index);
	if (open === -1) return false;
	const between = template.slice(openTagEnd(template, open) + 1, index);
	return /^\s*(?:<template\s+(?:#default|v-slot(?::default)?)\b[^>]*>)?\s*$/.test(between);
}

const HANDLER = /^(?:@|v-on:)click(?:\.|$)/;
// Odkaz i submit akci mají.
const NAVIGATES = ['href', ':href', 'to', ':to'];

// Zavírací slot Modal obaluje DialogClose s `as-child`, takže handler dodá Nuxt UI.
function isModalCloseTrigger(template: string, index: number): boolean {
	const modal = template.lastIndexOf('<UModal', index);
	const slot = template.lastIndexOf('<template', index);
	if (modal === -1 || slot < modal || template.slice(modal, index).includes('</UModal>')) return false;
	const end = openTagEnd(template, slot);
	const attributes = attrsOf(template.slice(slot, end));
	return (attributes.has('#close') || attributes.has('v-slot:close')) && template.slice(end + 1, index).trim() === '';
}

// Trvale zakázané tlačítko (`:disabled="true"`) nic nepředstírá — klik na něj nejde; dynamické
// `:disabled="podminka"` omluvenku nedostane, to je pořád tlačítko, které má někdy fungovat.
const isAlwaysDisabled = (attrs: Map<string, string>): boolean =>
	attrs.get(':disabled')?.trim() === 'true' || (attrs.has('disabled') && attrs.get('disabled') === '');

function deadButtons(source: string): string[] {
	const template = templateOf(source);
	const script = scriptOf(source);
	const offenders: string[] = [];

	for (const match of template.matchAll(/<(UButton|button)(?=[\s/>])/g)) {
		const start = match.index;
		const tag = template.slice(start, openTagEnd(template, start));
		const line = template.slice(0, start).split('\n').length;
		const attrs = attrsOf(tag);
		const handler = [...attrs].find(([name]) => HANDLER.test(name));

		if (!handler) {
			const excused =
				isAlwaysDisabled(attrs) ||
				NAVIGATES.some((name) => attrs.has(name)) ||
				attrs.get('type') === 'submit' ||
				[...attrs.keys()].some((name) => name.startsWith('v-bind')) ||
				insideDropdown(template, start) ||
				isModalCloseTrigger(template, start) ||
				isCollapsibleTrigger(template, start);
			if (!excused) offenders.push(`řádek ${line}: <${match[1]}> bez click handleru`);
			continue;
		}

		const [name, expression] = handler;
		if (isNoop(expression) || resolvesToEmptyFn(expression, script)) {
			offenders.push(`řádek ${line}: ${name}="${expression}" nic nedělá`);
		}
	}

	return offenders;
}

const vueFiles = globSync('src/**/*.vue').toSorted();

describe('žádná mrtvá tlačítka', () => {
	it('žádná šablona nemá tlačítko bez akce', () => {
		const offenders = vueFiles.flatMap((file) =>
			deadButtons(readFileSync(file, 'utf8')).map((offender) => `${file}: ${offender}`),
		);
		expect(
			offenders,
			`${offenders.join('\n')}\nKaždé tlačítko má handler, navigaci, type="submit", nebo je skryté — dokud fičura není hotová, tlačítko se nezobrazuje.`,
		).toEqual([]);
	});
});

// Detektor si hlídá sám sebe: omluvenka, která zabere víc, než má, umlčí celý guardrail — než se
// `type` přestalo brát jako submit u každé značky, prošlo repo se třinácti mrtvými tlačítky.
const vue = (template: string, script = '') =>
	`<script setup lang="ts">${script}</script>\n<template>${template}</template>`;

describe('detektor mrtvých tlačítek', () => {
	it.each([
		['zavírací slot jiné komponenty', vue('<Other><template #close><UButton>Zavřít</UButton></template></Other>')],
		['tlačítko v těle modálu', vue('<UModal><template #body><UButton>Export</UButton></template></UModal>')],
		['tlačítko bez handleru', vue('<UButton color="primary">Export</UButton>')],
		['prázdná šipka', vue('<UButton loading-auto @click="() => {}">Export</UButton>')],
		['prázdný výraz', vue('<UButton @click="">Export</UButton>')],
		['handler s prázdným tělem', vue('<UButton @click="onExport">Export</UButton>', 'const onExport = () => {};')],
		[
			'handler jen s komentářem',
			vue('<UButton @click="onExport">Export</UButton>', 'const onExport = () => {\n// TODO\n};'),
		],
		['nativní tlačítko bez handleru', vue('<button class="p-2">Export</button>')],
		['podmíněně zakázané tlačítko', vue('<UButton :disabled="isFull">Export</UButton>')],
	] as const)('hlásí %s', (_label, source) => {
		expect(deadButtons(source)).toHaveLength(1);
	});

	it.each([
		[
			'zavírací slot modálu',
			vue('<UModal><template #close="{ ui }"><UButton :class="ui.close()">Zavřít</UButton></template></UModal>'),
		],
		[
			'dlouhý zápis zavíracího slotu',
			vue('<UModal><template v-slot:close><UButton>Zavřít</UButton></template></UModal>'),
		],
		['volání funkce', vue('<UButton @click="onSave">X</UButton>', 'const onSave = () => save();')],
		['emit v šabloně', vue(`<UButton @click="emit('close')">X</UButton>`)],
		['odkaz', vue('<UButton to="/cms/faq">Zpět</UButton>')],
		['odkaz mimo router', vue('<UButton href="/neco">X</UButton>')],
		['submit v formuláři', vue('<button type="submit">X</button>')],
		['submit Nuxt UI ve formuláři', vue('<UButton type="submit" loading-auto>Uložit</UButton>')],
		[
			'trigger menu Nuxt UI',
			vue('<UDropdownMenu :items="items"><UButton icon="i-x" aria-label="Akce" /></UDropdownMenu>'),
		],
		['trigger popoveru Nuxt UI', vue('<UPopover><UButton icon="i-x" aria-label="Akce" /></UPopover>')],
		[
			'spouštěč UCollapsible',
			vue('<UCollapsible><template #default><UButton block>Sekce</UButton></template></UCollapsible>'),
		],
		['tlačítko v komentáři', vue('<!-- <UButton>X</UButton> -->')],
		['trvale zakázané tlačítko', vue('<UButton :disabled="true">Přihlášeno</UButton>')],
		['zakázané nativní tlačítko', vue('<button disabled>Přihlášeno</button>')],
	] as const)('mlčí na %s', (_label, source) => {
		expect(deadButtons(source)).toEqual([]);
	});
});
