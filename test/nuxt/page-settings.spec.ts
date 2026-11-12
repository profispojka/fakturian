import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';

import { useState } from '#app';
import { useInvoices } from '~/composables/useInvoices';
import { useLogo } from '~/composables/useLogo';
import { useMenuStats } from '~/composables/useMenuStats';
import { useVault } from '~/composables/useVault';
import { SAMPLE_INVOICE } from '~/constants/sample-invoice';
import { newInvoice } from '~/schemas/invoices';
import { emptySupplier, type Supplier } from '~/schemas/suppliers';

import { backend, wireInvoice } from '../setup/backend';
import { completeSupplier } from '../setup/fixtures';
import { mountPage, answerDialog, currentPath, dialogDestructive, goto, layer } from '../setup/mount';
import { prepareVault, saved, writes } from '../setup/vault';

const { useColorModeMock } = vi.hoisted(() => ({ useColorModeMock: vi.fn() }));
mockNuxtImport('useColorMode', () => useColorModeMock);

let colorMode: { value: string; preference: string };

function mount() {
	return mountPage('/settings');
}

async function vaultS(supplier: Supplier | null = completeSupplier()): Promise<void> {
	await prepareVault({
		'nastaveni.json': {
			supplier: supplier,
			contacts: [],
			pricelist: [],
		},
	});
	backend.returns('scan_vault', {
		candidates: [],
		skipped: [],
		supplier: null,
		truncated: false,
	});
}

function savedSupplier(): unknown {
	return saved('nastaveni.json').supplier ?? null;
}

function withoutFolder(): void {
	useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value = null;
}

function pickFolder(path: string): void {
	backend.dialog.push(path);
	backend.create(path);
}

beforeEach(async () => {
	colorMode = reactive({
		value: 'light',
		preference: 'system',
	});
	useColorModeMock.mockReturnValue(colorMode);
	await vaultS();
});

describe('motiv aplikace', () => {
	it('i bez datové složky přepne tmavý, světlý a systémový motiv', async () => {
		withoutFolder();
		const c = await mount();
		const appearance = c.find('[data-testid="settings-appearance"]');

		expect(c.find('[data-testid="appearance-system"]').text()).toBe('Systém');
		expect(appearance.attributes('data-mode')).toBe('system');

		await c.find('[data-testid="appearance-dark"]').trigger('click');
		expect(colorMode.preference).toBe('dark');
		expect(appearance.attributes('data-mode')).toBe('dark');

		await c.find('[data-testid="appearance-light"]').trigger('click');
		expect(colorMode.preference).toBe('light');
		expect(appearance.attributes('data-mode')).toBe('light');

		await c.find('[data-testid="appearance-system"]').trigger('click');
		expect(colorMode.preference).toBe('system');
		expect(appearance.attributes('data-mode')).toBe('system');
	});
});

