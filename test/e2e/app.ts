import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron, type ElectronApplication, expect, type Page, test as base } from '@playwright/test';

import { E2E_TODAY } from './constants.ts';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Postavená appka pro sadu; `nuxt generate` složku při každém sestavení smaže celou.
export const E2E_APP = join(ROOT, '.output-e2e', 'app');
export const DEMO_VAULT = join(ROOT, '.output-e2e', 'demo-vault');

export type Theme = 'light' | 'dark';

export const WIDE = 1100;
// Užší okno appka nepustí (`MIN_WINDOW_SIZE` v `desktop/window-size.ts`).
export const NARROW = 760;
export const MAX_MISMATCH = 0.01;

export interface Desktop {
	app: ElectronApplication;
	page: Page;
}

// Kopie syntetického vaultu z `e2e/fixtures/vault`; každý test dostane vlastní, aby jeho výsledek
// nezávisel na tom, co zapsal jiný.
export function fixtureVault(dir: string, { invoice = false, adopt = false } = {}): string {
	const vault = join(dir, 'vault');
	cpSync(join(ROOT, 'e2e', 'fixtures', 'vault'), vault, { recursive: true });
	// Faktura `RRRR0001` uložená stejnou cestou jako v appce, takže PDF i vložený ISDOC mají její tvar.
	if (invoice) execFileSync('node', ['desktop/examples/run.ts', 'e2e-invoice', vault, E2E_TODAY], { cwd: ROOT });
	// Vzorky leží mimo `faktury/`, aby je appka nabídla k převzetí; vystavil je dodavatel z fixture.
	if (adopt) cpSync(join(ROOT, 'desktop', 'test', 'fixtures', 'adopt'), vault, { recursive: true });
	return vault;
}

// Ukázková data z `desktop/examples/demo-vault.ts`, vygenerovaná jednou za běh v `e2e/global-setup.ts`.
export function demoVault(dir: string): string {
	const vault = join(dir, 'vault');
	cpSync(DEMO_VAULT, vault, { recursive: true });
	return vault;
}

export const test = base.extend<{
	// Dočasná složka testu. Domov appky v ní drží uloženou datovou složku, stav okna, log i socket MCP,
	// jehož cesta se musí vejít do 104 bajtů `sun_path` — proto krátké `/tmp`, ne `os.tmpdir()`.
	dir: string;
	launch: (vault: string, theme?: Theme) => Promise<Desktop>;
}>({
	dir: async ({}, use) => {
		const dir = mkdtempSync('/tmp/fe2e-');
		await use(dir);
		rmSync(dir, {
			recursive: true,
			force: true,
		});
	},
	launch: async ({ dir }, use, testInfo) => {
		const home = join(dir, 'home');
		const launched: Desktop[] = [];
		await use(async (vault, theme = 'light') => {
			const support = join(home, 'Library', 'Application Support', 'com.fakturian.desktop');
			mkdirSync(support, { recursive: true });
			writeFileSync(join(support, 'fakturian.json'), JSON.stringify({ vaultPath: vault }));
			// `FAKTURIAN_E2E` appka bere jen mimo balíček: okno se ukáže bez aktivace a Fio token drží
			// v paměti, ne v klíčence toho, kdo sadu pouští. Pevné měřítko dá stejné snímky na Retině i bez ní.
			const app = await _electron.launch({
				args: ['--force-device-scale-factor=1', E2E_APP],
				cwd: ROOT,
				env: {
					...process.env,
					HOME: home,
					FAKTURIAN_E2E: '1',
				},
				colorScheme: theme,
			});
			const page = await app.firstWindow();
			launched.push({
				app,
				page,
			});
			return {
				app,
				page,
			};
		});
		const failed = testInfo.status !== testInfo.expectedStatus;
		for (const { app, page } of launched) {
			if (failed && !page.isClosed()) {
				await testInfo.attach('okno', {
					body: await page.screenshot(),
					contentType: 'image/png',
				});
			}
			// Rozepsaný doklad by `app.quit()` zastavil otázkou „Zahodit?“; `exit` hlídku obejde.
			const closed = app.waitForEvent('close');
			await app.evaluate(({ app: electron }) => {
				setImmediate(() => electron.exit(0));
			});
			await closed;
		}
		const log = join(home, 'Library', 'Logs', 'com.fakturian.desktop', 'Fakturian.log');
		if (failed && existsSync(log)) {
			await testInfo.attach('Fakturian.log', {
				body: readFileSync(log),
				contentType: 'text/plain',
			});
		}
	},
});

export async function resize({ app, page }: Desktop, width: number): Promise<void> {
	const win = await app.browserWindow(page);
	await win.evaluate((w, size) => w.setSize(size, 720), width);
	await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);
}

// Na data čeká test před snímkem.
export async function snap({ app, page }: Desktop, name: string): Promise<void> {
	// Aktivní vzhled appka kreslí podle události okna (`native-chrome.client.ts`). Skutečný fokus sada
	// okno nedává, aby nebrala klávesnici tomu, kdo na stroji pracuje.
	const win = await app.browserWindow(page);
	await win.evaluate((w) => w.emit('focus'));
	await expect(page.locator('html.window-inactive')).toHaveCount(0);
	// Klik posune do záběru i kontejner s `overflow: hidden`, který se v appce jinak nehne; posunutá
	// stránka by na snímku vypadala jako rozbitá.
	await page.evaluate(() => {
		for (const el of document.querySelectorAll('*')) {
			const style = getComputedStyle(el);
			if (style.overflowX === 'hidden' || style.overflowX === 'clip') el.scrollLeft = 0;
			if (style.overflowY === 'hidden' || style.overflowY === 'clip') el.scrollTop = 0;
		}
	});
	await expect(page).toHaveScreenshot(`${name}.png`, {
		maxDiffPixelRatio: MAX_MISMATCH,
		stylePath: join(ROOT, 'e2e', 'snapshot.css'),
	});
}
