import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

import { useInvoices } from '~/composables/useInvoices';
import { usePaymentsFile } from '~/composables/usePayments';
import { useVault } from '~/composables/useVault';
import { useVaultData } from '~/composables/useVaultData';
import { newInvoice } from '~/schemas/invoices';
import { emptySupplier, type Supplier } from '~/schemas/suppliers';
import { deletionQuestion, supplierToParty } from '~/utils/invoice';

import { backend, wireInvoice } from '../setup/backend';
import { summary, validInvoice } from '../setup/fixtures';
import { answerDialog, layer, mountUi } from '../setup/mount';
import { documentInVault, prepareVault, saved, writes } from '../setup/vault';

function invoiceFromVault() {
	const s = {
		...emptySupplier(),
		name: 'Jan Novák',
	};
	return {
		number: '20260001',
		uuid: 'u-1',
		documentType: 1,
		originalInvoice: '',
		originalIssueDate: '',
		originalUuid: '',
		issueDate: '2026-03-01',
		dueDate: '2026-03-15',
		supplier: supplierToParty(s),
		customer: supplierToParty(s),
		vatNote: '',
		bankAccount: '123',
		bankCode: '0800',
		iban: '',
		variableSymbol: '20260001',
		note: '',
		lines: [
			{
				description: 'Práce',
				quantity: 1,
				unit: 'hod',
				unitPriceCents: 120_000,
				itemId: 'p-konzultace',
			},
		],
	};
}

function setSupplier(s: Supplier | null): void {
	useNuxtApp().vueApp.runWithContext(useVaultData).data.value.supplier = s;
}

beforeEach(async () => {
	await prepareVault({
		'nastaveni.json': {
			supplier: {
				...emptySupplier(),
				invoiceNumberFormat: '{RRRR}{NNNN}',
			},
			contacts: [],
			pricelist: [],
		},
	});
});

function withoutFolder(): void {
	useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value = null;
}

describe('číslo z řady', () => {
	it('naváže na nejvyšší číslo ve složce', async () => {
		documentInVault(summary('20260006'));

		expect(await useNuxtApp().vueApp.runWithContext(useInvoices).nextNumber(2026)).toBe('20260007');
		expect(backend.args('list_used_numbers')).toEqual([{ vaultPath: '/vault' }]);
	});

	it('číslo smazaného posledního dokladu se vydá znovu', async () => {
		documentInVault(summary('20260006'));
		documentInVault(summary('20260009'));
		await useNuxtApp().vueApp.runWithContext(useInvoices).remove('20260009');

		expect(await useNuxtApp().vueApp.runWithContext(useInvoices).nextNumber(2026)).toBe('20260007');
	});

	it('bez datové složky číslo nevydá', async () => {
		withoutFolder();

		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).nextNumber(2026)).rejects.toThrow(
			new Error('Není zvolena datová složka'),
		);
		expect(backend.args('list_used_numbers')).toEqual([]);
	});

	it('bez vyplněného dodavatele vezme výchozí šablonu', async () => {
		setSupplier(null);

		expect(await useNuxtApp().vueApp.runWithContext(useInvoices).nextNumber(2026)).toBe('20260001');
	});

	it('bez zadaného roku vezme letošek', async () => {
		vi.useFakeTimers();
		vi.setSystemTime('2026-03-01T12:00');

		expect(await useNuxtApp().vueApp.runWithContext(useInvoices).nextNumber()).toBe('20260001');
	});

	it('naváže na řadu z jiného softwaru', async () => {
		setSupplier({
			...emptySupplier(),
			invoiceNumberFormat: 'F{RRRR}-{NNN}',
			invoiceNumberStart: 'F2026-137',
		});

		expect(await useNuxtApp().vueApp.runWithContext(useInvoices).nextNumber(2026)).toBe('F2026-137');
	});

	it('chybějící datová složka nese chybu dál i u čísla', async () => {
		backend.breaks(
			'list_used_numbers',
			'Datová složka /vault neexistuje. Přejmenoval ji někdo, nebo je odpojený disk?',
		);

		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).nextNumber(2026)).rejects.toBe(
			'Datová složka /vault neexistuje. Přejmenoval ji někdo, nebo je odpojený disk?',
		);
	});

	it('vadná šablona v nastavení nese chybu, ne výchozí řadu', async () => {
		setSupplier({
			...emptySupplier(),
			invoiceNumberFormat: 'F-{NNN}',
		});

		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).nextNumber(2026)).rejects.toThrow(
			new Error(
				'Šablona musí obsahovat {RRRR} (rok). Bez roku by se v lednu začalo od jedničky a čísla by se opakovala.',
			),
		);
		expect(backend.args('list_used_numbers')).toEqual([]);
	});
});

