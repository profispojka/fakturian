import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import { useState } from '#app';
import VaultWizard from '~/components/vault/Wizard.vue';
import { useAdopt } from '~/composables/useAdopt';
import { useVault } from '~/composables/useVault';
import { useVaultData } from '~/composables/useVaultData';
import { emptySupplier, type Supplier } from '~/schemas/suppliers';
import { today, yearOf } from '~/utils/date';

import { backend } from '../setup/backend';
import { completeSupplier } from '../setup/fixtures';
import { mountUi, layer } from '../setup/mount';

const THIS_YEAR = yearOf(today());

function candidate(number: string) {
	return {
		path: `/vault/${number}.pdf`,
		file: `${number}.pdf`,
		number,
		customer: 'Acme',
		totalCents: 1,
		issueDate: '2025-01-01',
	};
}

async function openWizard() {
	mountUi(VaultWizard);
	useState<boolean>('vaultWizardOpen', () => false).value = true;
	await flushPromises();
	return layer();
}

function emptyScan() {
	return {
		candidates: [],
		skipped: [],
		supplier: null,
		truncated: false,
	};
}

function adoptReturns(imported = 1): void {
	backend.keepsReturning('adopt_documents', {
		imported: Array.from({ length: imported }, (_, i) => ({
			number: `2025000${i + 1}`,
			customer: 'Acme',
			issueDate: '2025-01-01',
			totalCents: 1,
		})),
		skipped: [],
		customers: [],
	});
}

function dialogReturns(path: string | null): void {
	backend.dialog.push(path);
	if (path !== null) backend.create(path);
}

function savedSupplier(): unknown {
	const path = useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value;
	if (!path) throw new Error('Průvodce zatím nezvolil datovou složku.');
	return backend.readFile(path, 'nastaveni.json').supplier ?? null;
}

function supplierIsKnown(): void {
	useNuxtApp().vueApp.runWithContext(useVaultData).data.value.supplier = completeSupplier();
}

async function folderWithoutSupplier(): Promise<void> {
	await folderWithSupplier(null);
}

async function folderWithSupplier(supplier: Supplier | null = completeSupplier()): Promise<void> {
	backend.create('/vault');
	backend.writeFile('/vault', 'nastaveni.json', {
		supplier: supplier,
		contacts: [],
		pricelist: [],
	});
	await useNuxtApp().vueApp.runWithContext(useVault).setVault('/vault');
	await useNuxtApp().vueApp.runWithContext(useVaultData).load();
}

beforeEach(() => {
	backend.keepsReturning('scan_vault', emptyScan());
	adoptReturns();
	backend.ares.companies.clear();
});

