import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from '@playwright/test';

import { WIDE, resize, snap, test } from '../app.ts';

test.describe('vizuální regrese prvního spuštění', () => {
	test('průvodce se ptá na IČO (light)', async ({ dir, launch }) => {
		// Složka bez `.fakturian/nastaveni.json` nemá dodavatele, takže appka otevře průvodce.
		const vault = join(dir, 'vault');
		mkdirSync(vault);
		const desktop = await launch(vault);
		await resize(desktop, WIDE);
		await expect(desktop.page.getByTestId('wizard-ico-form')).toBeVisible();
		await snap(desktop, `wizard-ico-light-${WIDE}`);
	});
});
