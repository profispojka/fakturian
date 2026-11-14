import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from '@playwright/test';

import { fixtureVault, test } from '../app.ts';

// Panel NSOpenPanel Playwright ovládat neumí; sada ho nahradí v hlavním procesu a zkontroluje, s čím
// ho appka otevřela.
test.describe('změna vaultu přes dialog výběru složky', () => {
	test('přepne se na vybranou prázdnou složku a tu původní nechá být', async ({ dir, launch }) => {
		const source = fixtureVault(dir, { invoice: true });
		const target = join(dir, 'switch-vault');
		mkdirSync(target);
		const invoices = readdirSync(join(source, 'faktury')).filter((name) => name.endsWith('.pdf'));
		expect(invoices).toEqual(['20260001.pdf']);
		const { app, page } = await launch(source);
		await app.evaluate(({ dialog }, folder) => {
			const opened: unknown[] = [];
			Reflect.set(globalThis, 'e2eOpenDialogs', opened);
			dialog.showOpenDialog = (...args: unknown[]) => {
				opened.push(args.at(-1));
				return Promise.resolve({
					canceled: false,
					filePaths: [folder],
				});
			};
		}, target);

		await page.getByTestId('menu-section/settings').click();
		await page.getByTestId('vault-change').click();

		// Přepnutí načte appku znovu a prázdná složka nemá dodavatele, takže nový start se na něj ptá.
		await expect(page.getByTestId('wizard')).toBeVisible();
		expect(await app.evaluate(() => Reflect.get(globalThis, 'e2eOpenDialogs'))).toEqual([
			{
				defaultPath: source,
				properties: ['openDirectory', 'createDirectory'],
			},
		]);

		// Data jsou soubory, které appka nestěhuje: ve staré složce zůstávají všechny doklady i údaje.
		for (const name of invoices) {
			expect(existsSync(join(source, 'faktury', name))).toBe(true);
			expect(existsSync(join(target, 'faktury', name))).toBe(false);
		}
		expect(existsSync(join(source, '.fakturian', 'nastaveni.json'))).toBe(true);
		expect(existsSync(join(target, '.fakturian', 'nastaveni.json'))).toBe(false);
	});
});