describe('IČO', () => {
	it('zavřený průvodce se nevykresluje', () => {
		expect(mountUi(VaultWizard).find('[data-testid="wizard"]').exists()).toBe(false);
	});

	it('otevřený začíná IČem, bez volby složky a bez údajů', async () => {
		await openWizard();

		expect(layer().text()).toContain('Vítej ve Fakturianu');
		expect(layer().find('[data-testid="field-ico"]').exists()).toBe(true);
		expect(layer().find('[data-testid="wizard-recommended"]').exists()).toBe(false);
		expect(layer().find('[data-testid="field-name"]').exists()).toBe(false);
		expect(layer().text()).not.toContain('Data se ukládají');
	});

	it('IČO i volba složky stojí uprostřed plochy', async () => {
		await openWizard();

		expect(layer().find('[data-testid="wizard-main"]').attributes('data-centered')).toBe('true');

		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="wizard-main"]').attributes('data-centered')).toBe('true');
	});

	it('bez platného IČa nejde pokračovat', async () => {
		await openWizard();

		await layer().find('[data-testid="field-ico"]').setValue('123');
		await flushPromises();

		expect(layer().find('[data-testid="wizard-ico-continue"]').attributes('disabled')).toBe('');

		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="field-ico"]').exists()).toBe(true);
		expect(layer().find('[data-testid="wizard-recommended"]').exists()).toBe(false);
	});

	it('platné IČO dotáhne firmu z ARES a pustí dál na volbu složky', async () => {
		backend.ares.write({
			name: 'Acme s.r.o.',
			ico: '12345679',
			dic: 'CZ12345679',
			address: {
				street: 'Dlouhá 1',
				city: 'Praha',
				zip: '11000',
			},
		});
		await openWizard();

		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();

		expect(backend.args('ares_subject')).toHaveLength(1);
		expect(layer().find('[data-testid="wizard-ares-found"]').text()).toContain('Acme s.r.o.');

		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();

		expect(layer().text()).toContain('Kam ukládat data');
		expect(layer().find('[data-testid="wizard-recommended"]').exists()).toBe(true);
	});

	it('neúspěch ARESu slíbí ruční vyplnění a pokračovat jde', async () => {
		backend.ares.unavailable = true;
		await openWizard();

		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();

		expect(layer().find('[data-testid="wizard-error"]').text()).toContain('vyplníš ručně');
		expect(layer().find('[data-testid="wizard-ico-continue"]').attributes('disabled')).toBeUndefined();
	});

	it('přepsané IČO nález zruší', async () => {
		backend.ares.write({
			name: 'Acme s.r.o.',
			ico: '12345679',
			dic: 'CZ12345679',
			address: {
				street: 'Dlouhá 1',
				city: 'Praha',
				zip: '11000',
			},
		});
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();

		await layer().find('[data-testid="field-ico"]').setValue('1234567');
		await flushPromises();

		expect(layer().find('[data-testid="wizard-ares-found"]').exists()).toBe(false);
	});

	it('vrácené IČO se dohledá znovu', async () => {
		backend.ares.write({
			name: 'Acme s.r.o.',
			ico: '12345679',
			dic: 'CZ12345679',
			address: {
				street: 'Dlouhá 1',
				city: 'Praha',
				zip: '11000',
			},
		});
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="field-ico"]').setValue('1234567');
		await flushPromises();

		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();

		expect(backend.args('ares_subject')).toHaveLength(2);
		expect(layer().find('[data-testid="wizard-ares-found"]').text()).toContain('Acme s.r.o.');
	});

	it('pozdní odpověď na přepsané IČO nález nevnese', async () => {
		backend.ares.write({
			name: 'Acme s.r.o.',
			ico: '12345679',
			dic: 'CZ12345679',
			address: {
				street: 'Dlouhá 1',
				city: 'Praha',
				zip: '11000',
			},
		});
		const query = backend.postpone('ares_subject');
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await nextTick();

		await layer().find('[data-testid="field-ico"]').setValue('1234567');
		query.finish();
		await flushPromises();

		expect(layer().find('[data-testid="wizard-ares-found"]').exists()).toBe(false);
	});

	it('neplatné IČO se do ARESu neposílá', async () => {
		await openWizard();

		await layer().find('[data-testid="field-ico"]').setValue('123');
		await flushPromises();

		expect(backend.args('ares_subject')).toEqual([]);
	});

	it('tentýž kód se nedotahuje dvakrát', async () => {
		await openWizard();

		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();

		expect(backend.args('ares_subject')).toHaveLength(1);
	});

	it('během hledání to dá najevo a pokračovat nepustí', async () => {
		// Dotaz do ARESu domluví až na pokyn — rozjeté hledání jinak nezastihneš.
		const query = backend.postpone('ares_subject');
		await openWizard();

		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await nextTick();

		expect(layer().find('[data-testid="wizard-ares-loading"]').exists()).toBe(true);
		expect(layer().find('[data-testid="wizard-ico-continue"]').attributes('disabled')).toBe('');
		query.finish();
		await flushPromises();
	});

	it('rozepsaný dodavatel předvyplní IČO', async () => {
		await folderWithSupplier({
			...emptySupplier(),
			ico: '12345679',
		});
		await openWizard();

		expect(layer().find<HTMLInputElement>('[data-testid="field-ico"]').element.value).toBe('12345679');
	});
});

