import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePricelist } from '~/composables/usePricelist';
import { newInvoice } from '~/schemas/invoices';
import { emptySupplier } from '~/schemas/suppliers';
import { addDays, today } from '~/utils/date';
import { contactToParty } from '~/utils/invoice';
import { czkFromCents } from '~/utils/money';

import { backend } from '../setup/backend';
import { date } from '../setup/dates';
import { completeSupplier } from '../setup/fixtures';
import {
	invoiceInVault,
	contact,
	mountInvoice,
	prepareInvoicePage,
	state,
	savedInvoice,
	save,
} from '../setup/invoice-page';
import { answerDialog, currentPath, goto, layer, pickDate } from '../setup/mount';

beforeEach(async () => {
	await prepareInvoicePage();
});

describe('nová faktura', () => {
	it('doklad bez splatnosti nabídne výběr data', async () => {
		invoiceInVault('20260001', { dueDate: '' });
		const c = await mountInvoice('20260001');
		expect(c.find('[data-testid="field-dueDate"]').text()).toBe('Vybrat datum');
	});
	it('kalendář změní splatnost, zavře se a nabídne návrat na dnešek', async () => {
		const c = await mountInvoice();
		await pickDate(c.find('[data-testid="field-dueDate"]'), date('2027-03-15'));
		expect(c.find('[data-testid="field-dueDate"]').attributes('data-value')).toBe('2027-03-15');
		expect(layer().find('[data-testid="date-calendar"]').exists()).toBe(false);
		await c.find('[data-testid="field-dueDate"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="field-dueDate-today"]').trigger('click');
		await flushPromises();
		expect(c.find('[data-testid="field-dueDate"]').attributes('data-value')).toBe(today());
		expect(layer().find('[data-testid="date-calendar"]').exists()).toBe(false);
	});

	it('posun data vystavení posune splatnost o stejný počet dní, dopředu i dozadu', async () => {
		const c = await mountInvoice();
		const due = addDays(today(), 14);
		expect(c.find('[data-testid="field-dueDate"]').attributes('data-value')).toBe(due);

		await pickDate(c.find('[data-testid="field-issueDate"]'), addDays(today(), 40));
		expect(c.find('[data-testid="field-dueDate"]').attributes('data-value')).toBe(addDays(due, 40));

		await pickDate(c.find('[data-testid="field-issueDate"]'), addDays(today(), -40));
		expect(c.find('[data-testid="field-dueDate"]').attributes('data-value')).toBe(addDays(due, -40));

		await c.find('[data-testid="field-issueDate"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="field-issueDate-today"]').trigger('click');
		await flushPromises();
		expect(c.find('[data-testid="field-dueDate"]').attributes('data-value')).toBe(due);
	});

	it('splatnost, kterou uživatel nastavil sám, se s datem vystavení neposouvá', async () => {
		const c = await mountInvoice();
		await pickDate(c.find('[data-testid="field-dueDate"]'), addDays(today(), 60));

		await pickDate(c.find('[data-testid="field-issueDate"]'), addDays(today(), 10));

		expect(c.find('[data-testid="field-issueDate"]').attributes('data-value')).toBe(addDays(today(), 10));
		expect(c.find('[data-testid="field-dueDate"]').attributes('data-value')).toBe(addDays(today(), 60));
	});

	it('další nová faktura posouvá splatnost znovu, i když ji ta předchozí měla nastavenou ručně', async () => {
		const c = await mountInvoice();
		const due = addDays(today(), 14);
		await pickDate(c.find('[data-testid="field-dueDate"]'), addDays(today(), 60));
		await c.find('[data-testid="action-new"]').trigger('click');
		await answerDialog(true);
		expect(c.find('[data-testid="field-dueDate"]').attributes('data-value')).toBe(due);

		await pickDate(c.find('[data-testid="field-issueDate"]'), addDays(today(), 3));

		expect(c.find('[data-testid="field-dueDate"]').attributes('data-value')).toBe(addDays(due, 3));
	});

	it('vystavené faktuře změna data vystavení splatnost nechá', async () => {
		invoiceInVault('20260001');
		const c = await mountInvoice('20260001');

		await pickDate(c.find('[data-testid="field-issueDate"]'), date('2026-03-05'));

		expect(c.find('[data-testid="field-issueDate"]').attributes('data-value')).toBe('2026-03-05');
		expect(c.find('[data-testid="field-dueDate"]').attributes('data-value')).toBe('2026-03-15');
	});

	it('bez datové složky se číslo nepřiděluje', async () => {
		state.vaultPath.value = null;
		await mountInvoice();

		expect(backend.args('list_used_numbers')).toEqual([]);
	});

	it('selhání přidělení čísla se ohlásí', async () => {
		backend.breaks('list_used_numbers', 'Datová složka /vault neexistuje.');
		await mountInvoice();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Nepodařilo se přidělit číslo faktury',
				description: 'Datová složka /vault neexistuje.',
				color: 'error',
			}),
		);
	});

	it('logo, které nejde přečíst, ohlásí nad dokladem dřív, než vyjde bez něj', async () => {
		backend.keepsReturning('vault_logo_state', 'unreadable');
		const c = await mountInvoice();

		expect(c.find('[data-testid="logo-warning"] [data-slot="title"]').text()).toBe('Logo nejde přečíst');
		expect(c.find('[data-testid="logo-warning"] [data-slot="description"]').text()).toBe(
			'Soubor logo.png v datové složce je poškozený, není to obrázek PNG, nebo ho iCloud na tenhle Mac nestáhl. Faktura proto vyjde bez loga, dokud ho v Nastavení nenastavíš znovu nebo neodebereš.',
		);
	});

	it('s logem v pořádku ani bez loga nevaruje', async () => {
		const c = await mountInvoice();

		expect(backend.args('vault_logo_state')).toEqual([{ vaultPath: '/vault' }]);
		expect(c.find('[data-testid="logo-warning"]').exists()).toBe(false);
	});

	it('nedostupnou složku při zjišťování loga ohlásí jako neotevřenou fakturu', async () => {
		backend.breaks('vault_logo_state', 'Datová složka /vault neexistuje.');
		await mountInvoice();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Fakturu se nepodařilo otevřít',
				description: 'Datová složka /vault neexistuje.',
				color: 'error',
			}),
		);
	});

	it('načte archiv kvůli ročním limitům ceníku', async () => {
		invoiceInVault('20260001');
		invoiceInVault('20260002');
		await mountInvoice();

		expect(
			useNuxtApp()
				.vueApp.runWithContext(usePricelist)
				.archive.value.map((i) => i.number),
		).toEqual(['20260001', '20260002']);
	});

	it('dodavatel doplněný později se propíše bez toho, aby to byla změna', async () => {
		state.supplier.value = null;
		const c = await mountInvoice();

		state.supplier.value = completeSupplier();
		await flushPromises();

		expect(c.text()).toContain('Jan Novák');

		await goto('/invoice');

		expect(currentPath()).toBe('/invoice');
		expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(false);
	});

	it('dodavatel doplněný později přinese i bankovní spojení', async () => {
		state.supplier.value = null;
		const c = await mountInvoice();

		state.supplier.value = completeSupplier();
		await flushPromises();
		state.contacts.value.push(contact('k1'));
		await flushPromises();
		await c.find('[data-testid="choose-customer"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="customer-picker-item"]').trigger('click');
		await flushPromises();
		await c.find('[data-testid="item-label"]').setValue('Práce');
		await c.find('[data-testid="item-quantity"]').setValue('10');
		await c.find('[data-testid="item-quantity"]').trigger('blur');
		await c.find('[data-testid="item-price"]').setValue('1000');
		await c.find('[data-testid="item-price"]').trigger('blur');
		await flushPromises();
		await save(c);

		expect(backend.args('save_invoice')[0]?.invoice).toEqual(
			expect.objectContaining({
				bankAccount: '2000145399',
				bankCode: '0800',
			}),
		);
	});

	it('pozdější změna dodavatele hotový doklad nepřepíše', async () => {
		const c = await mountInvoice();
		await c.find('[data-testid="item-label"]').setValue('Rozepsaná práce');
		await flushPromises();

		state.supplier.value = {
			...completeSupplier(),
			name: 'Jiné jméno',
		};
		await flushPromises();

		expect(c.find('[data-testid="sender"]').text()).toContain('Jan Novák');
		expect(c.find<HTMLInputElement>('[data-testid="item-label"]').element.value).toBe('Rozepsaná práce');
	});

	it('doplnění údajů nad rozepsaným dokladem otázku při odchodu nezruší', async () => {
		state.supplier.value = null;
		const c = await mountInvoice();
		await c.find('[data-testid="item-label"]').setValue('Rozepsaná práce');
		await flushPromises();

		state.supplier.value = completeSupplier();
		await flushPromises();

		const leaving = goto('/invoice');
		await answerDialog(true);
		await leaving;

		expect(currentPath()).toBe('/invoice');
	});

	it('za hlavičku stránky se táhne oknem', async () => {
		const c = await mountInvoice();

		expect(c.find('[data-testid="header"]').attributes()).toHaveProperty('data-drag-region');
	});
});