describe('fakturační údaje', () => {
	it('formulář předvyplní uložené údaje', async () => {
		const c = await mount();

		expect(c.find<HTMLInputElement>('[name="name"]').element.value).toBe('Jan Novák');
	});

	it('pozdější změna dodavatele se do formuláře propíše', async () => {
		const c = await mount();

		await vaultS({
			...emptySupplier(),
			name: 'Změněno',
		});
		await flushPromises();

		expect(c.find<HTMLInputElement>('[name="name"]').element.value).toBe('Změněno');
	});

	it('uložením zapíše dodavatele a ohlásí to', async () => {
		const c = await mount();

		await c.find('[data-testid="settings-save"]').trigger('click');
		await flushPromises();

		expect(savedSupplier()).toEqual(completeSupplier());
		expect(c.find('[data-testid="statusbar"]').text()).toContain('Uloženo');
	});

	it('hlášení o uložení po chvíli zmizí', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const c = await mount();
		await c.find('[data-testid="settings-save"]').trigger('click');
		await flushPromises();
		expect(c.find('[data-testid="statusbar"]').text()).toContain('Uloženo');

		await vi.advanceTimersByTimeAsync(1500);
		await flushPromises();

		expect(c.find('[data-testid="statusbar"]').text()).not.toContain('Uloženo');
	});

	it('chybu při ukládání ukáže', async () => {
		backend.breaks('write_data_file', 'data se nepodařilo načíst');
		const c = await mount();

		await c.find('[data-testid="settings-save"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Údaje se nepodařilo uložit',
				description: 'data se nepodařilo načíst',
				color: 'error',
			}),
		);
	});

	it('uloží všechna vyplněná pole, ne jen povinná', async () => {
		await vaultS(null);
		const c = await mount();
		await c.find('[data-testid="field-name"]').setValue('Jan Novák');
		await c.find('[data-testid="field-ico"]').setValue('12345679');
		await c
			.find('[data-testid="field-registration"]')
			.setValue('Zapsáno v obchodním rejstříku vedeném Městským soudem v Praze');
		await c.find('[data-testid="field-address-street"]').setValue('Dlouhá 1');
		await c.find('[data-testid="field-address-city"]').setValue('Praha');
		await c.find('[data-testid="field-address-zip"]').setValue('11000');
		await c.find('[data-testid="field-bankAccount"]').setValue('2000145399');
		await c.find('[data-testid="field-bankCode"]').setValue('0800');
		await c.find('[data-testid="field-iban"]').setValue('CZ7908000000002000145399');
		await c.find('[data-testid="field-email"]').setValue('jan@novak.cz');
		await c.find('[data-testid="field-defaultDueDays"]').setValue('30');
		await c.find('[data-testid="field-defaultDueDays"]').trigger('blur');
		await c.find('[name="invoiceNumberStart"]').setValue('20260137');
		await flushPromises();

		await c.find('[data-testid="settings-save"]').trigger('click');
		await flushPromises();

		expect(savedSupplier()).toEqual(
			expect.objectContaining({
				registration: 'Zapsáno v obchodním rejstříku vedeném Městským soudem v Praze',
				iban: 'CZ7908000000002000145399',
				email: 'jan@novak.cz',
				defaultDueDays: 30,
				invoiceNumberStart: '20260137',
			}),
		);
	});

	it('IČO s mezerami a IBAN vložený z banky uloží v tvaru pro doklad', async () => {
		await vaultS();
		const c = await mount();
		await c.find('[data-testid="field-ico"]').setValue('123 456 79');
		await c.find('[data-testid="field-iban"]').setValue('cz79 0800 0000 0020 0014 5399');
		await flushPromises();

		await c.find('[data-testid="settings-save"]').trigger('click');
		await flushPromises();

		expect(savedSupplier()).toEqual(
			expect.objectContaining({
				ico: '12345679',
				iban: 'CZ7908000000002000145399',
			}),
		);
		expect(c.find<HTMLInputElement>('[name="iban"]').element.value).toBe('CZ7908000000002000145399');
	});

	it('e-mail s mezerou na konci projde a uloží se oříznutý', async () => {
		await vaultS();
		const c = await mount();
		await c.find('[data-testid="field-email"]').setValue('jan@novak.cz ');
		await flushPromises();

		await c.find('[data-testid="settings-save"]').trigger('click');
		await flushPromises();

		expect(savedSupplier()).toEqual(expect.objectContaining({ email: 'jan@novak.cz' }));
	});

	it('navázání mimo formát řady neuloží a řekne, jak ho zapsat', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime('2026-09-16T10:00');
		const c = await mount();
		expect(c.find('[data-testid="settings-number-start"] [data-slot="hint"]').text()).toBe(
			'Celé číslo, např. 20260137',
		);

		await c.find('[data-testid="field-invoiceNumberStart"]').setValue('137');
		await c.find('[data-testid="settings-save"]').trigger('click');
		await flushPromises();

		expect(c.find('[data-testid="field-invoiceNumberStart"]').attributes('aria-invalid')).toBe('true');
		expect(savedSupplier()).toEqual(completeSupplier());
	});

	it('s vadnou šablonou řady nápovědu k navázání nedává', async () => {
		const c = await mount();

		await c.find('[data-testid="field-invoiceNumberFormat"]').setValue('bez roku');
		await flushPromises();

		expect(c.find('[data-testid="settings-number-start"] [data-slot="hint"]').exists()).toBe(false);
		expect(c.find<HTMLInputElement>('[data-testid="field-invoiceNumberStart"]').element.placeholder).toBe('');
	});

	it('bez uložených údajů začíná formulář prázdný', async () => {
		await vaultS(null);
		const c = await mount();

		expect(c.find<HTMLInputElement>('[name="name"]').element.value).toBe('');
	});

	it('zmizelý dodavatel formulář nevyprázdní', async () => {
		const c = await mount();

		await vaultS(null);
		await flushPromises();

		expect(c.find<HTMLInputElement>('[name="name"]').element.value).toBe('Jan Novák');
	});

	it('tlačítko v pásu odešle formulář', async () => {
		const c = await mount();

		await c.find('[data-testid="settings-save"]').trigger('click');
		await flushPromises();

		expect(savedSupplier()).toEqual(completeSupplier());
	});

	it('Uložit je tlačítko, které mačká ⌘S', async () => {
		const c = await mount();

		expect(c.find('[data-testid="settings-save"]').attributes('data-save')).toBe('');
	});
});