describe('volba složky', () => {
	it('doporučenou cestu zkrátí o domovskou složku', async () => {
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="wizard-recommended-path"]').text()).toBe('~/Documents/Fakturian');
	});

	it('cestu mimo domovskou složku ukáže celou', async () => {
		backend.home = '/Users/jiny';
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="wizard-recommended-path"]').text()).toBe('/Users/test/Documents/Fakturian');
	});

	it('doporučená složka se založí a načte', async () => {
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();

		await layer().find('[data-testid="wizard-recommended"]').trigger('click');
		await flushPromises();

		expect(backend.folders.has('/Users/test/Documents/Fakturian')).toBe(true);
		expect(backend.args('read_data_file')).toEqual([
			{
				vaultPath: '/Users/test/Documents/Fakturian',
				name: 'nastaveni.json',
			},
			{
				vaultPath: '/Users/test/Documents/Fakturian',
				name: 'platby.json',
			},
			{
				vaultPath: '/Users/test/Documents/Fakturian',
				name: 'vydaje.json',
			},
		]);
		expect(backend.args('list_invoices')).toContainEqual({ vaultPath: '/Users/test/Documents/Fakturian' });
	});

	it('selhání založení složky se ukáže, průvodce nezůstane němý', async () => {
		backend.breaks('ensure_vault', 'disk je plný');
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();

		await layer().find('[data-testid="wizard-recommended"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="wizard-error"]').text()).toContain('disk je plný');
	});

	it('zrušený výběr vlastní složky nic nemění', async () => {
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();

		await layer().find('[data-testid="wizard-custom"]').trigger('click');
		await flushPromises();

		expect(backend.args('read_data_file')).toEqual([]);
		expect(layer().text()).toContain('Kam ukládat data');
	});

	it('selhání výběru vlastní složky se ukáže', async () => {
		dialogReturns('/vybrana');
		backend.breaks('ensure_vault', 'složka je jen ke čtení');
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();

		await layer().find('[data-testid="wizard-custom"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="wizard-error"]').text()).toContain('jen ke čtení');
	});

	it('bez výchozí cesty je doporučená volba vypnutá a řekne proč', async () => {
		backend.breaks('default_vault_path', 'domovskou složku nejde zjistit');
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="wizard-recommended"]').attributes('disabled')).toBe('');
		expect(layer().find('[data-testid="wizard-default-path-error"]').text()).toBe(
			'Doporučenou složku se nepodařilo zjistit: domovskou složku nejde zjistit',
		);
	});

	it('se zjištěnou výchozí cestou důvod nehlásí', async () => {
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="wizard-default-path-error"]').exists()).toBe(false);
	});

	it('dvojklik na doporučenou složku ji založí jen jednou', async () => {
		backend.postpone('ensure_vault');
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();

		const recommended = layer().find('[data-testid="wizard-recommended"]');
		void recommended.trigger('click');
		await recommended.trigger('click');
		await flushPromises();

		expect(backend.args('ensure_vault')).toHaveLength(1);
	});

	it('dvojklik na vlastní složku otevře dialog jen jednou', async () => {
		dialogReturns('/vybrana');
		backend.postpone('ensure_vault');
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();

		const own = layer().find('[data-testid="wizard-custom"]');
		void own.trigger('click');
		await own.trigger('click');
		await flushPromises();

		expect(backend.args('ensure_vault')).toHaveLength(1);
	});

	it('se zvolenou složkou IČO rovnou pokračuje na údaje', async () => {
		await folderWithoutSupplier();
		await openWizard();

		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="wizard-recommended"]').exists()).toBe(false);
		expect(layer().text()).toContain('Tvoje fakturační údaje');
	});
});

