import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from '@playwright/test';

import { fixtureVault, test } from '../app.ts';

test.describe('selhání zápisu ve skutečné desktopové aplikaci', () => {
	test('ohlásí odpojený vault a nevydává neuloženou fakturu za hotovou', async ({ dir, launch }) => {
		const vault = fixtureVault(dir);
		const { page } = await launch(vault);

		await page.getByTestId('menu-new').click();
		await page.getByTestId('menu-new-invoice').click();
		// Číslo doplní formulář po dotazu do hlavního procesu a pak se přepíše celý; odběratel vybraný
		// dřív by zmizel.
		const number = '20260001';
		await expect(page.getByTestId('field-number')).toHaveValue(number);

		await page.getByTestId('choose-customer').click();
		// Hledání nechá jediného odběratele; výběr pořadím by při dalším kontaktu ve fixture vzal jiného.
		await page.getByTestId('customer-picker-search').fill('E2E odběratel');
		await expect(page.getByTestId('customer-picker-name')).toHaveText(['E2E odběratel']);
		await page.getByTestId('customer-picker-item').click();

		// Číselné pole zapíše hodnotu až při odchodu z pole.
		await page.getByTestId('item-price').fill('100');
		await page.getByTestId('item-price').press('Tab');
		await page.getByTestId('item-quantity').fill('1');
		await page.getByTestId('item-quantity').press('Tab');
		await page.getByTestId('item-label').fill('Zápis do odpojeného vaultu');
		rmSync(vault, {
			recursive: true,
			force: true,
		});

		await page.getByTestId('action-save').click();
		// Chyba uložení jde do toastu Nuxt UI, kam se značka nedostane; hledá se přes jeho slot.
		await expect(page.locator('li[data-slot="base"] [data-slot="description"]')).toHaveText(
			`Datová složka ${vault} neexistuje.`,
		);
		await expect(page.getByTestId('saved')).toHaveCount(0);
		expect(existsSync(join(vault, 'faktury', `${number}.pdf`))).toBe(false);
	});
});
