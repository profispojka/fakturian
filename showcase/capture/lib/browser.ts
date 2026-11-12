/**
 * Otevření „scény" — prohlížeč nastavený tak, aby ze stejného configu vypadl
 * pokaždé stejný obrázek.
 *
 * Playwright se importuje z **cwd projektu**, ne odsud: toolkit se kopíruje do
 * repa webu a `playwright` je jeho devDependency.
 */
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { logger } from './util.ts';

import type { BrowserContextOptions, chromium, Page } from 'playwright';

const log = logger('stage');
const require = createRequire(path.join(process.cwd(), 'noop.ts'));

export interface StageConfig {
	baseUrl?: string;
	viewport?: { width: number; height: number };
	deviceScaleFactor?: number;
	colorScheme?: 'light' | 'dark';
	initScripts?: string[];
	fixedTime?: string;
	headed?: boolean;
	locale?: string;
	timezoneId?: string;
	freezeMotion?: boolean;
	recordVideo?: BrowserContextOptions['recordVideo'];
	initValues?: Record<string, unknown>;
	ready?: string | ((page: Page) => unknown);
	applyTheme?: (page: Page, scheme: 'light' | 'dark') => unknown;
	accent?: string;
	cameraTarget?: string;
	mark?: string;
	prepare?: (page: Page) => unknown;
	[key: string]: unknown;
}

interface SettleOptions {
	ready?: StageConfig['ready'];
	timeout?: number;
	quiet?: number;
}

function loadPlaywright(): { chromium: typeof chromium } {
	try {
		return require('playwright');
	} catch {
		try {
			return require('@playwright/test');
		} catch {
			throw new Error(
				'Chybí playwright. V adresáři webu spusť:\n' +
					'  bun add -d playwright && bunx playwright install chromium',
			);
		}
	}
}

// `fileURLToPath`, ne `url.pathname` — jinak se cesta s mezerou v názvu složky
// rozbije o %20 a runtime se do stránky nedostane.
const RUNTIME = path.join(path.dirname(fileURLToPath(import.meta.url)), 'stage-runtime.ts');

function browserScript(file: string): string {
	return stripTypeScriptTypes(readFileSync(file, 'utf8'), { sourceUrl: file });
}

/** Otevře deterministické Chromium; initScripts obsahuje harness a demo data. */
export async function openStage(cfg: StageConfig = {}) {
	const { chromium } = loadPlaywright();
	const viewport = cfg.viewport ?? {
		width: 1440,
		height: 900,
	};

	const browser = await chromium.launch({
		headless: !cfg.headed,
		args: [
			// Bez `--lang` renderuje Chromium nativní ovládací prvky (datum, číslo)
			// v angličtině, i když má kontext český `locale` — a na screenshotu je
			// pak „09/30/2026" místo „30. 9. 2026".
			`--lang=${cfg.locale ?? 'cs-CZ'}`,
			'--force-color-profile=srgb',
			'--font-render-hinting=none',
			'--disable-lcd-text',
			'--hide-scrollbars',
			'--disable-features=IsolateOrigins',
		],
	});

	const context = await browser.newContext({
		viewport,
		deviceScaleFactor: cfg.deviceScaleFactor ?? 2,
		colorScheme: cfg.colorScheme ?? 'light',
		locale: cfg.locale ?? 'cs-CZ',
		timezoneId: cfg.timezoneId ?? 'Europe/Prague',
		reducedMotion: cfg.freezeMotion === false ? 'no-preference' : 'reduce',
		recordVideo: cfg.recordVideo,
	});

	// Runtime první, harness až po něm — harness může chtít `window.__stage`.
	await context.addInitScript({ content: browserScript(RUNTIME) });
	for (const file of cfg.initScripts ?? []) {
		const script = path.resolve(process.cwd(), file);
		await context.addInitScript({ content: browserScript(script) });
	}
	if (cfg.initValues) {
		await context.addInitScript((values: Record<string, unknown>) => {
			// Po klíčích, ne spreadem: `window` je globální objekt, nahradit se nedá.
			for (const [key, value] of Object.entries(values)) window[key] = value;
		}, cfg.initValues);
	}

	const page = await context.newPage();

	if (cfg.fixedTime) {
		// Stálé datum = stálé screenshoty. `resume()` nechá čas běžet dál od
		// zadaného okamžiku, aby appce nezamrzly timery.
		await page.clock.install({ time: new Date(cfg.fixedTime) });
		await page.clock.resume();
	}

	page.on('console', (m) => {
		if (m.type() === 'error') log.warn('console:', m.text());
	});
	page.on('pageerror', (e) => log.warn('pageerror:', e.message));

	return {
		browser,
		context,
		page,
		cfg,
		viewport,
		theme: cfg.colorScheme ?? 'light',
	};
}

export type Stage = Awaited<ReturnType<typeof openStage>>;

/** Navigace + čekání, až je appka opravdu k focení. */
export async function gotoPath(stage: Stage, to: string, opts: SettleOptions = {}) {
	const { page, cfg } = stage;
	const url = /^https?:/.test(to) ? to : new URL(to, cfg.baseUrl).href;
	await page.goto(url, {
		waitUntil: 'networkidle',
		timeout: opts.timeout ?? 30_000,
	});
	await settle(stage, opts);
	return url;
}

/** Počká na hotové načtení dat, fonty a doběhnutý layout. */
export async function settle(stage: Stage, opts: SettleOptions = {}) {
	const { page, cfg } = stage;
	const ready = opts.ready ?? cfg.ready;
	if (typeof ready === 'string') {
		await page.waitForSelector(ready, {
			state: 'visible',
			timeout: opts.timeout ?? 20_000,
		});
	} else if (typeof ready === 'function') {
		await ready(page);
	}
	// Motiv se drží ve třídě na `<html>` nebo v localStorage — obojí zmizí
	// s novým dokumentem, takže se musí obnovit po **každé** navigaci.
	if (cfg.applyTheme) await cfg.applyTheme(page, stage.theme ?? cfg.colorScheme ?? 'light');
	await page.evaluate(() => document.fonts?.ready);
	await page.evaluate((o) => window.__stage?.init(o), {
		accent: cfg.accent,
		cameraTarget: cfg.cameraTarget,
		mark: cfg.mark,
		freezeMotion: cfg.freezeMotion !== false,
	});
	if (cfg.prepare) await cfg.prepare(page);
	await page.waitForTimeout(opts.quiet ?? 250);
}

/** Přepnutí motivu bez restartu prohlížeče (světlá i tmavá varianta obrázků). */
export async function setTheme(stage: Stage, scheme: 'light' | 'dark') {
	stage.theme = scheme;
	await stage.page.emulateMedia({ colorScheme: scheme });
	if (stage.cfg.applyTheme) await stage.cfg.applyTheme(stage.page, scheme);
	await stage.page.waitForTimeout(150);
}

export async function closeStage(stage: Stage) {
	await stage.context.close();
	await stage.browser.close();
}