describe('nabídka převzetí', () => {
	beforeEach(() => {
		backend.keepsReturning('scan_vault', {
			...emptyScan(),
			candidates: [candidate('20250001')],
		});
	});

	it('po volbě složky s doklady nabídne převzetí', async () => {
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="wizard-recommended"]').trigger('click');
		await flushPromises();

		expect(layer().text()).toContain('Ve složce už doklady jsou');
		expect(layer().text()).toContain('20250001');
	});

	it('dlouhý seznam zkrátí a zbytek shrne', async () => {
		const many = Array.from({ length: 8 }, (_, i) => candidate(`2025000${i + 1}`));
		backend.keepsReturning('scan_vault', {
			...emptyScan(),
			candidates: many,
		});

		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="wizard-recommended"]').trigger('click');
		await flushPromises();

		expect(layer().findAll('[data-testid="wizard-scan"]')).toHaveLength(5);
		expect(layer().text()).toContain('…a další 3');
		expect(layer().text()).toContain('Našel jsem 8 dokladů, které vypadají jako tvoje vydané faktury.');
	});

	it('převzetí zapíše doklady a načte data znovu', async () => {
		supplierIsKnown();
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="wizard-recommended"]').trigger('click');
		await flushPromises();
		backend.forgetCalls();

		await layer().find('[data-testid="wizard-adopt"]').trigger('click');
		await flushPromises();

		expect(backend.args('adopt_documents')).toHaveLength(1);
		expect(backend.args('read_data_file')).toEqual([
			{
				vaultPath: '/Users/test/Documents/Fakturian',
				name: 'nastaveni.json',
			},
			{
				vaultPath: '/Users/test/Documents/Fakturian',
				name: 'platby.json',
			},
			{
				vaultPath: '/Users/test/Documents/Fakturian',
				name: 'vydaje.json',
			},
		]);
		expect(backend.args('list_invoices')).toContainEqual({ vaultPath: '/Users/test/Documents/Fakturian' });
	});

	it('selhání převzetí se ukáže a krok zůstane', async () => {
		backend.breaks('adopt_documents', 'soubor je zamčený');
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="wizard-recommended"]').trigger('click');
		await flushPromises();

		await layer().find('[data-testid="wizard-adopt"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="wizard-error"]').text()).toContain('zamčený');
		expect(layer().text()).toContain('Ve složce už doklady jsou');
	});

	it('zmizelý sken nabídku vyprázdní a nic nepřesune', async () => {
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="wizard-recommended"]').trigger('click');
		await flushPromises();

		useNuxtApp().vueApp.runWithContext(useAdopt).scan.value = null;
		await flushPromises();

		expect(layer().text()).toContain('Našel jsem 0 dokladů');
		expect(layer().findAll('[data-testid="wizard-scan"]')).toHaveLength(0);

		await layer().find('[data-testid="wizard-adopt"]').trigger('click');
		await flushPromises();

		expect(backend.args('adopt_documents')).toEqual([]);
	});

	it('dvojklik na převzetí spustí přesun jen jednou', async () => {
		backend.postpone('adopt_documents');
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="wizard-recommended"]').trigger('click');
		await flushPromises();

		const adopt = layer().find('[data-testid="wizard-adopt"]');
		void adopt.trigger('click');
		await adopt.trigger('click');
		await flushPromises();

		expect(backend.args('adopt_documents')).toHaveLength(1);
	});

	it('„Zatím ne" pokračuje bez převzetí', async () => {
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="wizard-recommended"]').trigger('click');
		await flushPromises();

		await layer().find('[data-testid="wizard-not-now"]').trigger('click');
		await flushPromises();

		expect(backend.args('adopt_documents')).toEqual([]);
		expect(layer().text()).toContain('Tvoje fakturační údaje');
	});
});