describe('převod řady na novou šablonu', () => {
	it('prázdná uložená šablona se čte jako výchozí', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime('2026-09-12T12:00');
		setSupplier({
			...emptySupplier(),
			invoiceNumberFormat: '',
		});
		documentInVault(summary('20260040'));
		const next = {
			...emptySupplier(),
			invoiceNumberFormat: 'F{RRRR}-{NNN}',
		};

		expect(await useNuxtApp().vueApp.runWithContext(useInvoices).continueSeries(next)).toEqual({
			...next,
			invoiceNumberStart: 'F2026-041',
		});
	});

	it('bez čísel ve staré řadě nechá dodavatele beze změny', async () => {
		const next = {
			...emptySupplier(),
			invoiceNumberFormat: 'F{RRRR}-{NNN}',
		};

		expect(await useNuxtApp().vueApp.runWithContext(useInvoices).continueSeries(next)).toBe(next);
		expect(backend.args('list_used_numbers')).toEqual([{ vaultPath: '/vault' }]);
	});
});

describe('uložení a náhled', () => {
	it('uloží fakturu přes command', async () => {
		const inv = validInvoice('20260001');

		expect(await useNuxtApp().vueApp.runWithContext(useInvoices).save(inv, true)).toBe(
			'/vault/faktury/20260001.pdf',
		);
		expect(backend.args('save_invoice')).toEqual([
			{
				vaultPath: '/vault',
				invoice: {
					...wireInvoice(inv),
					lines: [
						{
							description: 'Práce',
							quantity: 1,
							unit: 'hod',
							unitPriceCents: 120_000,
							usageYear: null,
						},
					],
				},
				isNew: true,
			},
		]);
		expect(backend.folder('/vault').invoices.has('20260001')).toBe(true);
	});

	it('na drát pošle data jako řetězce a chybějící jako prázdno', async () => {
		const { dueDate: _dueDate, ...inv } = newInvoice(null, '20260001');
		inv.lines = [
			{
				id: 'r1',
				description: 'Práce',
				quantity: 1,
				unit: 'hod',
				unitPriceCents: 120_000,
			},
		];

		await useNuxtApp().vueApp.runWithContext(useInvoices).preview(inv);
		expect(backend.args('preview_invoice')[0]?.invoice).toEqual(
			expect.objectContaining({
				issueDate: inv.issueDate.toString(),
				dueDate: '',
			}),
		);
	});

	it.each([
		['Faktura 20260001 už existuje. Zvol jiné číslo.', 'už existuje'],
		[
			'Doklad 20260001 ve složce faktury/ není — smazal ho někdo mimo appku, nebo je odpojený disk? Ulož ho jako nový doklad.',
			've složce faktury/ není',
		],
		[
			'Datová složka /vault neexistuje. Přejmenoval ji někdo, nebo je odpojený disk?',
			'Datová složka /vault neexistuje',
		],
	])('odmítnuté uložení nese důvod „%s" beze změny', async (message, cast) => {
		backend.breaks('save_invoice', message);

		await expect(
			useNuxtApp().vueApp.runWithContext(useInvoices).save(validInvoice('20260001'), false),
		).rejects.toThrow(cast);
	});

	it('nový doklad na obsazené číslo se odmítne', async () => {
		documentInVault(summary('20260001'));
		const inv = validInvoice('20260001');

		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).save(inv, true)).rejects.toBe(
			'Faktura 20260001 už existuje.',
		);
	});

	it('bez datové složky se neukládá', async () => {
		withoutFolder();

		await expect(
			useNuxtApp().vueApp.runWithContext(useInvoices).save(validInvoice('20260001'), true),
		).rejects.toThrow(new Error('Není zvolena datová složka'));
	});

	it('doklad, který neprojde schématem, neuloží a do backendu ho nepošle', async () => {
		const inv = newInvoice(null, '20260001');
		inv.lines = [
			{
				id: 'r1',
				description: 'Práce',
				quantity: 1,
				unit: 'hod',
				unitPriceCents: 120_000,
			},
		];

		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).save(inv, true)).rejects.toThrow(
			new Error('Doklad nejde uložit (Vyber nebo zadej odběratele.).'),
		);
		expect(backend.args('save_invoice')).toEqual([]);
	});

	it('nový doklad mimo číselnou řadu z Nastavení neuloží', async () => {
		await expect(
			useNuxtApp().vueApp.runWithContext(useInvoices).save(validInvoice('2026-1'), true),
		).rejects.toThrow(new Error('Doklad nejde uložit (Číslo neodpovídá číselné řadě {RRRR}{NNNN} z Nastavení.).'));
		expect(backend.args('save_invoice')).toEqual([]);
	});

	it('kontrolu pustí i samostatně, bez uložení', () => {
		expect(() =>
			useNuxtApp().vueApp.runWithContext(useInvoices).validate(validInvoice('20260001'), true, []),
		).not.toThrow();
		expect(backend.args('save_invoice')).toEqual([]);
	});

	it('nový doklad zapomene platby, které k jeho číslu zůstaly po zmizelém dokladu', async () => {
		backend.writeFile('/vault', 'platby.json', {
			payments: {
				'20260001': [
					{
						id: 'p1',
						date: '2026-01-10',
						amountCents: 5_000,
					},
				],
				'20260002': [
					{
						id: 'p2',
						date: '2026-01-12',
						amountCents: 7_000,
					},
				],
			},
		});
		await useNuxtApp().vueApp.runWithContext(usePaymentsFile).load();
		const inv = validInvoice('20260001');

		await useNuxtApp().vueApp.runWithContext(useInvoices).save(inv, true);

		expect(saved('platby.json').payments).toEqual({
			'20260002': [
				{
					id: 'p2',
					date: '2026-01-12',
					amountCents: 7_000,
				},
			],
		});
	});

	it('úprava existujícího dokladu jeho platby nechá', async () => {
		documentInVault(summary('20260001'));
		backend.writeFile('/vault', 'platby.json', {
			payments: {
				'20260001': [
					{
						id: 'p4',
						date: '2026-01-10',
						amountCents: 5_000,
					},
				],
			},
		});
		await useNuxtApp().vueApp.runWithContext(usePaymentsFile).load();
		const inv = validInvoice('20260001');

		await useNuxtApp().vueApp.runWithContext(useInvoices).save(inv, false);

		expect(writes('platby.json')).toBe(0);
	});

	it('když se staré platby smazat nepodaří, uložený doklad to neshodí, jen upozorní', async () => {
		backend.writeFile('/vault', 'platby.json', {
			payments: {
				'20260001': [
					{
						id: 'p5',
						date: '2026-01-10',
						amountCents: 5_000,
					},
				],
			},
		});
		await useNuxtApp().vueApp.runWithContext(usePaymentsFile).load();
		backend.breaks('write_data_file', 'Disk je plný');
		const inv = validInvoice('20260001');

		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).save(inv, true)).resolves.toBe(
			'/vault/faktury/20260001.pdf',
		);
		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Faktura 20260001 je uložená, ale starou platbu k jejímu číslu se nepodařilo smazat',
				description: 'Disk je plný',
				color: 'warning',
			}),
		);
	});

	it('náhled vrátí stránky dokladu', async () => {
		expect(await useNuxtApp().vueApp.runWithContext(useInvoices).preview(newInvoice(null, '1'))).toEqual([
			'<svg data-number="1"/>',
		]);
	});

	it('bez datové složky se náhled nedělá', async () => {
		withoutFolder();

		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).preview(newInvoice(null, '1'))).rejects.toThrow(
			new Error('Není zvolena datová složka'),
		);
	});
});