describe('rozepsané údaje', () => {
	it('odchod s rozepsanými údaji se ptá a odmítnutím se zůstane', async () => {
		await goto('/settings');
		const c = await mount();
		await c.find('[data-testid="field-name"]').setValue('Rozepsané jméno');

		const leaving = goto('/');
		await answerDialog(false);
		await leaving;

		expect(currentPath()).toBe('/settings');
	});

	it('bez změn se odchod neptá', async () => {
		await goto('/settings');
		await mount();

		await goto('/');

		expect(currentPath()).toBe('/');
		expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(false);
	});

	it('po uložení se odchod neptá', async () => {
		await goto('/settings');
		const c = await mount();
		await c.find('[data-testid="field-name"]').setValue('Jan Novák ml.');
		await c.find('[data-testid="settings-save"]').trigger('click');
		await flushPromises();

		await goto('/');

		expect(currentPath()).toBe('/');
		expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(false);
	});

	it('pozdější změna dodavatele rozepsaný formulář nepřepíše', async () => {
		const c = await mount();
		await c.find('[data-testid="field-name"]').setValue('Rozepsané jméno');

		await vaultS({
			...completeSupplier(),
			name: 'Změněno',
		});
		await flushPromises();

		expect(c.find<HTMLInputElement>('[name="name"]').element.value).toBe('Rozepsané jméno');
	});

	it('nepovedené uložení rozepsané údaje ve formuláři nechá', async () => {
		// Nepovedený zápis vrátí dodavatele v paměti — formulář ale musí zůstat, jak ho uživatel napsal.
		const c = await mount();
		await c.find('[data-testid="field-name"]').setValue('Jan Novák ml.');
		backend.breaks('write_data_file', 'disk je plný');

		await c.find('[data-testid="settings-save"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Údaje se nepodařilo uložit',
				description: 'disk je plný',
			}),
		);
		expect(c.find<HTMLInputElement>('[name="name"]').element.value).toBe('Jan Novák ml.');
		expect(savedSupplier()).toEqual(completeSupplier());
	});

	it('změna složky s rozepsanými údaji se ptá a odmítnutím se nic nezmění', async () => {
		// Nová složka má vlastního dodavatele; rozepsané údaje ze staré by se jinak uložily do ní.
		pickFolder('/nova');
		const c = await mount();
		await c.find('[data-testid="field-name"]').setValue('Rozepsané jméno');

		await c.find('[data-testid="vault-change"]').trigger('click');
		await flushPromises();
		expect(layer().find('[data-testid="dialog-heading"]').text()).toBe('Zahodit neuložené změny?');
		await answerDialog(false);

		expect(useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value).toBe('/vault');
		expect(backend.dialog).toEqual(['/nova']);
		expect(c.find<HTMLInputElement>('[name="name"]').element.value).toBe('Rozepsané jméno');
	});

	it('po zahození rozepsaných údajů se složka přepne a nic z formuláře se neuloží', async () => {
		pickFolder('/nova');
		const replace = vi.spyOn(window.location, 'replace');
		const c = await mount();
		await c.find('[data-testid="field-name"]').setValue('Rozepsané jméno');

		await c.find('[data-testid="vault-change"]').trigger('click');
		await answerDialog(true);
		await flushPromises();

		expect(backend.store.get('vaultPath')).toBe('/nova');
		expect(replace).toHaveBeenCalledWith('/');
		expect(writes('nastaveni.json')).toBe(0);
	});
});

