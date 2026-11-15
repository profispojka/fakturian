import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, type Page } from '@playwright/test';

import { fixtureVault, ROOT, test } from '../app.ts';

interface IssuedSample {
	supplierIco: string;
	supplier: string;
	number: string;
	customer: string;
	customerIco: string;
	year: number;
	total: string;
	lines: { description: string; quantity: number; unitPriceCents: number }[];
	addedContacts: number;
}

interface ReceivedSample {
	supplier: string;
	supplierIco: string;
	number: string;
	uuid: string;
	description: string;
	amountCents: number;
	date: string;
	recipientIco: string;
	file: string;
}

interface ExternalSample {
	file: string;
	software: string;
	url: string;
	sha256: string;
	issued: IssuedSample | null;
	issuedError: string | null;
	issuedIco: string;
	received: ReceivedSample | null;
	receivedError: string | null;
}

const SAMPLES = join(ROOT, 'test', 'e2e', 'fixtures', 'external-invoices');
const samples: ExternalSample[] = JSON.parse(readFileSync(join(SAMPLES, 'manifest.json'), 'utf8'));

function externalVault(dir: string, ico: string): string {
	const vault = fixtureVault(dir);
	const path = join(vault, '.fakturian', 'nastaveni.json');
	const settings = JSON.parse(readFileSync(path, 'utf8'));
	settings.supplier.ico = ico;
	writeFileSync(path, JSON.stringify(settings));
	return vault;
}

async function openImported(page: Page, invoice: IssuedSample): Promise<void> {
	await page.getByTestId('menu-section/invoice').click();
	await page.getByTestId('date-period').click();
	await page.getByTestId('date-year').click();
	await page.getByTestId(`date-show-year-${invoice.year}`).click();
	await page.getByTestId('date-pick-year').click();
	const row = page.getByTestId(`invoice-entry-${invoice.number}`);
	await expect(row.getByTestId('invoice-customer')).toHaveText(invoice.customer);
	await row.getByTestId('invoice-open').click();
	await expect(page.getByTestId('field-number')).toHaveValue(invoice.number);
	await expect(page.getByTestId('total')).toHaveText(invoice.total);
	await expect(page.getByTestId('item-label')).toHaveCount(invoice.lines.length);
	for (const [index, line] of invoice.lines.entries()) {
		await expect(page.getByTestId('item-label').nth(index)).toHaveValue(line.description);
	}
}

test('veřejná PDF jsou nezměněné originály z manifestu', () => {
	expect(
		readdirSync(SAMPLES)
			.filter((file) => file.endsWith('.pdf'))
			.toSorted(),
	).toEqual(samples.map((sample) => sample.file).toSorted());
	for (const sample of samples) {
		const bytes = readFileSync(join(SAMPLES, sample.file));
		expect(createHash('sha256').update(bytes).digest('hex')).toBe(sample.sha256);
	}
});