describe('označení odeslání', () => {
	it('zapíše čas odeslání k existujícímu dokladu', async () => {
		documentInVault(summary('20260001'));
		const sentAt = await useNuxtApp().vueApp.runWithContext(useInvoices).markSent('20260001');
		expect(backend.folder('/vault').sent.get('20260001')).toBe(sentAt);
		expect(backend.args('mark_invoice_sent')).toEqual([
			{
				vaultPath: '/vault',
				number: '20260001',
			},
		]);
	});

	it('bez datové složky odmítne změnu stavu', async () => {
		withoutFolder();
		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).markSent('20260001')).rejects.toThrow(
			new Error('Není zvolena datová složka'),
		);
	});
});

describe('čtení z vaultu', () => {
	it('načte fakturu a ověří její tvar', async () => {
		backend.returns('load_invoice', invoiceFromVault());

		const inv = await useNuxtApp().vueApp.runWithContext(useInvoices).load('20260001');
		expect(inv.number).toBe('20260001');
		expect(inv.lines).toHaveLength(1);
	});

	it('načtený doklad si nechá vazbu na ceník', async () => {
		backend.returns('load_invoice', invoiceFromVault());

		const inv = await useNuxtApp().vueApp.runWithContext(useInvoices).load('20260001');
		expect(inv.lines[0]?.itemId).toBe('p-konzultace');
	});

	it('faktura s rozbitým tvarem se odmítne', async () => {
		backend.returns('load_invoice', { number: '20260001' });

		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).load('20260001')).rejects.toThrow(
			new Error(
				'Doklad má poškozený obsah (uuid: Neplatný vstup: očekáváno řetězec, obdrženo undefined, documentType: Neplatná možnost: očekávána jedna z hodnot 1|2 a originalInvoice: Neplatný vstup: očekáváno řetězec, obdrženo undefined).',
			),
		);
	});

	it('vrátí seznam dokladů', async () => {
		documentInVault(summary('20260001'));
		documentInVault(summary('20260002'));

		expect(await useNuxtApp().vueApp.runWithContext(useInvoices).list()).toHaveLength(2);
	});

	it('uchová zvlášť soubory, které nativní vrstva nedokázala načíst', async () => {
		const broken = {
			fileName: '20260002.pdf',
			path: '/vault/faktury/20260002.pdf',
			reason: 'PDF nejde přečíst',
		};
		backend.returns('list_invoices', {
			items: [summary('20260001')],
			broken: [broken],
		});
		const invoices = useNuxtApp().vueApp.runWithContext(useInvoices);

		expect(await invoices.list()).toEqual([summary('20260001')]);
		expect(invoices.brokenInvoices.value).toEqual([broken]);
	});

	it('souhrn bez částky se odmítne', async () => {
		const { totalCents: _totalCents, ...withoutAmount } = summary('20260001');
		backend.returns('list_invoices', {
			items: [withoutAmount],
			broken: [],
		});

		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).list()).rejects.toThrow(
			new Error(
				'Seznam faktur má poškozený obsah (items.0.totalCents: Neplatný vstup: očekáváno číslo, obdrženo undefined).',
			),
		);
	});

	it('chybějící datová složka nese chybu dál místo prázdného seznamu', async () => {
		backend.breaks(
			'list_invoices',
			'Datová složka /vault neexistuje. Přejmenoval ji někdo, nebo je odpojený disk?',
		);

		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).list()).rejects.toBe(
			'Datová složka /vault neexistuje. Přejmenoval ji někdo, nebo je odpojený disk?',
		);
	});

	it('bez datové složky je seznam prázdný', async () => {
		withoutFolder();

		expect(await useNuxtApp().vueApp.runWithContext(useInvoices).list()).toEqual([]);
		expect(backend.args('list_invoices')).toEqual([]);
	});

	it('tabulka předá chybu čtení seznamu', async () => {
		backend.breaks('list_invoices', 'disk není dostupný');
		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).list()).rejects.toBe('disk není dostupný');
	});
});

