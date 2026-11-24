import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

import { noConditionalInTest } from '../../tools/lint/rules/no-conditional-in-test.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

new RuleTester({
	languageOptions: {
		parserOptions: {
			lang: 'ts',
		},
	},
}).run('no-conditional-in-test', noConditionalInTest, {
	valid: [
		{
			name: 'reaktivní posluchač sleduje stav přes špeha',
			code: 'it("watch", () => { watch(loading, value => { if (!value) observed(rows); }); expect(observed).toHaveBeenCalled(); });',
		},
		{
			name: 'kód v prohlížeči smí podmíněně pracovat s DOM',
			code: 'test("focus", async ({ page }) => { await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); }); expect(true).toBe(true); });',
		},
		{
			name: 'výchozí hodnota přes ??',
			code: 'it("default", () => { expect(value ?? fallback).toBe(1); });',
		},
		{
			name: 'příprava mimo test',
			code: 'beforeEach(() => { if (flag) prepare(); }); it("example", () => expect(value).toBe(1));',
		},
		{
			name: 'samostatný helper mimo test',
			code: 'function helper() { return flag ? 1 : 2; } it("example", () => expect(helper()).toBe(1));',
		},
		{
			name: 'parametr zastíní test',
			code: 'function helper(test) { test("example", () => { if (flag) prepare(); }); }',
		},
		{
			name: 'metoda jiného objektu není test',
			code: 'other.test("example", () => { if (flag) prepare(); });',
		},
		{
			name: 'vi.fn implementace mocku',
			code: 'it("mock", () => { const mock = vi.fn(value => { if (value) return 1; return 0; }); expect(mock(true)).toBe(1); });',
		},
		{
			name: 'přejmenovaný vi import',
			code: 'import { vi as mocker, it } from "vitest"; it("mock", () => { mocker.fn(value => value ? 1 : 0); });',
		},
		{
			name: 'factory vi.mock',
			code: 'it("mock", () => { vi.mock("service", () => ({ read: () => flag && value })); });',
		},
		{
			name: 'mockImplementationOnce',
			code: 'it("mock", () => { service.read.mockImplementationOnce(() => flag ? 1 : 2); });',
		},
		{
			name: 'vnořená metoda v návratové hodnotě mocku',
			code: 'it("mock", () => { service.read.mockReturnValue({ value() { if (flag) return 1; return 0; } }); });',
		},
		{
			name: 'factory Nuxt mocku',
			code: 'it("mock", () => { mockNuxtImport("useAuth", () => () => flag ? first : second); });',
		},
		{
			name: 'Playwright predicate i handler',
			code: 'import { test } from "@playwright/test"; test("mock", async ({ page }) => { await page.route(url => first && second, route => { if (flag) return route.fulfill({}); return route.fallback(); }); });',
		},
		{
			name: 'mock na kontextu prohlížeče',
			code: 'test("mock", async ({ page }) => { await page.context().route("**", route => flag ? route.fulfill({}) : route.fallback()); });',
		},
		{
			name: 'WebSocket mock včetně vnořeného handleru',
			code: 'test("mock", async ({ page }) => { await page.routeWebSocket("**", socket => { socket.onMessage(message => { if (message) socket.send("ok"); }); }); });',
		},
		{
			name: 'typovaný callback mocku',
			code: 'it("mock", () => { vi.fn(((() => flag ? 1 : 2) as () => number)); });',
		},
		{
			name: 'výpočet očekávané hodnoty a vstupních dat',
			code: 'it.each([true, false])("data", flag => { const mode = flag ? first : second; const value = source ?? (flag ? first : second); service.read.mockReturnValue(flag ? first : second); expect(mode).toBe(flag ? first : second); });',
		},
		{
			name: 'predikáty URL, requestu a výběru prvků',
			code: 'test("predicate", async ({ page }) => { await page.waitForRequest(req => req.method() === "POST" && req.url().includes("save")); await expect(page).toHaveURL(url => url.pathname === "/" && url.search === ""); expect(rows.filter(row => row.active && row.visible).every(row => row.valid || row.optional)).toEqual(expected); });',
		},
		{
			name: 'listenery pouze zaznamenávají události',
			code: 'test("observer", async ({ page }) => { page.on("request", request => { if (request.method() === "GET" || !request.url().includes("api")) return; requests.push(request.url()); }); expect(requests).toEqual([]); });',
		},
		{
			name: 'měření geometrie v prohlížeči',
			code: 'test("geometry", async ({ page }) => { const size = await page.evaluate(() => { const box = document.querySelector("main"); if (!box) return null; return box.clientWidth || 1; }); expect(size).toBe(100); });',
		},
		{
			name: 'poll vrací měřenou hodnotu',
			code: 'it("poll", async () => { await expect.poll(() => flag ? 1 : 2).toBe(1); });',
		},
		{
			name: 'vlastní mock wrapper stubRepresentations',
			code: 'test("mock", async ({ page }) => { await stubRepresentations(page, request => { if (request.implicit) return confirmed; return count++ === 0 ? unavailable : denied; }); });',
		},
		{
			name: 'validační callback host komponenty',
			code: 'it("validation", () => { defineComponent({ setup() { return () => h(Form, { validate: () => { if (valid) return []; return [error]; } }); } }); });',
		},
		{
			name: 'sběr porušení guardrailu s povinnou koncovou asercí',
			code: 'it("scanner", () => { for (const file of files) { const source = read(file); if (file.endsWith("vue")) { const template = parse(source); if (!template) continue; if (invalid(template)) violations.push(file); } else { for (const script of scripts(source)) { if (invalid(script)) violations.push(file); } } } expect(violations).toEqual([]); });',
		},
		{
			name: 'pomocná serializace a výběr datových refů',
			code: 'it("data", () => { const text = JSON.stringify(model, (key, value) => { if (typeof value === "number") keys.push(key); return key === "gid" ? undefined : value; }); for (const value of Object.values(state)) { if (typeof value === "function") continue; expect(value.value).toBe(false); } });',
		},
		{
			name: 'tabulátor hledá fokus s povinnou koncovou kontrolou',
			code: 'test("focus", async ({ page }) => { for (let i = 0; i < 8 && !(await option.evaluate(el => el === document.activeElement)); i++) await page.keyboard.press("Tab"); await expect(option).toBeFocused(); });',
		},
		{
			name: 'if pouze přepočítá lokální hodnotu',
			code: 'it("path", () => { let path = first; if (type === "Uok") path = second; expect(read(path)).toEqual(expected); });',
		},
		{
			name: 'host komponenta simuluje chybovou stránku',
			code: 'it("page", () => { defineComponent({ setup() { if (route.path === deniedPath) throw forbidden(); return () => h("main"); } }); });',
		},
	],
	invalid: [
		{
			name: 'ani posluchač nesmí podmínit aserci',
			code: 'it("watch", () => { watch(value, current => { if (current) expect(current).toBe(true); }); });',
			errors: 1,
		},
		{
			name: 'ani kód prohlížeče nesmí podmínit aserci',
			code: 'test("browser", async ({ page }) => { await page.evaluate(() => { if (visible) expect(visible).toBe(true); }); });',
			errors: 1,
		},
		{
			name: 'if ve Vitestu',
			code: 'import { it } from "vitest"; it("example", () => { if (flag) expect(value).toBe(1); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'if v Playwrightu',
			code: 'import { test } from "@playwright/test"; test("example", async ({ page }) => { if (flag) await page.goto("/"); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'přejmenovaný import testu',
			code: 'import { test as scenario } from "@playwright/test"; scenario("example", () => { if (flag) run(); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'namespace import Vitestu',
			code: 'import * as suite from "vitest"; suite.it("example", () => { if (flag) run(); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'namespace import Playwrightu',
			code: 'import * as suite from "@playwright/test"; suite.test("example", () => { if (flag) run(); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'test.each',
			code: 'it.each([true, false])("example", flag => { if (flag) run(); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'tagged template each',
			code: 'it.each`flag\ntrue`("example", ({ flag }) => { if (flag) run(); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'modifikátory testu',
			code: 'test.concurrent.only("example", () => { if (flag) run(); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'typovaný test callback',
			code: 'it("example", (() => { if (flag) run(); }) as () => void);',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'logické &&',
			code: 'it("example", () => { flag && run(); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'logické ||',
			code: 'it("example", () => { run() || fallback(); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'switch',
			code: 'it("example", () => { switch (mode) { case 1: run(); break; default: fallback(); } });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'ternár vybírá testovanou akci',
			code: 'it("example", async () => { await (flag ? select(person) : clear()); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'běžný vnořený helper není mock',
			code: 'it("example", () => { function helper() { if (flag) run(); } helper(); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'běžný callback není mock',
			code: 'it("example", () => { rows.forEach(row => { if (row) run(); }); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'asercí v callbacku se zákaz neobejde',
			code: 'test("example", async ({ page }) => { page.on("request", request => { if (flag) expect(request).toBeDefined(); }); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'akce v callbacku se zákaz neobejde',
			code: 'it("example", async () => { rows.map(async row => { if (row) await input.setValue("value"); }); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'podmíněná příprava mocku zůstává viditelná',
			code: 'it("example", () => { if (flag) service.read.mockRejectedValueOnce(error); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'mock nevyjme zbytek testu',
			code: 'it("example", () => { vi.fn(() => flag ? 1 : 2); if (flag) run(); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'předčasný return přeskakuje aserce',
			code: 'it("panel", () => { expect(panel.exists()).toBe(visible); if (!visible) return; expect(panel.text()).toBe("Ready"); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'podmíněná mutace testovaného stavu',
			code: 'it("context", () => { if (changed) state.value.context = other; expect(state.value).toEqual(expected); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'guard podmíněného kroku bez duplicitního hlášení &&',
			code: 'it("example", () => { if (admin && active) expect(button.exists()).toBe(true); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'podmíněná aserce ve smyčce není datový skener',
			code: 'it("example", () => { for (const item of items) { if (item.active) expect(item.valid).toBe(true); } });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'asercí v datovém ternáru se zákaz neobejde',
			code: 'it("example", () => { const value = flag ? expect(first).toBe(1) : expect(second).toBe(2); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'return v predikátu nesmí vynechat aserci',
			code: 'it("example", () => { rows.map(row => { if (!row.active) return; expect(row.valid).toBe(true); }); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'logický výraz podmíněně mění testovaný stav',
			code: 'it("example", () => { flag && (state.value = other); expect(state.value).toBe(other); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'podmíněné volání SUT není pouhé přiřazení hodnoty',
			code: 'it("example", () => { let result; if (flag) result = run(); expect(result).toEqual(expected); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'podmínka smyčky nesmí skrýt aserci',
			code: 'it("example", () => { for (let i = 0; i < 8 && expect(value).toBe(1); i++) run(); });',
			errors: [{ messageId: 'conditional' }],
		},
		{
			name: 'await testované akce zůstává viditelný i v hodnotě',
			code: 'it("example", async () => { const result = flag ? await run() : null; expect(result).toBe(expected); });',
			errors: [{ messageId: 'conditional' }],
		},
	],
});
