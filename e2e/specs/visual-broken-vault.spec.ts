import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from '@playwright/test';

import { WIDE, resize, snap, test } from '../app.ts';

test.describe('vizuální regrese nečitelné datové složky', () => {
	test('start skončí na chybové obrazovce (light)', async ({ dir, launch }) => {
		const vault = join(dir, 'vault');
		mkdirSync(join(vault, '.fakturian'), { recursive: true });
		writeFileSync(join(vault, '.fakturian', 'nastaveni.json'), '{');
		const desktop = await launch(vault);
		await resize(desktop, WIDE);
		await expect(desktop.page.getByTestId('start-error')).toBeVisible();
		await snap(desktop, `start-error-light-${WIDE}`);
	});
});