/** Potvrzovací dialog vykresluje `UApp`; bez něj by otázka nikdy nevyskočila. */
const OverlayHost = defineComponent({
	name: 'OverlayHost',
	setup: () => () => h('div'),
});

function creditNoteInVault(number: string, original: string): void {
	const inv = newInvoice(null, number);
	inv.documentType = 2;
	inv.originalInvoice = original;
	inv.lines = [
		{
			id: 'r1',
			description: 'Práce',
			quantity: 1,
			unit: 'hod',
			unitPriceCents: -120_000,
		},
	];
	backend.folder('/vault').invoices.set(number, wireInvoice(inv));
}

async function withPayments(): Promise<void> {
	backend.writeFile('/vault', 'platby.json', {
		payments: {
			'20260001': [
				{
					id: 'p6',
					date: '2026-03-05',
					amountCents: 50_000,
				},
				{
					id: 'p7',
					date: '2026-03-06',
					amountCents: 71_000,
				},
			],
			'20260002': [
				{
					id: 'p8',
					date: '2026-03-07',
					amountCents: 7_000,
				},
			],
		},
	});
	await useNuxtApp().vueApp.runWithContext(usePaymentsFile).load();
}

describe('smazání', () => {
	it('odebere doklad z přehledu i jeho platby', async () => {
		documentInVault(summary('20260001'));
		documentInVault(summary('20260002'));
		await withPayments();
		const invoices = useNuxtApp().vueApp.runWithContext(useInvoices);
		await invoices.archived();

		await invoices.remove('20260001');

		expect(backend.args('delete_invoice')).toEqual([
			{
				vaultPath: '/vault',
				number: '20260001',
			},
		]);
		const rest = await invoices.archived();
		expect(rest.map((i) => i.number)).toEqual(['20260002']);
		expect(saved('platby.json').payments).toEqual({
			'20260002': [
				{
					id: 'p8',
					date: '2026-03-07',
					amountCents: 7_000,
				},
			],
		});
	});

	it('doklad bez plateb nic dalšího nezapisuje', async () => {
		documentInVault(summary('20260005'));

		await useNuxtApp().vueApp.runWithContext(useInvoices).remove('20260005');

		expect(writes('platby.json')).toBe(0);
	});

	it('odmítnutí z backendu nechá platby beze změny', async () => {
		documentInVault(summary('20260001'));
		await withPayments();
		backend.breaks('delete_invoice', 'Doklad se nepodařilo přesunout do Koše.');

		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).remove('20260001')).rejects.toBe(
			'Doklad se nepodařilo přesunout do Koše.',
		);
		expect(writes('platby.json')).toBe(0);
	});

	it('když se platby nepodaří odebrat, smazání to neshodí, jen upozorní', async () => {
		documentInVault(summary('20260001'));
		await withPayments();
		backend.breaks('write_data_file', 'Disk je plný');

		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).remove('20260001')).resolves.toBeUndefined();
		expect(backend.folder('/vault').invoices.has('20260001')).toBe(false);
		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Faktura 20260001 je smazaná, ale její platby se nepodařilo odebrat',
				description: 'Disk je plný',
				color: 'warning',
			}),
		);
	});

	it('bez datové složky smazání odmítne', async () => {
		withoutFolder();

		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).remove('20260001')).rejects.toThrow(
			new Error('Není zvolena datová složka'),
		);
		expect(backend.args('delete_invoice')).toEqual([]);
	});
});

