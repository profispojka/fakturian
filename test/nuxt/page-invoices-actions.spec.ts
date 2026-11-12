import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useInvoices } from '~/composables/useInvoices';
import { usePricelist } from '~/composables/usePricelist';
import { useVaultData } from '~/composables/useVaultData';
import { emptySupplier } from '~/schemas/suppliers';
import { czkFromCents } from '~/utils/money';

import { backend } from '../setup/backend';
import { date } from '../setup/dates';
import { completeSupplier } from '../setup/fixtures';
import { LONG_AGO, mount, openInvoiceList, savedPayments, summary, vaultS } from '../setup/invoice-list';
import { save, savedDocuments } from '../setup/invoice-page';
import { currentPath, answerDialog, layer } from '../setup/mount';

import type { Contact } from '~/schemas/customers';

function contact(id: string, name: string): Contact {
	return {
		id,
		name,
		ico: '27082440',
		address: {
			street: 'Dlouhá 1',
			city: 'Praha',
			zip: '11000',
		},
	};
}

async function openActions(c: Awaited<ReturnType<typeof mount>>) {
	await c.find('[data-testid="invoice-actions-20260001"]').trigger('click');
	await vi.waitFor(() =>
		expect(layer().find('[data-testid="invoice-action-download-20260001"]').exists()).toBe(true),
	);
}

beforeEach(async () => {
	await openInvoiceList();
});

describe('smazání', () => {
	it('potvrzené smazání odebere doklad z výpisu, plateb i čerpání ceníku', async () => {
		await vaultS({
			invoices: [summary('20260001'), summary('20260002')],
			payments: {
				'20260001': [
					{
						id: 'p1',
						date: date('2026-03-10'),
						amountCents: 1_000,
					},
				],
			},
		});
		const c = await mount();

		await openActions(c);
		await layer().find('[data-testid="invoice-delete-20260001"]').trigger('click');
		await vi.waitFor(() => expect(layer().find('[data-testid="dialog-message"]').exists()).toBe(true));
		expect(layer().find('[data-testid="dialog-message"]').text()).toBe(
			'Opravdu chceš smazat fakturu 20260001? PDF se přesune do Koše a číslo dokladu se uvolní. ' +
				'Spolu s dokladem zmizí zapsané platby (1).',
		);
		expect(layer().find('[data-testid="dialog-confirm"]').text()).toBe('Smazat');
		await answerDialog(true);
		await flushPromises();

		expect(backend.folder('/vault').invoices.has('20260001')).toBe(false);
		expect(c.findAll('[data-testid="invoice-row"]').map((row) => row.text())).toEqual(['20260002']);
		expect(
			useNuxtApp()
				.vueApp.runWithContext(usePricelist)
				.archive.value.map((i) => i.number),
		).toEqual(['20260002']);
		expect(savedPayments()).toEqual({});
		expect(c.find('[data-testid="status-message"]').text()).toBe('Doklad 20260001 je v Koši.');
	});

	it('odmítnutá otázka doklad nesmaže', async () => {
		await vaultS({ invoices: [summary('20260001')] });
		const c = await mount();

		await openActions(c);
		await layer().find('[data-testid="invoice-delete-20260001"]').trigger('click');
		await answerDialog(false);
		await flushPromises();

		expect(backend.args('delete_invoice')).toEqual([]);
		expect(c.findAll('[data-testid="invoice-row"]').map((row) => row.text())).toEqual(['20260001']);
	});

	it('selhání smazání ohlásí a doklad nechá ve výpisu', async () => {
		await vaultS({ invoices: [summary('20260001')] });
		backend.breaks('delete_invoice', 'Doklad se nepodařilo přesunout do Koše.');
		const c = await mount();

		await openActions(c);
		await layer().find('[data-testid="invoice-delete-20260001"]').trigger('click');
		await answerDialog(true);
		await vi.waitFor(() =>
			expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
				expect.objectContaining({
					title: 'Doklad se nepodařilo smazat',
					description: 'Doklad se nepodařilo přesunout do Koše.',
					color: 'error',
				}),
			),
		);

		expect(backend.folder('/vault').invoices.has('20260001')).toBe(true);
		expect(c.findAll('[data-testid="invoice-row"]').map((row) => row.text())).toEqual(['20260001']);
	});
});