describe('šablona číselné řady', () => {
	it('oprava šablony odstraní chybu a vymazání odstraní ukázku', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime('2031-03-05T12:00');
		const c = await mount();
		await c.find('[data-testid="field-invoiceNumberFormat"]').setValue('F-{NNN}');
		expect(c.text()).toContain('musí obsahovat {RRRR}');
		expect(c.text()).not.toContain('Např.');

		await c.find('[data-testid="field-invoiceNumberFormat"]').setValue('F{RRRR}-{NNN}');
		expect(c.text()).not.toContain('musí obsahovat {RRRR}');
		expect(c.text()).toContain('Např. F2031-001');

		await c.find('[data-testid="field-invoiceNumberFormat"]').setValue('   ');
		expect(c.text()).not.toContain('musí obsahovat {RRRR}');
		expect(c.text()).not.toContain('Např.');
	});

	it('platná šablona ukáže vzorové číslo', async () => {
		const c = await mount();

		expect(c.text()).toContain('20260001');
	});

	it('vadná šablona se ohlásí a uložení zastaví', async () => {
		const original = {
			...completeSupplier(),
			invoiceNumberFormat: 'F-{NNN}',
		};
		await vaultS(original);
		const c = await mount();

		await c.find('[data-testid="settings-save"]').trigger('click');
		await flushPromises();

		expect(c.text()).toContain('musí obsahovat {RRRR}');
		expect(savedSupplier()).toEqual(original);
	});

	it('vadná šablona zčervená hned při psaní', async () => {
		const c = await mount();

		const formatField = c.find('[data-testid="field-invoiceNumberFormat"]');
		await formatField.setValue('{RRRR}/{NNNN}');
		await flushPromises();

		expect(c.text()).toContain('nepoužitelné číslo');
		expect(c.text()).not.toContain('Např.');
	});

	it('prázdná šablona ukázku nemá', async () => {
		await vaultS({
			...emptySupplier(),
			invoiceNumberFormat: '',
		});
		const c = await mount();

		expect(c.text()).not.toContain('Např.');
	});

	it('změna šablony uprostřed roku pokračuje v řadě', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime('2026-09-12T12:00');
		backend.folder('/vault').invoices.set('20260040', wireInvoice(newInvoice(null, '20260040')));
		const c = await mount();

		await c.find('[data-testid="field-invoiceNumberFormat"]').setValue('F{RRRR}-{NNN}');
		await c.find('[data-testid="settings-save"]').trigger('click');
		await flushPromises();

		expect(savedSupplier()).toEqual(
			expect.objectContaining({
				invoiceNumberFormat: 'F{RRRR}-{NNN}',
				invoiceNumberStart: 'F2026-041',
			}),
		);
		expect(c.find<HTMLInputElement>('[name="invoiceNumberStart"]').element.value).toBe('F2026-041');
		expect(await useNuxtApp().vueApp.runWithContext(useInvoices).nextNumber(2026)).toBe('F2026-041');
	});

	it('uložení beze změny šablony se na čísla neptá', async () => {
		const c = await mount();
		await c.find('[data-testid="field-name"]').setValue('Jan Novák ml.');

		await c.find('[data-testid="settings-save"]').trigger('click');
		await flushPromises();

		expect(backend.args('list_used_numbers')).toEqual([]);
		expect(savedSupplier()).toEqual(expect.objectContaining({ name: 'Jan Novák ml.' }));
	});

	it('nepřečtená čísla změnu šablony neuloží', async () => {
		backend.breaks('list_used_numbers', 'Datová složka /vault neexistuje.');
		const c = await mount();

		await c.find('[data-testid="field-invoiceNumberFormat"]').setValue('F{RRRR}-{NNN}');
		await c.find('[data-testid="settings-save"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Údaje se nepodařilo uložit',
				description: 'Datová složka /vault neexistuje.',
			}),
		);
		expect(savedSupplier()).toEqual(completeSupplier());
	});

	it('ukázka sleduje rozepsanou šablonu', async () => {
		const c = await mount();

		const formatField = c.find('[data-testid="field-invoiceNumberFormat"]');
		await formatField.setValue('S{RRRR}-{NNN}');
		await flushPromises();
		expect(c.text()).toContain('S2026-001');

		await formatField.setValue('N{RRRR}-{NNN}');
		await flushPromises();
		expect(c.text()).toContain('N2026-001');
		expect(c.text()).not.toContain('S2026-001');
	});
});