describe('smazání s otázkou', () => {
	it('otázka vyjmenuje, co zmizí, a po souhlasu doklad smaže', async () => {
		documentInVault(summary('20260001'));
		await withPayments();
		mountUi(OverlayHost);

		const deleting = useNuxtApp().vueApp.runWithContext(useInvoices).askRemove('20260001');
		await vi.waitFor(() => expect(layer().find('[data-testid="dialog-message"]').exists()).toBe(true));
		expect(layer().find('[data-testid="dialog-message"]').text()).toBe(
			deletionQuestion(
				{
					number: '20260001',
					documentType: 1,
				},
				2,
			).message,
		);
		await answerDialog(true);

		expect(await deleting).toBe(true);
		expect(backend.args('delete_invoice')).toEqual([
			{
				vaultPath: '/vault',
				number: '20260001',
			},
		]);
	});

	it('odmítnutá otázka nic nesmaže', async () => {
		documentInVault(summary('20260001'));
		mountUi(OverlayHost);

		const deleting = useNuxtApp().vueApp.runWithContext(useInvoices).askRemove('20260001');
		await answerDialog(false);

		expect(await deleting).toBe(false);
		expect(backend.args('delete_invoice')).toEqual([]);
	});

	it('fakturu s dobropisem nesmaže a na nic se neptá', async () => {
		documentInVault(summary('20260001'));
		creditNoteInVault('20260002', '20260001');
		creditNoteInVault('20260003', '20260001');
		mountUi(OverlayHost);

		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).askRemove('20260001')).rejects.toThrow(
			new Error('Faktura 20260001 má dobropis 20260002 a 20260003. Nejdřív smaž dobropis.'),
		);
		expect(layer().find('[data-testid="dialog-message"]').exists()).toBe(false);
		expect(backend.args('delete_invoice')).toEqual([]);
	});

	it('doklad mimo přehled odmítne', async () => {
		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).askRemove('20260009')).rejects.toThrow(
			new Error('Doklad 20260009 v evidenci není.'),
		);
		expect(backend.args('delete_invoice')).toEqual([]);
	});
});