describe('fakturační údaje', () => {
	it('neukazují IBAN, e-mail, splatnost ani cestu ke složce', async () => {
		await folderWithoutSupplier();
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="field-name"]').exists()).toBe(true);
		expect(layer().find('[data-testid="field-iban"]').exists()).toBe(false);
		expect(layer().find('[data-testid="field-email"]').exists()).toBe(false);
		expect(layer().find('[data-testid="field-defaultDueDays"]').exists()).toBe(false);
		expect(layer().find('[data-testid="field-registration"]').exists()).toBe(false);
		expect(layer().text()).not.toContain('Data se ukládají');
		expect(layer().find('[data-testid="wizard-main"]').attributes('data-centered')).toBeUndefined();
	});

	it('nález z ARES předvyplní formulář a bez zápisu, který ARES nezná, průvodce doběhne', async () => {
		await folderWithoutSupplier();
		backend.ares.write({
			name: 'Acme s.r.o.',
			ico: '12345679',
			dic: 'CZ12345679',
			address: {
				street: 'Dlouhá 1',
				city: 'Praha',
				zip: '11000',
			},
			inCommercialRegister: true,
			tradeLicensed: true,
		});
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();

		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();

		expect(layer().find<HTMLInputElement>('[data-testid="field-name"]').element.value).toBe('Acme s.r.o.');
		expect(layer().find<HTMLInputElement>('[data-testid="field-address-city"]').element.value).toBe('Praha');

		await layer().find('[data-testid="field-bankAccount"]').setValue('2000145399');
		await layer().find('[data-testid="field-bankCode"]').setValue('0800');
		await layer().find('[data-testid="wizard-save"]').trigger('click');
		await flushPromises();

		expect(savedSupplier()).toEqual(expect.objectContaining({ registration: '' }));
		expect(layer().find('[data-testid="wizard-done"]').exists()).toBe(true);
	});

	it('OSVČ podle ARES dostane zápis do živnostenského rejstříku', async () => {
		await folderWithoutSupplier();
		backend.ares.write({
			name: 'Jan Novák',
			ico: '12345679',
			dic: '',
			address: {
				street: 'Krátká 2',
				city: 'Brno',
				zip: '60200',
			},
			tradeLicensed: true,
		});
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="field-bankAccount"]').setValue('2000145399');
		await layer().find('[data-testid="field-bankCode"]').setValue('0800');
		await layer().find('[data-testid="wizard-save"]').trigger('click');
		await flushPromises();

		expect(savedSupplier()).toEqual(expect.objectContaining({ registration: 'Zapsáno v živnostenském rejstříku' }));
	});

	it('firma bez zápisu v ARES nesmaže zápis, který dodavatel už má', async () => {
		await folderWithSupplier({
			...completeSupplier(),
			bankAccount: '',
		});
		backend.ares.write({
			name: 'Jan Novák',
			ico: '12345679',
			dic: '',
			address: {
				street: 'Krátká 2',
				city: 'Brno',
				zip: '60200',
			},
		});
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="field-bankAccount"]').setValue('2000145399');
		await layer().find('[data-testid="wizard-save"]').trigger('click');
		await flushPromises();

		expect(savedSupplier()).toEqual(
			expect.objectContaining({
				registration: 'Fyzická osoba zapsaná v živnostenském rejstříku, Živnostenský úřad Brno',
			}),
		);
	});

	it('odesláním se dodavatel uloží a průvodce dojde na konec', async () => {
		await folderWithoutSupplier();
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="field-name"]').setValue('Jan Novák');
		await layer().find('[data-testid="field-address-street"]').setValue('Krátká 2');
		await layer().find('[data-testid="field-address-city"]').setValue('Brno');
		await layer().find('[data-testid="field-address-zip"]').setValue('60200');
		await layer().find('[data-testid="field-bankAccount"]').setValue('2000145399');
		await layer().find('[data-testid="field-bankCode"]').setValue('0800');
		await flushPromises();

		await layer().find('[data-testid="wizard-save"]').trigger('click');
		await flushPromises();

		expect(savedSupplier()).toEqual(
			expect.objectContaining({
				ico: '12345679',
				name: 'Jan Novák',
			}),
		);
		expect(layer().text()).toContain('Hotovo, můžeš fakturovat');
	});

	it('IČO napsané s mezerami uloží bez nich', async () => {
		await folderWithoutSupplier();
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('123 456 79');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="field-name"]').setValue('Jan Novák');
		await layer().find('[data-testid="field-address-street"]').setValue('Krátká 2');
		await layer().find('[data-testid="field-address-city"]').setValue('Brno');
		await layer().find('[data-testid="field-address-zip"]').setValue('60200');
		await layer().find('[data-testid="field-bankAccount"]').setValue('2000145399');
		await layer().find('[data-testid="field-bankCode"]').setValue('0800');
		await flushPromises();

		await layer().find('[data-testid="wizard-save"]').trigger('click');
		await flushPromises();

		expect(savedSupplier()).toEqual(expect.objectContaining({ ico: '12345679' }));
	});

	it('složka s dodavatelem jiného IČO nepřeskočí na konec a napsané IČO uloží', async () => {
		backend.create('/Users/test/Documents/Fakturian');
		backend.writeFile('/Users/test/Documents/Fakturian', 'nastaveni.json', {
			supplier: {
				...completeSupplier(),
				ico: '27082440',
			},
			contacts: [],
			pricelist: [],
		});
		backend.ares.write({
			name: 'Acme s.r.o.',
			ico: '12345679',
			dic: '',
			address: {
				street: 'Dlouhá 1',
				city: 'Praha',
				zip: '11000',
			},
		});
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();

		await layer().find('[data-testid="wizard-recommended"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="wizard-heading"]').text()).toBe('Tvoje fakturační údaje');
		expect(layer().find<HTMLInputElement>('[data-testid="field-name"]').element.value).toBe('Acme s.r.o.');

		await layer().find('[data-testid="wizard-save"]').trigger('click');
		await flushPromises();

		expect(savedSupplier()).toEqual(
			expect.objectContaining({
				ico: '12345679',
				name: 'Acme s.r.o.',
			}),
		);
	});

	it('neplatný formulář nesubmituje', async () => {
		await folderWithoutSupplier();
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();

		await layer().find('[data-testid="wizard-save"]').trigger('click');
		await flushPromises();

		expect(savedSupplier()).toBeNull();
		expect(layer().text()).toContain('Tvoje fakturační údaje');
	});

	it('selhání uložení se ukáže a krok zůstane', async () => {
		await folderWithoutSupplier();
		backend.breaks('write_data_file', 'vault se nepodařilo zapsat');
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="field-name"]').setValue('Jan Novák');
		await layer().find('[data-testid="field-address-street"]').setValue('Krátká 2');
		await layer().find('[data-testid="field-address-city"]').setValue('Brno');
		await layer().find('[data-testid="field-address-zip"]').setValue('60200');
		await layer().find('[data-testid="field-bankAccount"]').setValue('2000145399');
		await layer().find('[data-testid="field-bankCode"]').setValue('0800');
		await flushPromises();

		await layer().find('[data-testid="wizard-save"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="wizard-error"]').text()).toContain('nepodařilo zapsat');
		expect(layer().text()).toContain('Tvoje fakturační údaje');
	});

	it('DIČ z ARES do dodavatele nepřevezme', async () => {
		await folderWithoutSupplier();
		backend.ares.write({
			name: 'Jan Novák',
			ico: '12345679',
			dic: 'CZ12345679',
			address: {
				street: 'Krátká 2',
				city: 'Brno',
				zip: '60200',
			},
		});
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="field-bankAccount"]').setValue('2000145399');
		await layer().find('[data-testid="field-bankCode"]').setValue('0800');
		await flushPromises();

		await layer().find('[data-testid="wizard-save"]').trigger('click');
		await flushPromises();

		expect(savedSupplier()).toEqual(
			expect.objectContaining({
				name: 'Jan Novák',
				defaultDueDays: 14,
			}),
		);
		expect(savedSupplier()).not.toHaveProperty('dic');
		expect(savedSupplier()).not.toHaveProperty('iban');
	});

	it('rozepsaný dodavatel si podrží, co průvodce neukazuje', async () => {
		await folderWithSupplier({
			...completeSupplier(),
			bankAccount: '',
			email: 'jan@novak.cz',
			invoiceNumberFormat: 'F{NNNN}',
		});
		await openWizard();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();

		expect(layer().find<HTMLInputElement>('[data-testid="field-name"]').element.value).toBe('Jan Novák');

		await layer().find('[data-testid="field-bankAccount"]').setValue('2000145399');
		await flushPromises();
		await layer().find('[data-testid="wizard-save"]').trigger('click');
		await flushPromises();

		expect(savedSupplier()).toEqual(
			expect.objectContaining({
				bankAccount: '2000145399',
				email: 'jan@novak.cz',
				invoiceNumberFormat: 'F{NNNN}',
			}),
		);
	});

	it('dvojí odeslání uloží dodavatele jen jednou', async () => {
		await folderWithoutSupplier();
		backend.postpone('write_data_file');
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="field-name"]').setValue('Jan Novák');
		await layer().find('[data-testid="field-address-street"]').setValue('Krátká 2');
		await layer().find('[data-testid="field-address-city"]').setValue('Brno');
		await layer().find('[data-testid="field-address-zip"]').setValue('60200');
		await layer().find('[data-testid="field-bankAccount"]').setValue('2000145399');
		await layer().find('[data-testid="field-bankCode"]').setValue('0800');
		await flushPromises();

		// Druhý klik přijde dřív, než Vue tlačítko překreslí jako zakázané.
		const save = layer().find('[data-testid="wizard-save"]');
		void save.trigger('click');
		await save.trigger('click');
		await flushPromises();

		expect(backend.args('write_data_file')).toHaveLength(1);
	});
});

