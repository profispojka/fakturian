import { expect } from '@playwright/test';

import { WIDE, fixtureVault, resize, snap, test } from '../app.ts';

// Vzorky z `desktop/test/fixtures/adopt` vystavil dodavatel malého E2E vaultu; nad demo daty by je
// sken odmítl jako cizí.
test.describe('vizuální regrese nabídky převzetí dokladů', () => {
	test('výpis faktur nabídne doklady ležící ve složce (light)', async ({ dir, launch }) => {
		const desktop = await launch(fixtureVault(dir, { adopt: true }));
		const { page } = desktop;
		await resize(desktop, WIDE);
		await page.getByTestId('menu-section/invoice').click();
		// Nabídka visí i na Přehledu; výběr období má jen výpis faktur.
		await expect(page.getByTestId('date-period')).toBeVisible();
		await expect(page.getByTestId('records-loading')).toHaveCount(0);
		await expect(page.getByTestId('adopt-offer')).toBeVisible();
		await snap(desktop, `adopt-offer-light-${WIDE}`);
	});
});
