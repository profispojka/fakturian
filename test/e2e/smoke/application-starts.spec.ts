import { expect } from '@playwright/test';

import { fixtureVault, test } from '../app.ts';

test('spustí aplikaci s připravenou datovou složkou', async ({ dir, launch }) => {
	const { page } = await launch(fixtureVault(dir));
	await expect(page.getByTestId('menu-section/invoice')).toBeVisible();
});
