import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from '@playwright/test';

import { fixtureVault, test } from '../app.ts';

test.describe('načtení faktury po restartu desktopové aplikace', () => {
	test('najde uložené PDF a načte jeho vložený ISDOC zpět do formuláře', async ({ dir, launch }) => {
		const number = '20260001';
		const vault = fixtureVault(dir, { invoice: true });
		expect(existsSync(join(vault, 'faktury', `${number}.pdf`))).toBe(true);
		const { page } = await launch(vault);

		await page.getByTestId('menu-section/invoice').click();
		const entry = page.getByTestId(`invoice-entry-${number}`);
		await expect(entry.getByTestId('invoice-row')).toHaveText(number);
		await expect(entry.getByTestId('invoice-customer')).toHaveText('E2E odběratel');

		await entry.getByTestId('invoice-open').click();
		// Formulář stojí hned prázdný, uložený doklad do něj přijde až z hlavního procesu.
		await expect(page.getByTestId('field-number')).toHaveValue(number);
		await expect(page.getByTestId('customer-summary')).toHaveText(
			'E2E odběratelIČO: 25596641Kontrolní 2, Brno 60200odberatel@example.invalid Upravit Změnit Odebrat',
		);
		await expect(page.getByTestId('item-label')).toHaveValue('E2E konzultace');
		await expect(page.getByTestId('item-quantity')).toHaveValue('2');
		// Číslo formátuje `Intl` s nezlomitelnou mezerou mezi řády.
		await expect(page.getByTestId('item-price')).toHaveValue('1\u00A0250,5');
		await expect(page.getByTestId('total')).toHaveText('2 501,00 Kč');
	});
});