describe('předávání mezi stránkami', () => {
	it('rozpracovaná faktura se sdílí napříč voláními', () => {
		const a = useNuxtApp().vueApp.runWithContext(useInvoices);
		a.pendingInvoice.value = newInvoice(null, '20260009');

		const b = useNuxtApp().vueApp.runWithContext(useInvoices);
		expect(b.pendingInvoice.value?.number).toBe('20260009');
	});
});

describe('sdílený přehled archivu', () => {
	it('opakované čtení vezme přehled z paměti', async () => {
		documentInVault(summary('20260001'));
		const invoices = useNuxtApp().vueApp.runWithContext(useInvoices);

		const first = await invoices.archived();
		documentInVault(summary('20260002'));
		const second = await invoices.archived();

		expect(first.map((i) => i.number)).toEqual(['20260001']);
		expect(second).toEqual(first);
		expect(backend.args('list_invoices')).toHaveLength(1);
	});

	it('čerstvé čtení přehled v paměti obnoví', async () => {
		documentInVault(summary('20260001'));
		const invoices = useNuxtApp().vueApp.runWithContext(useInvoices);
		await invoices.archived();
		documentInVault(summary('20260002'));

		await invoices.list();

		expect(await invoices.archived()).toHaveLength(2);
		expect(backend.args('list_invoices')).toHaveLength(2);
	});

	it('uložení, odeslání i smazání přes appku přehled zahodí', async () => {
		documentInVault(summary('20260001'));
		const invoices = useNuxtApp().vueApp.runWithContext(useInvoices);
		await invoices.archived();

		await invoices.save(validInvoice('20260002'), true);
		const afterSave = await invoices.archived();
		expect(afterSave.map((i) => i.number)).toContain('20260002');

		await invoices.markSent('20260001');
		const sent = await invoices.archived();
		expect(sent.find((i) => i.number === '20260001')?.sentAt).toBe('2026-08-30T14:15:00Z');

		await invoices.remove('20260002');
		const deleted = await invoices.archived();
		expect(deleted.map((i) => i.number)).toEqual(['20260001']);

		// Čtyři přehledy a čtení čerpání před kontrolou uložení.
		expect(backend.args('list_invoices')).toHaveLength(5);
	});

	it('bez datové složky je přehled prázdný a nic se nečte', async () => {
		withoutFolder();

		expect(await useNuxtApp().vueApp.runWithContext(useInvoices).archived()).toEqual([]);
		expect(backend.args('list_invoices')).toEqual([]);
	});
});