describe('akce nad fakturou', () => {
	beforeEach(async () => {
		await vaultS({ invoices: [summary('20260001')] });
	});

	it('klik na číslo otevře fakturu', async () => {
		const c = await mount();

		await c.find('[data-testid="invoice-open"]').trigger('click');

		await vi.waitFor(() => expect(currentPath()).toBe('/invoice/20260001'));
	});

	it('klik na odběratele ho otevře k úpravě', async () => {
		await vaultS({
			invoices: [summary('20260001')],
			contacts: [contact('k1', 'Acme')],
		});
		const c = await mount();

		await c.find('[data-testid="invoice-customer-link"]').trigger('click');

		await vi.waitFor(() => expect(currentPath()).toBe('/customers/k1'));
	});

	it('odběratel mimo seznam není odkaz', async () => {
		const c = await mount();

		expect(c.find('[data-testid="invoice-customer-link"]').exists()).toBe(false);
		expect(c.find('[data-testid="invoice-customer"]').text()).toBe('Acme');
	});

	it('řádek ukazuje ikonku dokladu', async () => {
		await vaultS({
			invoices: [summary('20260002', { customer: 'Studio' })],
			contacts: [contact('k2', 'Studio')],
		});
		const c = await mount();

		const studio = c.find('[data-testid="invoice-entry-20260002"]');
		expect(studio.find('[data-testid="invoice-document-icon"]').classes()).toContain('i-lucide:file-text');
	});

	it('klik na mezitím smazaného odběratele nikam nevede', async () => {
		await vaultS({
			invoices: [summary('20260001')],
			contacts: [contact('k1', 'Acme')],
		});
		const c = await mount();
		const link = c.find('[data-testid="invoice-customer-link"]');

		await vaultS({
			invoices: [summary('20260001')],
			contacts: [],
		});
		await link.trigger('click');

		expect(currentPath()).toBe('/invoice');
	});

	it('doklad bez splatnosti ji v řádku neukazuje', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					dueDate: undefined,
				}),
				summary('20260002'),
			],
		});
		const c = await mount();

		expect(c.find('[data-testid="invoice-due-20260001"]').exists()).toBe(false);
		expect(c.find('[data-testid="invoice-due-20260002"]').text()).toBe('31. 8. 2026');
	});

	it('e-mailem připraví zprávu s přílohou', async () => {
		const c = await mount();

		await openActions(c);
		await layer().find('[data-testid="invoice-action-email-20260001"]').trigger('click');
		await flushPromises();

		expect(backend.args('mail_compose_with_attachment')[0]).toEqual({
			vaultPath: '/vault',
			to: 'a@b.cz',
			subject: 'Faktura 20260001',
			body: `Dobrý den,\n\nv příloze zasílám fakturu 20260001 na částku ${czkFromCents(121_000)}.\n\nS pozdravem`,
			attachment: '/vault/faktury/20260001.pdf',
		});
	});

	it('odeslání e-mailem označí fakturu jako odeslanou a ukáže zámek', async () => {
		const c = await mount();

		await openActions(c);
		await layer().find('[data-testid="invoice-action-email-20260001"]').trigger('click');
		await flushPromises();

		expect(backend.folder('/vault').sent.get('20260001')).toBe('2026-08-30T14:15:00Z');
		expect(c.find('[data-testid="invoice-sent"]').exists()).toBe(true);
	});

	it('už odeslanou fakturu druhý e-mail znovu neoznačí', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					sentAt: '2026-08-30T14:15:00Z',
				}),
			],
		});
		const c = await mount();

		await openActions(c);
		await layer().find('[data-testid="invoice-action-email-20260001"]').trigger('click');
		await flushPromises();

		expect(backend.args('mail_compose_with_attachment')).toHaveLength(1);
		expect(backend.args('mark_invoice_sent')).toEqual([]);
	});

	it('selhání záznamu odeslání se ohlásí a fakturu neuzamkne', async () => {
		backend.breaks('mark_invoice_sent', 'ISDOC nejde zapsat');
		const c = await mount();

		await openActions(c);
		await layer().find('[data-testid="invoice-action-email-20260001"]').trigger('click');
		await flushPromises();

		expect(backend.folder('/vault').sent.has('20260001')).toBe(false);
		expect(c.find('[data-testid="invoice-sent"]').exists()).toBe(false);
		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'E-mail se nepodařilo připravit',
				description: 'ISDOC nejde zapsat',
				color: 'error',
			}),
		);
	});

	it('odeslanou fakturu otevře k úpravě bez dotazu — zeptá se až uložení', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					sentAt: '2026-08-30T14:15:00Z',
				}),
			],
		});
		const c = await mount();

		await c.find('[data-testid="invoice-open"]').trigger('click');

		await vi.waitFor(() => expect(currentPath()).toBe('/invoice/20260001'));
		expect(layer().find('[data-testid="dialog-message"]').exists()).toBe(false);
	});

	it('stažení uloží PDF na zvolené místo', async () => {
		backend.dialog.push('/Users/jan/20260001.pdf');
		const c = await mount();

		await openActions(c);
		await layer().find('[data-testid="invoice-action-download-20260001"]').trigger('click');
		await flushPromises();

		expect(backend.args('export_invoice_pdf')).toEqual([
			{
				vaultPath: '/vault',
				number: '20260001',
				target: '/Users/jan/20260001.pdf',
			},
		]);
		expect(backend.files.has('/Users/jan/20260001.pdf')).toBe(true);
	});

	it('zrušený dialog nic nekopíruje', async () => {
		backend.dialog.push(null);
		const c = await mount();

		await openActions(c);
		await layer().find('[data-testid="invoice-action-download-20260001"]').trigger('click');
		await flushPromises();

		expect(backend.args('export_invoice_pdf')).toEqual([]);
		expect(backend.files.size).toBe(0);
	});

	it('selhání přípravy e-mailu se ohlásí', async () => {
		backend.breaks('load_invoice', 'PDF bez ISDOC');
		const c = await mount();

		await openActions(c);
		await layer().find('[data-testid="invoice-action-email-20260001"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'E-mail se nepodařilo připravit',
				description: 'PDF bez ISDOC',
				color: 'error',
			}),
		);
	});

	it('selhání stažení PDF se ohlásí', async () => {
		backend.dialog.push('/Volumes/readonly/20260001.pdf');
		backend.fails(
			'export_invoice_pdf',
			'PDF se nepodařilo uložit do /Volumes/readonly/20260001.pdf: Read-only file system',
		);
		const c = await mount();

		await openActions(c);
		await layer().find('[data-testid="invoice-action-download-20260001"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'PDF se nepodařilo uložit',
				description: 'PDF se nepodařilo uložit do /Volumes/readonly/20260001.pdf: Read-only file system',
				color: 'error',
			}),
		);
	});

	it('dobropis převezme původní doklad a dostane nové číslo', async () => {
		const c = await mount();

		await openActions(c);
		await layer().find('[data-testid="invoice-credit-20260001"]').trigger('click');

		await vi.waitFor(() => expect(c.find('[data-testid="document-number"]').text()).toBe('20260002'));
		expect(currentPath()).toBe('/invoice/new');
		expect(c.find('[data-testid="heading"]').text()).toContain('Dobropis');
		expect(c.find('[data-testid="heading"]').text()).toContain('k faktuře 20260001');
	});

	it('u dobropisu se dobropis nenabízí', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					documentType: 2,
				}),
			],
		});
		const c = await mount();

		await openActions(c);
		expect(layer().find('[data-testid="invoice-credit-20260001"]').exists()).toBe(false);
	});

	it('odeslaný dobropis otevře k úpravě a další dobropis nenabízí', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					documentType: 2,
					sentAt: '2026-08-30T14:15:00Z',
				}),
			],
		});
		const c = await mount();

		await openActions(c);
		expect(layer().find('[data-testid="invoice-credit-20260001"]').exists()).toBe(false);
		await c.find('[data-testid="invoice-open"]').trigger('click');

		await vi.waitFor(() => expect(currentPath()).toBe('/invoice/20260001'));
		expect(useNuxtApp().vueApp.runWithContext(useInvoices).pendingInvoice.value).toBeNull();
	});

	it('selhání dobropisu se ohlásí', async () => {
		backend.breaks('list_used_numbers', 'Datová složka /vault neexistuje.');
		const c = await mount();

		await openActions(c);
		await layer().find('[data-testid="invoice-credit-20260001"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Dobropis se nepodařilo založit',
				description: 'Datová složka /vault neexistuje.',
				color: 'error',
			}),
		);
	});

	it('duplikát převezme odběratele a položky, dodavatele a účet vezme z Nastavení', async () => {
		await vaultS({
			invoices: [summary('20260001')],
			supplier: {
				...completeSupplier(),
				name: 'Nová firma s.r.o.',
				bankAccount: '2000145399',
				bankCode: '2010',
				iban: 'CZ6520100000002000145399',
				defaultDueDays: 14,
			},
		});
		// Účet formulář neukazuje, takže ho dokládá uložený doklad — a ten potřebuje úplného odběratele.
		const original = backend.folder('/vault').invoices.get('20260001')!;
		original.customer.ico = '27082440';
		original.customer.address = {
			street: 'Dlouhá 1',
			city: 'Praha',
			zip: '11000',
		};
		const c = await mount();

		await openActions(c);
		await layer().find('[data-testid="invoice-action-duplicate-20260001"]').trigger('click');
		await vi.waitFor(() => expect(c.find('[data-testid="document-number"]').text()).toBe('20260002'));
		await save(c);

		expect(savedDocuments().get('20260002')).toEqual(
			expect.objectContaining({
				customer: expect.objectContaining({ name: 'Acme' }),
				lines: [
					expect.objectContaining({
						description: 'Práce',
						unitPriceCents: 121_000,
					}),
				],
				supplier: expect.objectContaining({ name: 'Nová firma s.r.o.' }),
				bankAccount: '2000145399',
				bankCode: '2010',
				iban: 'CZ6520100000002000145399',
			}),
		);
	});

	it('bez fakturačních údajů dostane duplikát čtrnáctidenní splatnost', async () => {
		// Dodavatel chybí už v souboru — přepsat ho jen v paměti nestačí, protože příprava vaultu data
		// načte znovu a duplikát by dostal jeho splatnost.
		await vaultS({
			invoices: [summary('20260001', { issueDate: date('2026-03-01') })],
			supplier: null,
		});
		const c = await mount();

		await openActions(c);
		await layer().find('[data-testid="invoice-action-duplicate-20260001"]').trigger('click');
		await vi.waitFor(() => expect(c.find('[data-testid="document-number"]').text()).toBe('20260002'));

		expect(c.find('[data-testid="field-issueDate"]').attributes('data-value')).toBe('2026-08-31');
		expect(c.find('[data-testid="field-dueDate"]').attributes('data-value')).toBe('2026-09-14');
	});

	it('duplikát dostane splatnost z fakturačních údajů', async () => {
		await vaultS({ invoices: [summary('20260001')] });
		useNuxtApp().vueApp.runWithContext(useVaultData).data.value.supplier = {
			...emptySupplier(),
			defaultDueDays: 30,
		};
		const c = await mount();

		await openActions(c);
		await layer().find('[data-testid="invoice-action-duplicate-20260001"]').trigger('click');
		await vi.waitFor(() => expect(c.find('[data-testid="document-number"]').text()).toBe('20260002'));

		expect(c.find('[data-testid="field-dueDate"]').attributes('data-value')).toBe('2026-09-30');
	});

	it('selhání duplikátu se ohlásí', async () => {
		backend.breaks('load_invoice', 'PDF bez ISDOC');
		const c = await mount();

		await openActions(c);
		await layer().find('[data-testid="invoice-action-duplicate-20260001"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Duplikát se nepodařilo vytvořit',
				description: 'PDF bez ISDOC',
				color: 'error',
			}),
		);
	});
});

