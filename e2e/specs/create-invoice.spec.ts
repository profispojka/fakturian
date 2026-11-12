import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from '@playwright/test';

import { fixtureVault, test } from '../app.ts';

test.describe('vystavení faktury přes skutečnou desktopovou aplikaci', () => {
	test('zapíše PDF do dočasného vaultu přes produkční hlavní proces', async ({ dir, launch }) => {
		const vault = fixtureVault(dir);
		const { page } = await launch(vault);

		await page.getByTestId('menu-new').click();
		await page.getByTestId('menu-new-invoice').click();
		await expect(page.getByTestId('menu-new-invoice')).toBeHidden();

		// Číslo doplní formulář po dotazu do hlavního procesu a pak se přepíše celý; odběratel vybraný
		// dřív by zmizel.
		const number = '20260001';
		await expect(page.getByTestId('field-number')).toHaveValue(number);

		await page.getByTestId('choose-customer').click();
		await page.getByTestId('customer-picker-item').click();
		await expect(page.getByTestId('customer-picker-search')).toBeHidden();

		// Číselné pole zapíše hodnotu až při odchodu z pole.
		await page.getByTestId('item-price').fill('1250,5');
		await page.getByTestId('item-price').press('Tab');
		await page.getByTestId('item-quantity').fill('2');
		await page.getByTestId('item-quantity').press('Tab');
		await page.getByTestId('item-label').fill('E2E konzultace');
		await expect(page.getByTestId('total')).toHaveText('2 501,00 Kč');

		await page.getByTestId('action-save').click();
		await expect(page.getByTestId('saved')).toBeVisible({ timeout: 60_000 });
		await expect(page.getByTestId('action-save')).not.toHaveAttribute('data-saving', { timeout: 60_000 });
		await page.getByTestId('mail-no').click();

		const pdf = join(vault, 'faktury', `${number}.pdf`);
		await expect.poll(() => existsSync(pdf)).toBe(true);
		expect(statSync(pdf).size).toBeGreaterThan(1_000);
		expect(readFileSync(pdf).subarray(0, 5).toString()).toBe('%PDF-');
	});
});