describe('dokončení', () => {
	it('s hotovými údaji skočí rovnou na konec', async () => {
		await folderWithSupplier();
		await openWizard();

		expect(layer().text()).toContain('Hotovo, můžeš fakturovat');
		expect(layer().text()).not.toContain('Documents');
	});

	it('převzaté doklady s údaji dojdou rovnou na konec', async () => {
		backend.keepsReturning('scan_vault', {
			...emptyScan(),
			candidates: [candidate('20250001')],
		});
		supplierIsKnown();
		// Převzetí složku znovu načte, takže dodavatel musí ležet v souboru, ne jen v paměti.
		backend.create('/Users/test/Documents/Fakturian');
		backend.writeFile('/Users/test/Documents/Fakturian', 'nastaveni.json', {
			supplier: completeSupplier(),
			contacts: [],
			pricelist: [],
		});
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="wizard-recommended"]').trigger('click');
		await flushPromises();

		await layer().find('[data-testid="wizard-adopt"]').trigger('click');
		await flushPromises();

		expect(layer().text()).toContain('Hotovo, můžeš fakturovat');
	});

	it('tlačítkem se průvodce zavře', async () => {
		await folderWithSupplier();
		await openWizard();

		await layer().find('[data-testid="wizard-start"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="wizard"]').exists()).toBe(false);
	});

	it('ukáže příští číslo faktury, dotočí poslední číslici a naznačí dvě další', async () => {
		await folderWithSupplier();
		await openWizard();

		expect(layer().find('[data-testid="wizard-next-number"]').text()).toBe(`${THIS_YEAR}0001`);
		expect(
			layer().find<HTMLElement>('[data-testid="wizard-digit-roll"]').element.style.getPropertyValue('--digit'),
		).toBe('1');
		expect(
			layer()
				.findAll('[data-testid="wizard-following-number"]')
				.map((n) => n.text()),
		).toEqual([`${THIS_YEAR}0002`, `${THIS_YEAR}0003`]);
		expect(layer().find('[data-testid="wizard-error"]').exists()).toBe(false);
	});

	it('navazuje na čísla, která ve složce už jsou', async () => {
		await folderWithSupplier();
		backend.folder('/vault').sent.set(`${THIS_YEAR}0006`, '');
		await openWizard();

		expect(layer().find('[data-testid="wizard-next-number"]').text()).toBe(`${THIS_YEAR}0007`);
		expect(
			layer().find<HTMLElement>('[data-testid="wizard-digit-roll"]').element.style.getPropertyValue('--digit'),
		).toBe('7');
		expect(
			layer()
				.findAll('[data-testid="wizard-following-number"]')
				.map((n) => n.text()),
		).toEqual([`${THIS_YEAR}0008`, `${THIS_YEAR}0009`]);
	});

	it('po uložení údajů ukáže číslo podle uložené šablony', async () => {
		await folderWithSupplier({
			...completeSupplier(),
			bankAccount: '',
			invoiceNumberFormat: '{NNN}-{RRRR}',
		});
		await openWizard();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="field-bankAccount"]').setValue('2000145399');
		await flushPromises();
		await layer().find('[data-testid="wizard-save"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="wizard-next-number"]').text()).toBe(`001-${THIS_YEAR}`);
		expect(
			layer()
				.findAll('[data-testid="wizard-following-number"]')
				.map((n) => n.text()),
		).toEqual([`002-${THIS_YEAR}`, `003-${THIS_YEAR}`]);
	});

	it('číslo končící písmenem neotáčí', async () => {
		await folderWithSupplier({
			...completeSupplier(),
			invoiceNumberFormat: '{RRRR}{NNNN}A',
		});
		await openWizard();

		expect(layer().find('[data-testid="wizard-next-number"]').text()).toBe(`${THIS_YEAR}0001A`);
		expect(layer().find('[data-testid="wizard-digit-roll"]').exists()).toBe(false);
		expect(
			layer()
				.findAll('[data-testid="wizard-following-number"]')
				.map((n) => n.text()),
		).toEqual([`${THIS_YEAR}0002A`, `${THIS_YEAR}0003A`]);
	});

	it('dlouhé číslo vysází menším písmem', async () => {
		await folderWithSupplier({
			...completeSupplier(),
			invoiceNumberFormat: 'FAKTURA-{RRRR}-{NNNNN}',
		});
		await openWizard();

		expect(layer().find('[data-testid="wizard-next-number"]').text()).toBe(`FAKTURA-${THIS_YEAR}-00001`);
		expect(layer().find('[data-testid="wizard-done"]').attributes('data-long')).toBe('true');
	});

	it('krátké číslo vysází velkým písmem', async () => {
		await folderWithSupplier();
		await openWizard();

		expect(layer().find('[data-testid="wizard-done"]').attributes('data-long')).toBeUndefined();
	});

	it('s vadnou šablonou číslo neukáže a řekne proč', async () => {
		await folderWithSupplier({
			...completeSupplier(),
			invoiceNumberFormat: 'F{NNNN}',
		});
		await openWizard();

		expect(layer().find('[data-testid="wizard-next-number"]').text()).toBe('');
		expect(
			layer()
				.findAll('[data-testid="wizard-following-number"]')
				.map((n) => n.text()),
		).toEqual([]);
		expect(layer().find('[data-testid="wizard-error"]').text()).toBe(
			'Příští číslo faktury se nepodařilo zjistit: Šablona musí obsahovat {RRRR} (rok). Bez roku by se v lednu začalo od jedničky a čísla by se opakovala.',
		);
	});

	it('za koncem řady další čísla nenaznačí', async () => {
		await folderWithSupplier();
		backend.folder('/vault').sent.set(`${THIS_YEAR}4294967295`, '');
		await openWizard();

		expect(layer().find('[data-testid="wizard-next-number"]').text()).toBe(`${THIS_YEAR}4294967296`);
		expect(
			layer()
				.findAll('[data-testid="wizard-following-number"]')
				.map((n) => n.text()),
		).toEqual([]);
	});
});