for (const sample of samples) {
	test(`import původního PDF přes Nastavení: ${sample.file}`, async ({ dir, launch }) => {
		const path = join(SAMPLES, sample.file);
		const original = readFileSync(path);
		const vault = externalVault(dir, sample.issuedIco);
		const { app, page } = await launch(vault);
		// Nahrazený je jen nativní výběr souboru; renderer, IPC, parser i zápisy běží doopravdy.
		await app.evaluate(({ dialog }, source) => {
			dialog.showOpenDialog = () =>
				Promise.resolve({
					canceled: false,
					filePaths: [source],
				});
		}, path);
		await page.getByTestId('menu-section/settings').click();
		await page.getByTestId('import-documents').click();

		const invoice = sample.issued;
		if (invoice === null) {
			await expect(page.getByTestId('vault-message')).toHaveText(
				'Bylo naimportováno 0 dokladů a byl přeskočen 1 soubor.',
			);
			await expect(page.getByTestId('import-skipped')).toHaveText(`${sample.file}: ${sample.issuedError}`);
			expect(readdirSync(join(vault, 'faktury'))).toEqual([]);
		} else {
			await expect(page.getByTestId('vault-message')).toHaveText(
				invoice.addedContacts === 1
					? 'Byl naimportován 1 doklad a byl přidán 1 odběratel.'
					: 'Byl naimportován 1 doklad.',
			);
			const target = join(vault, 'faktury', `${invoice.number}.pdf`);
			expect(readFileSync(target).equals(original)).toBe(true);
			await page.getByTestId('import-documents').click();
			await expect(page.getByTestId('vault-message')).toHaveText(
				'Bylo naimportováno 0 dokladů a byl přeskočen 1 soubor.',
			);
			await expect(page.getByTestId('import-skipped')).toHaveText(
				`${sample.file}: faktura ${invoice.number} už ve vaultu existuje`,
			);
			await openImported(page, invoice);
			expect(readFileSync(target).equals(original)).toBe(true);
		}
		expect(readFileSync(path).equals(original)).toBe(true);
	});

	const invoice = sample.issued;
	if (invoice !== null) {
		test(`převzetí původního PDF přes nabídku ve složce: ${sample.file}`, async ({ dir, launch }) => {
			const original = readFileSync(join(SAMPLES, sample.file));
			const vault = externalVault(dir, invoice.supplierIco);
			const source = join(vault, sample.file);
			copyFileSync(join(SAMPLES, sample.file), source);
			const { page } = await launch(vault);
			await page.getByTestId('menu-section/invoice').click();
			await expect(page.getByTestId('adopt-candidate')).toHaveText(
				`${invoice.number} · ${invoice.customer} · ${invoice.total}\n${sample.file}`,
			);
			await page.getByTestId('adopt-accept').click();
			await expect(page.getByTestId('adopt-message')).toHaveText(
				invoice.addedContacts === 1
					? 'Byl převzat 1 doklad a byl přidán 1 odběratel.'
					: 'Byl převzat 1 doklad.',
			);
			await expect(page.getByTestId('adopt-offer')).toHaveCount(0);
			expect(existsSync(source)).toBe(false);
			const target = join(vault, 'faktury', `${invoice.number}.pdf`);
			expect(readFileSync(target).equals(original)).toBe(true);
			await openImported(page, invoice);
			expect(readFileSync(target).equals(original)).toBe(true);
		});
	}

	const received = sample.received;
	const receivedError = sample.receivedError;
	if (received !== null) {
		test(`přijaté původní PDF založí výdaj a uchová přílohu: ${sample.file}`, async ({ dir, launch }) => {
			const path = join(SAMPLES, sample.file);
			const original = readFileSync(path);
			const vault = externalVault(dir, received.recipientIco || '12345679');
			const { app, page } = await launch(vault);
			await app.evaluate(({ dialog }, source) => {
				dialog.showOpenDialog = () =>
					Promise.resolve({
						canceled: false,
						filePaths: [source],
					});
			}, path);
			await page.getByTestId('menu-section/expense').click();
			await page.getByTestId('expense-import').click();
			await expect(page.getByTestId('status-message')).toHaveText(
				`Naimportováno: ${received.supplier}.${
					received.recipientIco === ''
						? ' Doklad neuvádí IČO odběratele — ověř, že je opravdu vystavený na tebe.'
						: ''
				}`,
			);
			const expensesPath = join(vault, '.fakturian', 'vydaje.json');
			const stored: { expenses: { id: string }[] } = JSON.parse(readFileSync(expensesPath, 'utf8'));
			expect(stored.expenses).toHaveLength(1);
			expect(stored.expenses[0]).toEqual({
				id: stored.expenses[0].id,
				supplier: received.supplier,
				supplierIco: received.supplierIco,
				description: received.description,
				amountCents: received.amountCents,
				documentNumber: received.number,
				documentUuid: received.uuid,
				date: received.date,
				documentFile: sample.file,
			});
			await expect(page.getByTestId(`expense-entry-${stored.expenses[0].id}`)).toHaveText(
				`${received.supplier}${received.description}`,
			);
			const target = join(vault, 'prijate', sample.file);
			expect(readFileSync(target).equals(original)).toBe(true);
			await page.getByTestId('expense-import').click();
			await expect(page.getByTestId('status-message')).toHaveText(
				`${sample.file} už v prijate/ leží jako ${sample.file} — tentýž soubor podruhé.`,
			);
			expect(JSON.parse(readFileSync(expensesPath, 'utf8'))).toEqual(stored);
			expect(readFileSync(target).equals(original)).toBe(true);
		});
	} else if (
		receivedError !== null &&
		(sample.file === 'fakturoid-aurora.pdf' || sample.file === 'idoklad-nonvat.pdf')
	) {
		test(`vadný demonstrační doklad nevytvoří výdaj: ${sample.file}`, async ({ dir, launch }) => {
			const path = join(SAMPLES, sample.file);
			const vault = externalVault(dir, '12345679');
			const { app, page } = await launch(vault);
			await app.evaluate(({ dialog }, source) => {
				dialog.showOpenDialog = () =>
					Promise.resolve({
						canceled: false,
						filePaths: [source],
					});
			}, path);
			await page.getByTestId('menu-section/expense').click();
			await page.getByTestId('expense-import').click();
			await expect(page.getByTestId('status-message')).toHaveText(receivedError);
			expect(existsSync(join(vault, 'prijate', sample.file))).toBe(false);
			await expect(page.getByTestId('expense-edit')).toHaveCount(0);
		});
	}
}

test('převzetí nabídne platné PDF a vysvětlí odmítnutí celé směsi cizích originálů', async ({ dir, launch }) => {
	const vault = externalVault(dir, '19087209');
	const accepted = ['fakturoid-public-2024.pdf', 'fakturoid-public-hours.pdf'];
	const refused = samples.filter((sample) => sample.issued === null);
	for (const file of [...accepted, ...refused.map((sample) => sample.file)]) {
		copyFileSync(join(SAMPLES, file), join(vault, file));
	}
	const { page } = await launch(vault);
	await page.getByTestId('menu-section/invoice').click();
	await expect(page.getByTestId('adopt-candidate')).toHaveCount(2);
	await page.getByTestId('adopt-skipped-toggle').click();
	await expect(page.getByTestId('adopt-skipped-file')).toHaveText(
		refused
			.map((sample) =>
				sample.file === 'pohoda-public.pdf'
					? `${sample.file}: doklad vystavil VAE informační systémy, s.r.o. (IČO 61972452), ne ty — přijaté doklady patří do Výdajů`
					: `${sample.file}: ${sample.issuedError}`,
			)
			.toSorted((a, b) => a.localeCompare(b, 'cs')),
	);
	await page.getByTestId('adopt-accept').click();
	await expect(page.getByTestId('adopt-message')).toHaveText('Byly převzaty 2 doklady.');
	for (const file of accepted) expect(existsSync(join(vault, file))).toBe(false);
	for (const sample of refused) {
		expect(readFileSync(join(vault, sample.file)).equals(readFileSync(join(SAMPLES, sample.file)))).toBe(true);
	}
	expect(readdirSync(join(vault, 'faktury')).toSorted()).toEqual(['24-09-02.pdf', '24-09-03.pdf']);
});