describe('pole dokladu', () => {
	it('uloží přepsané číslo, VS, data i poznámku', async () => {
		const c = await mountInvoice();
		state.contacts.value.push(contact('k1'));
		await flushPromises();
		await c.find('[data-testid="choose-customer"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="customer-picker-item"]').trigger('click');
		await flushPromises();
		await c.find('[data-testid="item-label"]').setValue('Práce');
		await c.find('[data-testid="item-quantity"]').setValue('10');
		await c.find('[data-testid="item-quantity"]').trigger('blur');
		await c.find('[data-testid="item-price"]').setValue('1000');
		await c.find('[data-testid="item-price"]').trigger('blur');
		await flushPromises();
		await c.find('[data-testid="field-number"]').setValue('20260042');
		await c.find('[data-testid="field-vs"]').setValue('2026001');
		await pickDate(c.find('[data-testid="field-issueDate"]'), date('2026-03-10'));
		await pickDate(c.find('[data-testid="field-dueDate"]'), date('2026-03-24'));
		await c.find('[data-testid="field-note"]').setValue('Objednávka 42/2026');
		await c.find('[data-testid="item-unit"]').setValue('hod');
		await flushPromises();

		await save(c);

		expect(backend.args('save_invoice')[0]?.invoice).toEqual(
			expect.objectContaining({
				number: '20260042',
				variableSymbol: '2026001',
				issueDate: '2026-03-10',
				dueDate: '2026-03-24',
				note: 'Objednávka 42/2026',
			}),
		);
		expect(savedInvoice(0).lines[0]?.unit).toBe('hod');
	});

	it('číslo se znakem, který by backend odmítl, se ohlásí u pole a neuloží', async () => {
		const c = await mountInvoice();
		state.contacts.value.push(contact('k1'));
		await flushPromises();
		await c.find('[data-testid="choose-customer"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="customer-picker-item"]').trigger('click');
		await flushPromises();
		await c.find('[data-testid="item-label"]').setValue('Práce');
		await c.find('[data-testid="item-quantity"]').setValue('10');
		await c.find('[data-testid="item-quantity"]').trigger('blur');
		await c.find('[data-testid="item-price"]').setValue('1000');
		await c.find('[data-testid="item-price"]').trigger('blur');
		await flushPromises();
		await c.find('[data-testid="field-number"]').setValue('2026/0042');
		await flushPromises();

		await save(c);

		expect(backend.args('save_invoice')).toEqual([]);
		expect(c.find('[data-testid="field-number"]').attributes('aria-invalid')).toBe('true');
		expect(c.text()).toContain(
			'Číslo dokladu může mít nejvýš 64 znaků: písmena bez diakritiky, číslice, mezery, tečky, pomlčky a podtržítka, a musí začínat i končit písmenem nebo číslicí.',
		);
	});

	it('číslo mimo šablonu řady se neuloží, s vlastní šablonou projde', async () => {
		const c = await mountInvoice();
		state.contacts.value.push(contact('k1'));
		await flushPromises();
		await c.find('[data-testid="choose-customer"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="customer-picker-item"]').trigger('click');
		await flushPromises();
		await c.find('[data-testid="item-label"]').setValue('Práce');
		await c.find('[data-testid="item-quantity"]').setValue('10');
		await c.find('[data-testid="item-quantity"]').trigger('blur');
		await c.find('[data-testid="item-price"]').setValue('1000');
		await c.find('[data-testid="item-price"]').trigger('blur');
		await flushPromises();
		await c.find('[data-testid="field-number"]').setValue('F2026-001');
		await flushPromises();

		await save(c);

		expect(backend.args('save_invoice')).toEqual([]);
		expect(c.find('[data-testid="field-number"]').attributes('aria-invalid')).toBe('true');

		state.supplier.value = {
			...completeSupplier(),
			invoiceNumberFormat: 'F{RRRR}-{NNN}',
		};
		await flushPromises();
		await save(c);

		expect(savedInvoice(0).number).toBe('F2026-001');
	});

	it('vystavený doklad v cizím tvaru čísla jde znovu uložit', async () => {
		invoiceInVault('FOREIGN-1');
		const c = await mountInvoice('FOREIGN-1');

		await save(c);

		expect(savedInvoice(0).number).toBe('FOREIGN-1');
	});

	it('u načtené faktury je číslo zamčené', async () => {
		invoiceInVault('20260001');
		const c = await mountInvoice('20260001');

		expect(c.find('[data-testid="field-number"]').attributes('disabled')).toBe('');
	});
});

