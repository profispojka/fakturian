import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from '@playwright/test';

import { fixtureVault, test } from '../app.ts';

test.describe('dobropis a smazání ve skutečné desktopové aplikaci', () => {
	test('vystaví dobropis, fakturu s ním nesmaže a dobropis smaže do Koše', async ({ dir, launch }) => {
		const original = '20260001';
		const credit = '20260002';
		const vault = fixtureVault(dir, { invoice: true });
		const { page } = await launch(vault);

		await page.getByTestId('menu-section/invoice').click();
		await expect(page.getByTestId(`invoice-entry-${original}`).getByTestId('invoice-row')).toHaveText(original);
		await page.getByTestId(`invoice-actions-${original}`).click();
		await page.getByTestId(`invoice-credit-${original}`).click();

		// Číslo dobropisu doplní formulář po dotazu do hlavního procesu.
		await expect(page.getByTestId('field-number')).toHaveValue(credit);
		await expect(page.getByTestId('heading')).toHaveText(`Dobropis ${credit} k faktuře ${original}`);
		await expect(page.getByTestId('item-price')).toHaveValue('-1 250,5');
		await expect(page.getByTestId('total')).toHaveText('-2 501,00 Kč');

		await page.getByTestId('field-note').fill('Vrácení za zrušenou objednávku');
		await page.getByTestId('action-save').click();
		await expect(page.getByTestId('saved')).toBeVisible({ timeout: 60_000 });
		await expect(page.getByTestId('action-save')).not.toHaveAttribute('data-saving', { timeout: 60_000 });
		await page.getByTestId('mail-no').click();

		const creditPdf = join(vault, 'faktury', `${credit}.pdf`);
		await expect.poll(() => existsSync(creditPdf)).toBe(true);
		expect(readFileSync(creditPdf).subarray(0, 5).toString()).toBe('%PDF-');

		await page.getByTestId('menu-section/invoice').click();
		await expect(page.getByTestId(`invoice-entry-${original}`).getByTestId('invoice-row')).toHaveText(original);
		const originalPdf = join(vault, 'faktury', `${original}.pdf`);
		await page.getByTestId(`invoice-actions-${original}`).click();
		await page.getByTestId(`invoice-delete-${original}`).click();
		// Chyba jde do toastu Nuxt UI, kam se značka nedostane; hledá se přes jeho slot.
		await expect(page.locator('li[data-slot="base"] [data-slot="description"]')).toHaveText(
			`Faktura ${original} má dobropis ${credit}. Nejdřív smaž dobropis.`,
		);
		await expect(page.getByTestId('dialog-confirm')).toBeHidden();
		expect(existsSync(originalPdf)).toBe(true);

		// Jediný doklad, který běh pošle do systémového Koše.
		await page.getByTestId(`invoice-actions-${credit}`).click();
		await page.getByTestId(`invoice-delete-${credit}`).click();
		await page.getByTestId('dialog-confirm').click();
		await expect.poll(() => existsSync(creditPdf)).toBe(false);
		await expect(page.getByTestId(`invoice-actions-${credit}`)).toHaveCount(0);
		expect(existsSync(originalPdf)).toBe(true);
	});
});
