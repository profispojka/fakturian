import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from '@playwright/test';

import { fixtureVault, test } from '../app.ts';

test.describe('převzetí dokladů z cizího systému', () => {
	test('přesune syntetická PDF beze změny a načte vložený ISDOC', async ({ dir, launch }) => {
		const vault = fixtureVault(dir, { adopt: true });
		const source = join(vault, 'Vydaná faktura - 2026017.pdf');
		const target = join(vault, 'faktury', '2026017.pdf');
		const sourceBytes = readFileSync(source);
		const { page } = await launch(vault);

		await page.getByTestId('menu-section/invoice').click();
		// Nabídka visí i na Přehledu; výběr období má jen výpis faktur.
		await expect(page.getByTestId('date-period')).toBeVisible();
		await expect(page.getByTestId('adopt-candidate')).toHaveCount(3);
		// Pořadí řádků se neověřuje, jen jejich obsah; částky formátuje `Intl` s nezlomitelnou mezerou.
		const candidates = await page.getByTestId('adopt-candidate').allInnerTexts();
		expect(candidates.map((text) => text.replaceAll('\u00A0', ' ')).toSorted()).toEqual([
			'2026017 · Ukázková firma a.s. · 123 180,00 Kč\nVydaná faktura - 2026017.pdf',
			'2026018 · Zkušební odběratel s.r.o. · 50 000,00 Kč\nVydaná faktura - 2026018.pdf',
			'2026022 · Zkušební odběratel s.r.o. · 17 760,00 Kč\nVydaná faktura - 2026022.pdf',
		]);

		await page.getByTestId('adopt-accept').click();
		await expect(page.getByTestId('adopt-message')).toHaveText(
			'Byly převzaty 3 doklady a byli přidáni 2 odběratelé.',
		);
		expect(existsSync(source)).toBe(false);
		expect(readFileSync(target).equals(sourceBytes)).toBe(true);
		expect(readFileSync(target).subarray(0, 5).toString()).toBe('%PDF-');

		await page.getByTestId('date-period').click();
		await page.getByTestId('date-year').click();
		await page.getByTestId('date-show-year-2026').click();
		await page.getByTestId('date-pick-year').click();

		const imported = page.getByTestId('invoice-entry-2026017');
		await expect(imported.getByTestId('invoice-row')).toHaveText('2026017');
		await expect(imported.getByTestId('invoice-customer')).toHaveText('Ukázková firma a.s.');
		await imported.getByTestId('invoice-open').click();

		await expect(page.getByTestId('field-number')).toHaveValue('2026017');
		await expect(page.getByTestId('customer-summary')).toHaveText(
			'Ukázková firma a.s.IČO: 31415920·DIČ: CZ31415920Modelová 7, Ostrava 70200ucetni@ukazkova-firma.example Upravit Změnit Odebrat',
		);
		await expect(page.getByTestId('item-label')).toHaveCount(2);
		await expect(page.getByTestId('item-label').nth(0)).toHaveValue('Front-end vývoj');
		await expect(page.getByTestId('item-label').nth(1)).toHaveValue('Testování front-endu');
		await expect(page.getByTestId('total')).toHaveText('123 180,00 Kč');

		// Cizí doklad se otevře, ale archivovaný záznam hlavní proces přepsat nedovolí. Vzorky nenesou
		// jednotku, bez které formulář doklad k uložení nepustí.
		await page.getByTestId('item-unit').nth(0).fill('hod');
		await page.getByTestId('item-unit').nth(1).fill('ks');
		await page.getByTestId('field-note').fill('Dopsaná poznámka');
		await page.getByTestId('action-save').click();
		// Chyba uložení jde do toastu Nuxt UI, kam se značka nedostane; hledá se přes jeho slot.
		await expect(page.locator('li[data-slot="base"] [data-slot="description"]')).toHaveText(
			'Fakturu 2026017 vystavil Testovací fakturační systém 1.0, ne Fakturian — přepsat archivovaný doklad nejde. Ulož ji jako nový doklad s vlastním číslem.',
		);
		await expect(page.getByTestId('saved')).toHaveCount(0);
		expect(readFileSync(target).equals(sourceBytes)).toBe(true);
	});
});