describe('strany dokladu', () => {
	it('u odesílatele ukáže IČO, adresu i e-mail, DIČ nikdy', async () => {
		state.supplier.value = {
			...completeSupplier(),
			email: 'jan@novak.cz',
		};
		const c = await mountInvoice();

		const sender = c.find('[data-testid="sender"]').text();
		expect(sender).toContain('IČO: 12345679');
		expect(sender).toContain('Krátká 2');
		expect(sender).toContain('Brno 60200');
		expect(sender).toContain('jan@novak.cz');
		expect(sender).not.toContain('DIČ');
	});

	it('u odesílatele bez IČO a ulice ukáže aspoň město', async () => {
		state.supplier.value = {
			...emptySupplier(),
			name: 'Jan Novák',
			ico: '',
			address: {
				street: '',
				city: 'Brno',
				zip: '',
			},
		};
		const c = await mountInvoice();

		const sender = c.find('[data-testid="sender"]').text();
		expect(sender).not.toContain('IČO');
		expect(sender).toContain('Brno');
	});

	it('u převzatého dokladu ukáže DIČ, které na něm přišlo', async () => {
		// Vlastní DIČ appka nevede, převzatý doklad si ale svoje ponechá — jinak by úprava cizí faktury
		// tiše smazala údaj, který na ní vytiskl původní software.
		invoiceInVault('FOREIGN-1', {
			supplier: {
				name: 'Cizí dodavatel',
				ico: '12345679',
				dic: 'CZ12345679',
				address: {
					street: '',
					city: 'Brno',
					zip: '',
				},
				email: '',
				registration: '',
			},
		});
		const c = await mountInvoice('FOREIGN-1');

		expect(c.find('[data-testid="sender"]').text()).toContain('DIČ: CZ12345679');
	});

	it('u odesílatele s ulicí a PSČ bez města oddělí čárkou', async () => {
		state.supplier.value = {
			...emptySupplier(),
			name: 'Jan Novák',
			address: {
				street: 'Krátká 2',
				city: '',
				zip: '60200',
			},
		};
		const c = await mountInvoice();

		expect(c.find('[data-testid="sender"]').text()).toBe('DodavatelJan NovákKrátká 2, 60200');
	});

	it('bez fakturačních údajů to u odesílatele řekne', async () => {
		state.supplier.value = null;
		const c = await mountInvoice();

		expect(c.find('[data-testid="sender"]').text()).toContain('Fakturační údaje zatím nejsou vyplněné');
	});

	it('u odběratele ukáže IČO, DIČ, adresu i e-mail', async () => {
		state.pendingInvoice.value = {
			...newInvoice(completeSupplier(), '20260009'),
			customer: {
				name: 'Acme s.r.o.',
				ico: '27082440',
				dic: 'CZ27082440',
				address: {
					street: 'Dlouhá 1',
					city: 'Praha',
					zip: '11000',
				},
				email: 'fakturace@acme.cz',
				registration: '',
			},
		};
		const c = await mountInvoice();

		const customer = c.find('[data-testid="customer-summary"]').text();
		expect(customer).toContain('IČO: 27082440');
		expect(customer).toContain('DIČ: CZ27082440');
		expect(customer).toContain('Dlouhá 1');
		expect(customer).toContain('Praha 11000');
		expect(customer).toContain('fakturace@acme.cz');
	});

	it('u odběratele bez IČO a ulice ukáže aspoň DIČ a město', async () => {
		state.pendingInvoice.value = {
			...newInvoice(completeSupplier(), '20260009'),
			customer: {
				name: 'Acme s.r.o.',
				ico: '',
				dic: 'CZ27082440',
				address: {
					street: '',
					city: 'Praha',
					zip: '',
				},
				email: '',
				registration: '',
			},
		};
		const c = await mountInvoice();

		const customer = c.find('[data-testid="customer-summary"]').text();
		expect(customer).toContain('DIČ: CZ27082440');
		expect(customer).toContain('Praha');
	});

	it('u odběratele s ulicí a PSČ bez města oddělí čárkou', async () => {
		state.pendingInvoice.value = {
			...newInvoice(completeSupplier(), '20260009'),
			customer: {
				name: 'Acme s.r.o.',
				ico: '',
				dic: '',
				address: {
					street: 'Dlouhá 1',
					city: '',
					zip: '11000',
				},
				email: '',
				registration: '',
			},
		};
		const c = await mountInvoice();

		expect(c.find('[data-testid="customer-summary"]').text()).toBe(
			'Acme s.r.o.Dlouhá 1, 11000 Upravit  Změnit  Odebrat',
		);
	});
});

