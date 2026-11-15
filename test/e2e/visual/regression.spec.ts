import { expect, type Page } from '@playwright/test';

import { type Desktop, NARROW, type Theme, WIDE, demoVault, resize, snap, test } from '../app.ts';

// Záznamy z `desktop/examples/demo-vault.ts`: faktura je bez dobropisu a neodeslaná, takže nabídka
// řádku nese všechny akce, a položka ceníku má roční limit.
const INVOICE = '20260040';
const NEXT_INVOICE = '20260041';
const UNPAID = '8';
const PRICE = 'p-udrzba';
const PRICE_USES = 7;
const CUSTOMER = 'Kovo Trade a.s.';
const EXPENSE_ID = 'e-0006';

async function section(page: Page, to: string, ready: string) {
	await page.getByTestId(`menu-section${to}`).click();
	await expect(page.getByTestId(ready)).toBeVisible();
}

async function create(page: Page, item: string, ready: string) {
	await page.getByTestId('menu-new').click();
	await page.getByTestId(`menu-new-${item}`).click();
	await expect(page.getByTestId(ready)).toBeVisible();
}

// Číslo a data doplní formulář až po dotazech do hlavního procesu a pak se přepíše celý; odběratel
// vybraný dřív by zmizel.
async function createInvoice(page: Page) {
	await create(page, 'invoice', 'field-number');
	await expect(page.getByTestId('field-number')).toHaveValue(NEXT_INVOICE);
}

async function openPriceUsage(page: Page) {
	await section(page, '/pricelist', 'price-table');
	await page.getByTestId(`price-actions-${PRICE}`).click();
	await page.getByTestId('price-show-usage').click();
	await expect(page.getByTestId('price-usage-invoice')).toHaveCount(PRICE_USES);
}

const SCREENS = {
	// Graf i limit DPH kreslí Přehled z vlastního seznamu faktur, který dobíhá po zobrazení grafu.
	dashboard: async (page) => {
		await section(page, '/', 'dashboard-revenue-chart');
		await expect(page.locator('[data-testid="overview-vat-fill"][data-level="warn"]')).toHaveCount(1);
	},
	invoices: (page) => section(page, '/invoice', 'invoices-table'),
	invoice: async (page) => {
		await section(page, '/invoice', 'invoices-table');
		await page.getByTestId(`invoice-entry-${INVOICE}`).getByTestId('invoice-open').click();
		await expect(page.getByTestId('field-number')).toHaveValue(INVOICE);
		await expect(page.getByTestId('customer-summary')).toBeVisible();
	},
	expenses: (page) => section(page, '/expense', `expense-entry-${EXPENSE_ID}`),
	customers: (page) => section(page, '/customers', 'customer-table'),
	pricelist: (page) => section(page, '/pricelist', 'price-table'),
	settings: (page) => section(page, '/settings', 'settings-appearance'),
} satisfies Record<string, (page: Page) => Promise<void>>;

type Screen = keyof typeof SCREENS;

const OVERLAYS: Record<string, (page: Page) => Promise<void>> = {
	'command-palette': async (page) => {
		await section(page, '/invoice', 'invoices-table');
		await page.getByTestId('invoice-palette').click();
		await expect(page.getByTestId(`palette-invoice-${INVOICE}`)).toBeVisible();
	},
	'invoice-actions': async (page) => {
		await section(page, '/invoice', 'invoices-table');
		await page.getByTestId(`invoice-actions-${INVOICE}`).click();
		await expect(page.getByTestId(`invoice-action-download-${INVOICE}`)).toBeVisible();
	},
	'unsaved-changes': async (page) => {
		await create(page, 'contact', 'field-name');
		await page.getByTestId('field-name').fill('Rozepsaný odběratel');
		await page.getByTestId('menu-section/customers').click();
		await expect(page.getByTestId('dialog-message')).toBeVisible();
	},
	'contact-picker': async (page) => {
		await createInvoice(page);
		await page.getByTestId('choose-customer').click();
		await expect(page.getByTestId('customer-picker-item').first()).toBeVisible();
	},
	'invoice-issue-date': async (page) => {
		await createInvoice(page);
		await page.getByTestId('field-issueDate').click();
		await expect(page.getByTestId('date-calendar')).toBeVisible();
	},
	'price-usage-year': async (page) => {
		await openPriceUsage(page);
		await page.getByTestId('price-usage-year').click();
		// Nabídku kreslí Nuxt UI, značka se do ní nedostane.
		await expect(page.getByRole('listbox')).toBeVisible();
	},
};