describe('zastávky', () => {
	// Zastávky kreslí `UStepper`, takže se na ně značka nedostane; stav nese jeho `data-state`.
	const stageStates = () =>
		layer()
			.findAll('[data-testid="wizard-stages"] [data-slot="item"]')
			.map((s) => s.attributes('data-state'));

	it('na IČu svítí první ze tří', async () => {
		await openWizard();

		expect(stageStates()).toEqual(['active', 'inactive', 'inactive']);
	});

	it('na volbě složky je IČO odškrtnuté', async () => {
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();

		expect(stageStates()).toEqual(['completed', 'active', 'inactive']);
	});

	it('u fakturačních údajů je IČO i složka odškrtnutá', async () => {
		await folderWithoutSupplier();
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();

		expect(stageStates()).toEqual(['completed', 'completed', 'active']);
	});

	it('na konci jsou odškrtnuté všechny tři', async () => {
		await folderWithSupplier();
		await openWizard();

		expect(stageStates()).toEqual(['completed', 'completed', 'completed']);
	});
});

describe('zamčení průvodce', () => {
	it('Escape bez hotových údajů nezavírá', async () => {
		await openWizard();
		const open = useState<boolean>('vaultWizardOpen', () => false);

		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'Escape',
				cancelable: true,
			}),
		);
		await flushPromises();

		expect(open.value).toBe(true);
	});

	it('Escape bez dodavatele v hotové složce taky nezavírá', async () => {
		await folderWithoutSupplier();
		await openWizard();
		const open = useState<boolean>('vaultWizardOpen', () => false);

		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'Escape',
				cancelable: true,
			}),
		);
		await flushPromises();

		expect(open.value).toBe(true);
	});

	it('Escape s hotovými údaji zavře', async () => {
		await folderWithSupplier();
		await openWizard();
		const open = useState<boolean>('vaultWizardOpen', () => false);

		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'Escape',
				cancelable: true,
			}),
		);

		expect(open.value).toBe(false);
	});

	it('zavřený průvodce na Escape nereaguje', () => {
		mountUi(VaultWizard);

		const e = new KeyboardEvent('keydown', {
			key: 'Escape',
			cancelable: true,
		});
		window.dispatchEvent(e);

		expect(e.defaultPrevented).toBe(false);
		expect(layer().find('[data-testid="wizard"]').exists()).toBe(false);
	});
});