describe('faktura s dobropisem', () => {
	const credited = [
		summary('20260001', { dueDate: LONG_AGO }),
		summary('20260002', {
			documentType: 2,
			totalCents: -121_000,
			originalInvoice: '20260001',
			dueDate: LONG_AGO,
		}),
	];

	it('nezaplacená faktura s dobropisem je dobropisovaná a dobropis vypořádaný, nic není po splatnosti', async () => {
		await vaultS({ invoices: credited });
		const c = await mount();

		expect(c.find('[data-testid="invoice-payments-20260001"]').attributes('data-state')).toBe('credited');
		expect(c.find('[data-testid="invoice-payments-20260001"]').text()).toBe('Dobropisováno');
		expect(c.find('[data-testid="invoice-payments-20260002"]').attributes('data-state')).toBe('settled');
		expect(c.find('[data-testid="invoice-payments-20260002"]').text()).toBe('Vypořádáno');

		await c.find('[data-testid="invoice-state-overdue"]').trigger('click');
		await flushPromises();
		expect(c.findAll('[data-testid="invoice-row"]')).toHaveLength(0);
	});

	it('zaplacenou fakturu s dobropisem je potřeba vrátit', async () => {
		await vaultS({
			invoices: credited,
			payments: {
				'20260001': [
					{
						id: 'p2',
						date: date('2026-03-10'),
						amountCents: 121_000,
					},
				],
			},
		});
		const c = await mount();

		expect(c.find('[data-testid="invoice-payments-20260002"]').attributes('data-state')).toBe('refund');
		await c.find('[data-testid="invoice-payments-20260002"]').trigger('click');
		await flushPromises();
		expect(layer().find('[data-testid="payments-outstanding"]').text()).toBe(czkFromCents(-121_000));
	});

	it('dobropisovaná faktura nenabízí upomínku ani další dobropis', async () => {
		await vaultS({ invoices: credited });
		const c = await mount();

		await openActions(c);
		expect(layer().find('[data-testid="invoice-action-reminder-20260001"]').exists()).toBe(false);
		expect(layer().find('[data-testid="invoice-credit-20260001"]').exists()).toBe(false);
		expect(layer().find('[data-testid="invoice-action-duplicate-20260001"]').exists()).toBe(true);
	});

	it('dobropisovanou fakturu nesmaže a řekne, že nejdřív musí pryč dobropis', async () => {
		await vaultS({ invoices: credited });
		const c = await mount();

		await openActions(c);
		await layer().find('[data-testid="invoice-delete-20260001"]').trigger('click');
		await vi.waitFor(() =>
			expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
				expect.objectContaining({
					title: 'Doklad se nepodařilo smazat',
					description: 'Faktura 20260001 má dobropis 20260002. Nejdřív smaž dobropis.',
					color: 'error',
				}),
			),
		);

		expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(false);
		expect(backend.args('delete_invoice')).toEqual([]);
	});

	it('dobropis se nenabízí k duplikaci ani k upomínce', async () => {
		await vaultS({ invoices: credited });
		const c = await mount();

		await c.find('[data-testid="invoice-actions-20260002"]').trigger('click');
		await vi.waitFor(() =>
			expect(layer().find('[data-testid="invoice-action-download-20260002"]').exists()).toBe(true),
		);
		expect(layer().find('[data-testid="invoice-action-duplicate-20260002"]').exists()).toBe(false);
		expect(layer().find('[data-testid="invoice-action-reminder-20260002"]').exists()).toBe(false);
	});

	it('smazaný dobropis fakturu znovu otevře', async () => {
		await vaultS({ invoices: credited });
		const c = await mount();

		await c.find('[data-testid="invoice-actions-20260002"]').trigger('click');
		await vi.waitFor(() => expect(layer().find('[data-testid="invoice-delete-20260002"]').exists()).toBe(true));
		await layer().find('[data-testid="invoice-delete-20260002"]').trigger('click');
		await vi.waitFor(() => expect(layer().find('[data-testid="dialog-heading"]').exists()).toBe(true));
		expect(layer().find('[data-testid="dialog-heading"]').text()).toBe('Smazat dobropis?');
		await answerDialog(true);
		await flushPromises();

		expect(c.find('[data-testid="invoice-payments-20260001"]').attributes('data-state')).toBe('overdue');
		await openActions(c);
		expect(layer().find('[data-testid="invoice-credit-20260001"]').exists()).toBe(true);
	});
});