// Každý test pouští vlastní appku nad vlastní kopií ukázkových dat: rozepsaný doklad ani otevřená
// nabídka se do dalšího snímku nepřenesou.
async function launchLoaded(launch: (vault: string, theme?: Theme) => Promise<Desktop>, dir: string, theme: Theme) {
	const desktop = await launch(demoVault(dir), theme);
	// Odznak neuhrazených spočítá panel až po načtení všech souborů vaultu a seznamu faktur.
	await expect(desktop.page.getByTestId('menu-section/invoice').getByTestId('menu-badge')).toHaveText(UNPAID);
	return desktop;
}

// Světlý vzhled na šířku nese všechny obrazovky a jednoho zástupce každého druhu popupu; tmavý
// vzhled a úzké okno stačí ověřit na Přehledu a formuláři faktury.
const PASSES: { theme: Theme; width: number; screens: Screen[]; overlays: boolean }[] = [
	{
		theme: 'light',
		width: WIDE,
		screens: ['dashboard', 'invoices', 'invoice', 'expenses', 'customers', 'pricelist', 'settings'],
		overlays: true,
	},
	{
		theme: 'dark',
		width: WIDE,
		screens: ['dashboard', 'invoice'],
		overlays: false,
	},
	{
		theme: 'light',
		width: NARROW,
		screens: ['dashboard', 'invoice'],
		overlays: false,
	},
];

for (const { theme, width, screens, overlays } of PASSES) {
	test.describe(`vizuální regrese: ${theme}, ${width} px`, () => {
		for (const screen of screens) {
			test(`obrazovka ${screen}`, async ({ dir, launch }) => {
				const desktop = await launchLoaded(launch, dir, theme);
				await resize(desktop, width);
				await SCREENS[screen](desktop.page);
				await desktop.page.evaluate(() => {
					if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
				});
				await snap(desktop, `${screen}-${theme}-${width}`);
			});
		}

		if (!overlays) return;
		for (const [overlay, open] of Object.entries(OVERLAYS)) {
			test(`popup ${overlay}`, async ({ dir, launch }) => {
				const desktop = await launchLoaded(launch, dir, theme);
				await resize(desktop, width);
				await open(desktop.page);
				await snap(desktop, `${overlay}-${theme}-${width}`);
			});
		}
	});
}

test.describe('vizuální regrese: stavy po zápisu', () => {
	test('po uložení nové faktury nabídne e-mail (light)', async ({ dir, launch }) => {
		const desktop = await launchLoaded(launch, dir, 'light');
		const { page } = desktop;
		await resize(desktop, WIDE);
		await createInvoice(page);
		await page.getByTestId('choose-customer').click();
		// Hledání nechá jediného odběratele; výběr pořadím by při dalším kontaktu vzal jiného.
		await page.getByTestId('customer-picker-search').fill(CUSTOMER);
		await expect(page.getByTestId('customer-picker-name')).toHaveText([CUSTOMER]);
		await page.getByTestId('customer-picker-item').click();
		// Číselné pole zapíše hodnotu až při odchodu z pole.
		await page.getByTestId('item-price').fill('1500');
		await page.getByTestId('item-price').press('Tab');
		await page.getByTestId('item-quantity').fill('2');
		await page.getByTestId('item-quantity').press('Tab');
		await page.getByTestId('item-label').fill('Konzultace k architektuře');
		await page.getByTestId('action-save').click();
		// Otázka na e-mail přijde až po zápisu PDF.
		await expect(page.getByTestId('mail-no')).toBeVisible({ timeout: 60_000 });
		await snap(desktop, `email-light-${WIDE}`);
	});
});