describe('vzhled faktury', () => {
	it('náhled renderuje statickou ukázkovou fakturu', async () => {
		const c = await mount();

		await c.find('[data-testid="design-preview"]').trigger('click');
		await flushPromises();

		const [call] = backend.args('preview_invoice');
		const sample = wireInvoice(SAMPLE_INVOICE);
		expect(call?.invoice).toEqual({
			...sample,
			lines: sample.lines.map((line) => ({
				...line,
				usageYear: null,
			})),
		});
		expect(layer().find('[data-testid="invoice-preview-page"]').attributes('src')).toBe(
			`data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg data-number="${SAMPLE_INVOICE.number}"/>`)}`,
		);
	});

	it('zavřený náhled zmizí', async () => {
		const c = await mount();
		await c.find('[data-testid="design-preview"]').trigger('click');
		await flushPromises();

		await layer().find('[data-testid="invoice-preview-close"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="invoice-preview-heading"]').exists()).toBe(false);
	});

	it('selhání náhledu se ukáže', async () => {
		backend.breaks('preview_invoice', 'Typst spadl');
		const c = await mount();

		await c.find('[data-testid="design-preview"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Náhled se nepodařilo otevřít',
				description: 'Typst spadl',
				color: 'error',
			}),
		);
	});
});

describe('datová složka', () => {
	it('otevře složku ve Finderu', async () => {
		const c = await mount();

		await c.find('[data-testid="vault-reveal"]').trigger('click');
		await flushPromises();

		expect(backend.exposed).toEqual(['/vault']);
	});

	it('zrušená změna složky nic nemění', async () => {
		const replace = vi.spyOn(window.location, 'replace');
		const c = await mount();

		await c.find('[data-testid="vault-change"]').trigger('click');
		await flushPromises();

		expect(backend.store.get('vaultPath')).toBe('/vault');
		expect(replace).not.toHaveBeenCalled();
	});

	it('změna složky ji zapamatuje, načte appku znovu a ve staré nic nesahá', async () => {
		pickFolder('/nova');
		backend.writeFile('/vault', 'platby.json', {
			payments: {
				'20260001': [
					{
						date: '2026-03-01',
						amountCents: 100,
					},
				],
			},
		});
		const replace = vi.spyOn(window.location, 'replace');
		const c = await mount();
		backend.forgetCalls();

		await c.find('[data-testid="vault-change"]').trigger('click');
		await flushPromises();

		expect(backend.store.get('vaultPath')).toBe('/nova');
		expect(replace).toHaveBeenCalledWith('/');
		expect(backend.args('read_data_file')).toEqual([]);
		expect(backend.folder('/vault').files.has('platby.json')).toBe(true);
		expect(backend.folder('/nova').files.has('platby.json')).toBe(false);
	});

	it('selhání změny složky se ohlásí', async () => {
		backend.dialog.push('/nova');
		backend.breaks('ensure_vault', 'složka je jen ke čtení');
		const replace = vi.spyOn(window.location, 'replace');
		const c = await mount();

		await c.find('[data-testid="vault-change"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Změna datové složky selhala',
				description: 'složka je jen ke čtení',
				color: 'error',
			}),
		);
		expect(c.text()).not.toContain('složka je jen ke čtení');
		expect(replace).not.toHaveBeenCalled();
	});

	it('nepřečtené doklady ukáže nahoře na stránce', async () => {
		useNuxtApp().vueApp.runWithContext(useMenuStats).error.value = 'vault je nedostupný';
		const c = await mount();

		expect(c.find('[data-testid="vault-read-error"] [data-slot="title"]').text()).toBe(
			'Doklady se nepodařilo načíst',
		);
		expect(c.find('[data-testid="vault-read-error"] [data-slot="description"]').text()).toBe('vault je nedostupný');
	});
});

describe('bez datové složky', () => {
	beforeEach(() => {
		withoutFolder();
	});

	it('řekne, že složka není zvolená', async () => {
		const c = await mount();

		expect(c.find('[data-testid="vault-empty-text"]').text()).toContain('Není zvolena datová složka');
		expect(c.find('[data-testid="statusbar"]').text()).toContain('Bez datové složky');
	});

	it('uložení se nenabízí', async () => {
		const c = await mount();

		expect(c.find('[data-testid="settings-save"]').exists()).toBe(false);
	});

	it('tlačítkem otevře průvodce složkou', async () => {
		const c = await mount();

		await c.find('[data-testid="vault-empty-choose"]').trigger('click');
		await flushPromises();

		expect(useState<boolean>('vaultWizardOpen', () => false).value).toBe(true);
	});
});

describe('import z jiného softwaru', () => {
	it('naimportuje vybrané doklady a shrne výsledek', async () => {
		backend.dialog.push(['/a.pdf']);
		backend.returns('import_documents', {
			imported: [
				{
					number: '20250001',
					customer: 'Acme',
					issueDate: '2025-05-01',
					totalCents: 121_000,
				},
			],
			skipped: [],
			customers: [
				{
					name: 'Alfa',
					ico: '25596641',
					dic: '',
					address: {
						street: 'Dlouhá 1',
						city: 'Praha',
						zip: '11000',
					},
					email: 'alfa@example.cz',
				},
				{
					name: 'Beta',
					ico: '28456785',
					dic: '',
					address: {
						street: 'Krátká 2',
						city: 'Brno',
						zip: '60200',
					},
					email: 'beta@example.cz',
				},
			],
		});
		const c = await mount();

		await c.find('[data-testid="import-documents"]').trigger('click');
		await flushPromises();

		expect(c.text()).toContain('Byl naimportován 1 doklad a byli přidáni 2 odběratelé.');
	});

	it('zrušený výběr nic neimportuje', async () => {
		const c = await mount();

		await c.find('[data-testid="import-documents"]').trigger('click');
		await flushPromises();

		expect(backend.args('import_documents')).toEqual([]);
	});

	it('důvody přeskočení vypíše všechny', async () => {
		backend.dialog.push(['/a.pdf']);
		backend.returns('import_documents', {
			imported: [],
			skipped: [
				{
					file: 'a.pdf',
					reason: 'není faktura',
				},
				{
					file: 'b.pdf',
					reason: 'nečitelné',
				},
			],
			customers: [],
		});
		const c = await mount();

		await c.find('[data-testid="import-documents"]').trigger('click');
		await flushPromises();

		expect(c.text()).toContain('není faktura');
		expect(c.text()).toContain('nečitelné');
	});

	it('selhání importu se ohlásí', async () => {
		backend.dialog.push(['/a.pdf']);
		backend.breaks('import_documents', 'vault není načtený');
		const c = await mount();

		await c.find('[data-testid="import-documents"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Import selhal',
				description: 'vault není načtený',
				color: 'error',
			}),
		);
	});

	it('během běžícího importu je tlačítko zamčené a druhá dávka neodejde', async () => {
		backend.dialog.push(['/a.pdf'], ['/a.pdf']);
		backend.postpone('import_documents');
		backend.postpone('import_documents');
		const c = await mount();

		const importItems = c.find('[data-testid="import-documents"]');
		void importItems.trigger('click');
		await vi.waitFor(() => expect(backend.args('import_documents')).toHaveLength(1));

		expect(importItems.attributes('disabled')).toBe('');
		await importItems.trigger('click');
		await flushPromises();

		expect(backend.args('import_documents')).toHaveLength(1);
	});
});

describe('logo', () => {
	it('stav loga se zjistí po otevření stránky', async () => {
		backend.files.add('/vault/logo.png');
		await mount();
		expect(useNuxtApp().vueApp.runWithContext(useLogo).hasLogo.value).toBe(true);
		expect(backend.args('vault_has_logo')).toEqual([{ vaultPath: '/vault' }]);
	});

	it('nedostupnou složku při zjišťování loga ohlásí', async () => {
		backend.breaks('vault_has_logo', 'Datová složka /vault neexistuje.');
		await mount();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Stav loga se nepodařilo zjistit',
				description: 'Datová složka /vault neexistuje.',
				color: 'error',
			}),
		);
	});

	it('vybrané logo se uloží do složky', async () => {
		backend.dialog.push('/Users/jan/logo.png');
		const c = await mount();

		await c.find('[data-testid="logo-set"]').trigger('click');
		await flushPromises();

		expect(c.text()).toContain('Logo uloženo');
	});

	it('zrušený výběr loga nic nehlásí', async () => {
		const c = await mount();

		await c.find('[data-testid="logo-set"]').trigger('click');
		await flushPromises();

		expect(c.text()).not.toContain('Logo uloženo');
	});

	it('chybu při ukládání loga ukáže', async () => {
		backend.dialog.push('/Users/jan/logo.png');
		backend.fails('set_vault_logo', 'Datová složka /vault neexistuje.');
		const c = await mount();

		await c.find('[data-testid="logo-set"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Logo se nepodařilo uložit',
				description: 'Datová složka /vault neexistuje.',
				color: 'error',
			}),
		);
	});
});

describe('odkazy ven', () => {
	it('odkaz na zdrojový kód otevře v prohlížeči', async () => {
		const c = await mount();

		const source = c.find('[data-testid="about-source"]');
		await source.trigger('click');
		await flushPromises();

		expect(backend.open.join(' ')).toContain('github.com');
	});

	it('odkaz na licenci otevře v prohlížeči', async () => {
		const c = await mount();

		await c.find('[data-testid="about-license"]').trigger('click');
		await flushPromises();

		expect(backend.open).toEqual(['https://github.com/profispojka/fakturian/blob/main/LICENSE']);
	});

	it('selhání otevření odkazu ohlásí chybou', async () => {
		backend.breaks('open_url', 'bez prohlížeče');
		const c = await mount();

		const source = c.find('[data-testid="about-source"]');
		await source.trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Odkaz se nepodařilo otevřít',
				description: 'bez prohlížeče',
				color: 'error',
			}),
		);
	});
});

describe('logo ve složce', () => {
	it('s uloženým logem nabízí změnu i odebrání', async () => {
		backend.files.add('/vault/logo.png');
		await useNuxtApp().vueApp.runWithContext(useLogo).refreshLogo();
		const c = await mount();

		expect(c.find('[data-testid="logo-set"]').text()).toContain('Změnit logo');
		expect(c.find('[data-testid="logo-remove"]').exists()).toBe(true);
	});

	it('změnu existujícího loga provede až po potvrzení', async () => {
		backend.files.add('/vault/logo.png');
		await useNuxtApp().vueApp.runWithContext(useLogo).refreshLogo();
		backend.dialog.push('/Users/jan/nove-logo.png');
		const c = await mount();

		await c.find('[data-testid="logo-set"]').trigger('click');
		expect(layer().find('[data-testid="dialog-message"]').text()).toContain('nahrazeno');
		expect(backend.dialog).toEqual(['/Users/jan/nove-logo.png']);
		await answerDialog(true);

		expect(backend.dialog).toEqual([]);
		expect(c.text()).toContain('Logo uloženo');
	});

	it('odmítnutá změna existujícího loga neotevře výběr souboru', async () => {
		backend.files.add('/vault/logo.png');
		await useNuxtApp().vueApp.runWithContext(useLogo).refreshLogo();
		backend.dialog.push('/Users/jan/nove-logo.png');
		const c = await mount();

		await c.find('[data-testid="logo-set"]').trigger('click');
		await answerDialog(false);

		expect(backend.dialog).toEqual(['/Users/jan/nove-logo.png']);
		expect(c.text()).not.toContain('Logo uloženo');
	});

	it('bez loga se odebrání nenabízí', async () => {
		const c = await mount();

		expect(c.find('[data-testid="logo-remove"]').exists()).toBe(false);
	});

	it('odebráním se logo po potvrzení smaže ze složky', async () => {
		backend.files.add('/vault/logo.png');
		await useNuxtApp().vueApp.runWithContext(useLogo).refreshLogo();
		const c = await mount();

		await c.find('[data-testid="logo-remove"]').trigger('click');
		await flushPromises();
		expect(layer().find('[data-testid="dialog-heading"]').text()).toBe('Odebrat logo?');
		expect(layer().find('[data-testid="dialog-message"]').text()).toBe('Nově vystavené faktury budou bez loga.');
		expect(dialogDestructive(c)).toBe(true);
		await answerDialog(true);

		expect(backend.files.has('/vault/logo.png')).toBe(false);
		expect(c.find('[data-testid="vault-message"]').text()).toBe('Logo odebráno z datové složky.');
	});

	it('odmítnuté odebrání logo nechá', async () => {
		backend.files.add('/vault/logo.png');
		await useNuxtApp().vueApp.runWithContext(useLogo).refreshLogo();
		const c = await mount();

		await c.find('[data-testid="logo-remove"]').trigger('click');
		await flushPromises();
		await answerDialog(false);

		expect(backend.files.has('/vault/logo.png')).toBe(true);
		expect(c.find('[data-testid="logo-remove"]').exists()).toBe(true);
	});

	it('chybu při odebírání loga ukáže', async () => {
		backend.files.add('/vault/logo.png');
		await useNuxtApp().vueApp.runWithContext(useLogo).refreshLogo();
		backend.fails('remove_vault_logo', 'Logo je zamčené.');
		const c = await mount();

		await c.find('[data-testid="logo-remove"]').trigger('click');
		await flushPromises();
		await answerDialog(true);

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Logo se nepodařilo odebrat',
				description: 'Logo je zamčené.',
				color: 'error',
			}),
		);
		expect(c.find('[data-testid="logo-remove"]').exists()).toBe(true);
	});
});