describe('otevření existující faktury', () => {
	it('načte doklad, který pojmenovává adresa', async () => {
		invoiceInVault('20260001');
		const c = await mountInvoice('20260001');

		expect(backend.args('load_invoice')).toEqual([
			{
				vaultPath: '/vault',
				number: '20260001',
			},
		]);
		expect(c.find('[data-testid="document-number"]').text()).toBe('20260001');
	});

	it('smazání po souhlasu odklidí doklad a vrátí se na výpis bez otázky na rozepsané změny', async () => {
		invoiceInVault('20260001');
		const c = await mountInvoice('20260001');
		await c.find('[data-testid="item-label"]').setValue('Rozepsaná práce');
		await flushPromises();

		await c.find('[data-testid="action-delete"]').trigger('click');
		expect(layer().find('[data-testid="dialog-message"]').text()).toBe(
			'Opravdu chceš smazat fakturu 20260001? PDF se přesune do Koše a číslo dokladu se uvolní.',
		);
		await answerDialog(true);

		expect(backend.args('delete_invoice')).toEqual([
			{
				vaultPath: '/vault',
				number: '20260001',
			},
		]);
		// Odchod na výpis jde až za obnovou statistik v menu, takže není hotový v tiku odpovědi.
		await vi.waitFor(() => expect(currentPath()).toBe('/invoice'));
		expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(false);
	});

	it('odmítnuté smazání nechá doklad otevřený', async () => {
		invoiceInVault('20260001');
		const c = await mountInvoice('20260001');

		await c.find('[data-testid="action-delete"]').trigger('click');
		await answerDialog(false);

		expect(backend.args('delete_invoice')).toEqual([]);
		expect(currentPath()).toBe('/invoice/20260001');
		expect(c.find('[data-testid="action-delete"]').attributes('disabled')).toBeUndefined();
	});

	it('fakturu s dobropisem nesmaže a řekne proč', async () => {
		invoiceInVault('20260001');
		invoiceInVault('20260002', {
			documentType: 2,
			originalInvoice: '20260001',
		});
		const c = await mountInvoice('20260001');

		await c.find('[data-testid="action-delete"]').trigger('click');
		await flushPromises();

		expect(backend.args('delete_invoice')).toEqual([]);
		expect(currentPath()).toBe('/invoice/20260001');
		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Doklad se nepodařilo smazat',
				description: 'Faktura 20260001 má dobropis 20260002. Nejdřív smaž dobropis.',
				color: 'error',
			}),
		);
	});

	it('nový doklad ani chybějící doklad smazat nenabízí', async () => {
		const fresh = await mountInvoice();
		expect(fresh.find('[data-testid="action-delete"]').exists()).toBe(false);
		fresh.unmount();

		const missing = await mountInvoice('20269999');
		expect(missing.find('[data-testid="action-delete"]').exists()).toBe(false);
	});

	it('doklad, který v evidenci není, se místo formuláře přizná', async () => {
		const c = await mountInvoice('20269999');

		expect(backend.args('load_invoice')).toEqual([]);
		expect(c.text()).toContain('Tenhle doklad v evidenci není');
		expect(c.find('[data-testid="action-save"]').attributes('disabled')).toBe('');
	});

	it('změna nastavení nedoplní naše údaje do otevřeného cizího dokladu', async () => {
		invoiceInVault('FOREIGN-1', {
			supplier: {
				name: '',
				ico: '',
				dic: '',
				address: {
					street: '',
					city: '',
					zip: '',
				},
				email: '',
				registration: '',
			},
			bankAccount: '987654321',
			bankCode: '0100',
			iban: 'CZ1201000000000987654321',
			vatNote: 'Text z cizího dokladu',
		});
		const c = await mountInvoice('FOREIGN-1');

		state.supplier.value = {
			...completeSupplier(),
			name: 'Naše nové nastavení',
			bankAccount: '111222333',
			bankCode: '0800',
		};
		await flushPromises();

		expect(c.find('[data-testid="sender"]').text()).toContain('Fakturační údaje zatím nejsou vyplněné.');
		expect(c.find('[data-testid="sender"]').text()).not.toContain('Naše nové nastavení');
	});

	it('převezme předvyplněný doklad', async () => {
		state.pendingInvoice.value = {
			...newInvoice(completeSupplier(), '20260009'),
			documentType: 2,
			originalInvoice: '20260001',
		};
		const c = await mountInvoice();

		expect(c.find('[data-testid="heading"]').text()).toContain('Dobropis');
		expect(c.find('[data-testid="heading"]').text()).toContain('20260001');
		expect(state.pendingInvoice.value).toBeNull();
		expect(backend.args('list_used_numbers')).toEqual([]);
	});

	it('dobropis se bez důvodu opravy neuloží', async () => {
		invoiceInVault('20260001', {
			lines: [
				{
					description: 'Práce',
					quantity: 10,
					unit: 'hod',
					unitPriceCents: 100_000,
				},
			],
		});
		state.pendingInvoice.value = {
			...newInvoice(completeSupplier(), '20260009'),
			documentType: 2,
			originalInvoice: '20260001',
		};
		const c = await mountInvoice();
		state.contacts.value.push(contact('k1'));
		await flushPromises();
		await c.find('[data-testid="choose-customer"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="customer-picker-item"]').trigger('click');
		await flushPromises();
		await c.find('[data-testid="item-label"]').setValue('Práce');
		await c.find('[data-testid="item-quantity"]').setValue('10');
		await c.find('[data-testid="item-quantity"]').trigger('blur');
		await c.find('[data-testid="item-price"]').setValue('1000');
		await c.find('[data-testid="item-price"]').trigger('blur');
		await flushPromises();
		await c.find('[data-testid="item-price"]').setValue('-1000');
		await c.find('[data-testid="item-price"]').trigger('blur');
		await flushPromises();

		await save(c);

		expect(backend.args('save_invoice')).toEqual([]);
		expect(c.find('[data-testid="field-note"]').attributes('aria-invalid')).toBe('true');

		await c.find('[data-testid="field-note"]').setValue('Vrácení nevyužité licence');
		await save(c);

		expect(savedInvoice(0).note).toBe('Vrácení nevyužité licence');
	});

	it.each([
		[
			'jen část faktury',
			() => invoiceInVault('20260001'),
			-50_000,
			`Dobropis musí vrátit celou fakturu 20260001, tedy ${czkFromCents(-100_000)}.`,
		],
		[
			'druhý dobropis k téže faktuře',
			() => {
				invoiceInVault('20260001');
				invoiceInVault('20260005', {
					documentType: 2,
					originalInvoice: '20260001',
					lines: [
						{
							description: 'Práce',
							quantity: 1,
							unit: 'hod',
							unitPriceCents: -100_000,
						},
					],
				});
			},
			-100_000,
			'Faktura 20260001 už má dobropis 20260005.',
		],
		[
			'faktura mimo evidenci',
			() => undefined,
			-100_000,
			'Faktura 20260001 v evidenci není — dobropis jde vystavit jen k existující faktuře.',
		],
	])('dobropis na %s se neuloží', async (_case, prepare, unitPriceCents, problem) => {
		prepare();
		state.pendingInvoice.value = {
			...newInvoice(completeSupplier(), '20260009'),
			documentType: 2,
			originalInvoice: '20260001',
			note: 'Vrácení',
			customer: contactToParty(contact('k1')),
			lines: [
				{
					id: 'r1',
					description: 'Práce',
					quantity: 1,
					unit: 'hod',
					unitPriceCents,
				},
			],
		};
		const c = await mountInvoice();

		await save(c);

		expect(backend.args('save_invoice')).toEqual([]);
		expect(c.find('[data-testid="field-lines"] [data-slot="error"]').text()).toBe(problem);
	});
});