describe('vlastní složka', () => {
	it('vybraná vlastní složka se načte a pokračuje dál', async () => {
		dialogReturns('/Users/jan/iCloud/Fakturian');
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();

		await layer().find('[data-testid="wizard-custom"]').trigger('click');
		await flushPromises();

		expect(backend.args('read_data_file')).toEqual([
			{
				vaultPath: '/Users/jan/iCloud/Fakturian',
				name: 'nastaveni.json',
			},
			{
				vaultPath: '/Users/jan/iCloud/Fakturian',
				name: 'platby.json',
			},
			{
				vaultPath: '/Users/jan/iCloud/Fakturian',
				name: 'vydaje.json',
			},
		]);
		expect(backend.args('list_invoices')).toContainEqual({ vaultPath: '/Users/jan/iCloud/Fakturian' });
		expect(backend.args('scan_vault')).toEqual([
			{
				vaultPath: '/Users/jan/iCloud/Fakturian',
				ourIco: null,
			},
		]);
		expect(layer().text()).toContain('Tvoje fakturační údaje');
	});

	it('prázdná vlastní složka nabídku převzetí přeskočí', async () => {
		dialogReturns('/prazdna');
		backend.keepsReturning('scan_vault', emptyScan());
		await openWizard();
		await layer().find('[data-testid="field-ico"]').setValue('12345679');
		await flushPromises();
		await layer().find('[data-testid="wizard-ico-continue"]').trigger('click');
		await flushPromises();

		await layer().find('[data-testid="wizard-custom"]').trigger('click');
		await flushPromises();

		expect(layer().text()).not.toContain('Ve složce už doklady jsou');
		expect(layer().text()).toContain('Tvoje fakturační údaje');
	});
});