describe('upomínka', () => {
	it('u faktury po splatnosti připraví upomínku', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					dueDate: LONG_AGO,
				}),
			],
		});
		const c = await mount();

		await openActions(c);
		await layer().find('[data-testid="invoice-action-reminder-20260001"]').trigger('click');
		await flushPromises();

		expect(backend.args('mail_compose_with_attachment')[0]).toEqual({
			vaultPath: '/vault',
			to: 'a@b.cz',
			subject: 'Upomínka: faktura 20260001 po splatnosti',
			body:
				'Dobrý den,\n\ndovoluji si připomenout fakturu 20260001 na částku 1 210,00 Kč, která je ' +
				'2 434 dnů po splatnosti.\n\nPokud už je uhrazena, berte prosím tuto zprávu za bezpředmětnou.' +
				'\n\nS pozdravem',
			attachment: '/vault/faktury/20260001.pdf',
		});
	});

	it('u zčásti uhrazené faktury upomíná jen zbytek', async () => {
		await vaultS({
			invoices: [summary('20260001', { dueDate: LONG_AGO })],
			payments: {
				'20260001': [
					{
						id: 'p3',
						date: date('2026-05-01'),
						amountCents: 50_000,
					},
				],
			},
		});
		const c = await mount();

		await openActions(c);
		await layer().find('[data-testid="invoice-action-reminder-20260001"]').trigger('click');
		await flushPromises();

		expect(backend.args('mail_compose_with_attachment')[0]).toEqual(
			expect.objectContaining({
				body:
					'Dobrý den,\n\ndovoluji si připomenout fakturu 20260001 na částku 710,00 Kč, která je ' +
					'2 434 dnů po splatnosti.\n\nPokud už je uhrazena, berte prosím tuto zprávu za bezpředmětnou.' +
					'\n\nS pozdravem',
			}),
		);
	});

	it('výpis otevřený přes půlnoc počítá dny po splatnosti od nového dne', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					dueDate: date('2026-08-21'),
				}),
			],
		});
		const c = await mount();
		vi.setSystemTime('2026-09-01T00:05');

		await openActions(c);
		await layer().find('[data-testid="invoice-action-reminder-20260001"]').trigger('click');
		await flushPromises();

		expect(backend.args('mail_compose_with_attachment')[0]).toEqual(
			expect.objectContaining({
				body:
					'Dobrý den,\n\ndovoluji si připomenout fakturu 20260001 na částku 1 210,00 Kč, která je ' +
					'11 dnů po splatnosti.\n\nPokud už je uhrazena, berte prosím tuto zprávu za bezpředmětnou.' +
					'\n\nS pozdravem',
			}),
		);
	});

	it('selhání upomínky se ohlásí', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					dueDate: LONG_AGO,
				}),
			],
		});
		backend.breaks('load_invoice', 'PDF bez ISDOC');
		const c = await mount();

		await openActions(c);
		await layer().find('[data-testid="invoice-action-reminder-20260001"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Upomínku se nepodařilo připravit',
				description: 'PDF bez ISDOC',
				color: 'error',
			}),
		);
	});

	it('u faktury v termínu se upomínka nenabízí', async () => {
		await vaultS({ invoices: [summary('20260001')] });
		const c = await mount();

		await openActions(c);
		expect(layer().find('[data-testid="invoice-action-reminder-20260001"]').exists()).toBe(false);
	});
});