describe('chyby validace', () => {
	it('chyba skrytého pole se pojmenuje v hlášení', async () => {
		const c = await mountInvoice();
		state.contacts.value = [
			{
				...contact('k1'),
				email: 'fakturace@acme',
			},
		];
		await flushPromises();
		await c.find('[data-testid="choose-customer"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="customer-picker-item"]').trigger('click');
		await flushPromises();

		await c.find('[data-testid="item-label"]').setValue('Práce');
		await c.find('[data-testid="item-quantity"]').setValue('10');
		await c.find('[data-testid="item-quantity"]').trigger('blur');
		await c.find('[data-testid="item-price"]').setValue('1000');
		await c.find('[data-testid="item-price"]').trigger('blur');
		await flushPromises();
		await save(c);

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Neplatný e-mail odběratele.',
				color: 'error',
			}),
		);
		expect(backend.args('save_invoice')).toEqual([]);
	});

	it('chyba viditelného pole odkáže na formulář', async () => {
		const c = await mountInvoice();
		await c.find('[data-testid="item-quantity"]').setValue('0');
		await c.find('[data-testid="item-quantity"]').trigger('blur');
		await save(c);

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Zkontroluj zvýrazněná pole formuláře.',
				color: 'error',
			}),
		);
	});

	it('chybná buňka se označí i pojmenuje', async () => {
		const c = await mountInvoice();
		state.contacts.value.push(contact('k1'));
		await flushPromises();
		await c.find('[data-testid="choose-customer"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="customer-picker-item"]').trigger('click');
		await flushPromises();
		await c.find('[data-testid="item-label"]').setValue('Práce');
		await c.find('[data-testid="item-quantity"]').setValue('10');
		await c.find('[data-testid="item-quantity"]').trigger('blur');
		await c.find('[data-testid="item-price"]').setValue('1000');
		await c.find('[data-testid="item-price"]').trigger('blur');
		await flushPromises();
		await c.find('[data-testid="item-quantity"]').setValue('0');
		await c.find('[data-testid="item-quantity"]').trigger('blur');
		await flushPromises();

		await save(c);

		expect(c.find('[data-testid="item-quantity"]').attributes('aria-invalid')).toBe('true');
		expect(c.find('[data-testid="item-quantity"]').attributes('title')).toBe('Zadej číslo > 0.');
		expect(c.find('[data-testid="item-label"]').attributes('title')).toBeUndefined();
	});

	it('chybnou buňku ohlásí čtečce i aria-invalid', async () => {
		const c = await mountInvoice();
		state.contacts.value.push(contact('k1'));
		await flushPromises();
		await c.find('[data-testid="choose-customer"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="customer-picker-item"]').trigger('click');
		await flushPromises();
		await c.find('[data-testid="item-label"]').setValue('Práce');
		await c.find('[data-testid="item-quantity"]').setValue('10');
		await c.find('[data-testid="item-quantity"]').trigger('blur');
		await c.find('[data-testid="item-price"]').setValue('1000');
		await c.find('[data-testid="item-price"]').trigger('blur');
		await flushPromises();
		await c.find('[data-testid="item-quantity"]').setValue('0');
		await c.find('[data-testid="item-quantity"]').trigger('blur');
		await flushPromises();

		await save(c);

		expect(c.find('[data-testid="item-quantity"]').attributes('aria-invalid')).toBe('true');
		expect(c.find('[data-testid="item-label"]').attributes('aria-invalid')).toBe('false');
		expect(c.find('[data-testid="item-unit"]').attributes('aria-invalid')).toBe('false');
		expect(c.find('[data-testid="item-price"]').attributes('aria-invalid')).toBe('false');
	});

	it('prázdná jednotka zabrání uložení a vysvětlí chybu přímo u pole', async () => {
		const c = await mountInvoice();
		state.contacts.value.push(contact('k1'));
		await flushPromises();
		await c.find('[data-testid="choose-customer"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="customer-picker-item"]').trigger('click');
		await flushPromises();
		await c.find('[data-testid="item-label"]').setValue('Práce');
		await c.find('[data-testid="item-quantity"]').setValue('10');
		await c.find('[data-testid="item-quantity"]').trigger('blur');
		await c.find('[data-testid="item-price"]').setValue('1000');
		await c.find('[data-testid="item-price"]').trigger('blur');
		await flushPromises();
		await c.find('[data-testid="item-unit"]').setValue('');
		await save(c);

		expect(c.find('[data-testid="item-unit"]').attributes('title')).toBe('Povinné pole.');
		expect(c.find('[data-testid="item-label"]').attributes('title')).toBeUndefined();
		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Zkontroluj zvýrazněná pole formuláře.',
				color: 'error',
			}),
		);
	});

	it('prázdný popis položky zabrání uložení a vysvětlí chybu přímo u pole', async () => {
		const c = await mountInvoice();
		state.contacts.value.push(contact('k1'));
		await flushPromises();
		await c.find('[data-testid="choose-customer"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="customer-picker-item"]').trigger('click');
		await flushPromises();
		await c.find('[data-testid="item-label"]').setValue('Práce');
		await c.find('[data-testid="item-quantity"]').setValue('10');
		await c.find('[data-testid="item-quantity"]').trigger('blur');
		await c.find('[data-testid="item-price"]').setValue('1000');
		await c.find('[data-testid="item-price"]').trigger('blur');
		await flushPromises();
		await c.find('[data-testid="item-label"]').setValue('');
		await save(c);

		expect(c.find('[data-testid="item-label"]').attributes('aria-invalid')).toBe('true');
		expect(c.find('[data-testid="item-label"]').attributes('title')).toBe('Povinné pole.');
		expect(c.find('[data-testid="item-unit"]').attributes('title')).toBeUndefined();
		expect(backend.args('save_invoice')).toEqual([]);
	});
});
