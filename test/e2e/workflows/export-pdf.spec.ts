import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from '@playwright/test';

import { fixtureVault, test } from '../app.ts';

test.describe('uložení PDF faktury ve skutečné desktopové aplikaci', () => {
	test('zkopíruje PDF z vaultu do cíle, který uživatel vybral', async ({ dir, launch }) => {
		const number = '20260001';
		const vault = fixtureVault(dir, { invoice: true });
		const target = join(dir, `export-${number}.pdf`);
		const { app, page } = await launch(vault);
		// Ukládací panel macOS sada neovládá; hlavní proces dostane cíl, jako by ho uživatel vybral.
		await app.evaluate(({ dialog }, filePath) => {
			dialog.showSaveDialog = () =>
				Promise.resolve({
					canceled: false,
					filePath,
				});
		}, target);

		await page.getByTestId('menu-section/invoice').click();
		await expect(page.getByTestId(`invoice-entry-${number}`).getByTestId('invoice-row')).toHaveText(number);
		await page.getByTestId(`invoice-actions-${number}`).click();
		await page.getByTestId(`invoice-action-download-${number}`).click();

		await expect.poll(() => existsSync(target)).toBe(true);
		expect(readFileSync(target).equals(readFileSync(join(vault, 'faktury', `${number}.pdf`)))).toBe(true);
	});
});
