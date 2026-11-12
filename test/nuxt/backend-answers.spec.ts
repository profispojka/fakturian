import { beforeEach, describe, expect, it } from 'vitest';

import { useAdopt } from '~/composables/useAdopt';
import { useExpenses } from '~/composables/useExpenses';
import { useFio } from '~/composables/useFio';
import { useImport } from '~/composables/useImport';
import { useInvoices } from '~/composables/useInvoices';
import { yearOf } from '~/utils/date';

import { backend } from '../setup/backend';
import { date } from '../setup/dates';
import { prepareVault } from '../setup/vault';

import type {
	AdoptCandidate,
	AdoptScan,
	AdoptedSupplier,
	FioPayment,
	ImportReport,
	ImportedCustomer,
	ImportedInvoice,
	Invoice,
	InvoiceLine,
	InvoiceParty,
	InvoiceSummary,
	ReceivedDocument,
	SkippedFile,
} from '~/bindings';

/**
 * Odpovědi se tu **diktují schválně** — a je to jediné místo v sadě, kde je to na místě: testuje
 * se, co se stane, když se `bindings.ts` a backend rozejdou.
 */
beforeEach(async () => {
	await prepareVault();
});

const SIDE: InvoiceParty = {
	name: 'Jan Novák',
	ico: '12345679',
	dic: 'CZ12345679',
	address: {
		street: 'Krátká 2',
		city: 'Brno',
		zip: '60200',
	},
	email: 'jan@novak.cz',
	registration: 'Fyzická osoba zapsaná v živnostenském rejstříku, Živnostenský úřad Brno',
};

const ROW: InvoiceLine = {
	description: 'Práce',
	quantity: 8,
	unit: 'hod',
	unitPriceCents: 120_000,
	itemId: 'p-konzultace',
};

const INVOICE: Invoice = {
	number: '20260005',
	uuid: 'b1e4…',
	documentType: 1,
	originalInvoice: '',
	originalIssueDate: '',
	originalUuid: '',
	issueDate: '2026-03-01',
	dueDate: '2026-03-15',
	supplier: SIDE,
	customer: {
		...SIDE,
		name: 'Acme s.r.o.',
	},
	vatNote: 'Nejsem plátce DPH.',
	bankAccount: '2000145399',
	bankCode: '0800',
	iban: 'CZ6508000000192000145399',
	variableSymbol: '20260005',
	note: '',
	lines: [ROW],
};

const SUMMARY: InvoiceSummary = {
	number: '20260005',
	customer: 'Acme s.r.o.',
	issueDate: '2026-03-01',
	dueDate: '2026-03-15',
	totalCents: 960_000,
	variableSymbol: '20260005',
	documentType: 1,
	originalInvoice: '',
	sentAt: null,
	usageLines: [
		{
			itemId: 'p-konzultace',
			quantity: 8,
			usageYear: 2025,
		},
	],
	path: '/vault/faktury/20260005.pdf',
};

const PAYMENT: FioPayment = {
	id: '26170000123',
	amountCents: 960_000,
	vs: '20260005',
	date: '2026-03-20',
	message: 'Faktura 20260005',
};

const CUSTOMER_FROM_DOCUMENT: ImportedCustomer = {
	name: 'Acme s.r.o.',
	ico: '25596641',
	dic: 'CZ25596641',
	address: {
		street: 'Dlouhá 1',
		city: 'Praha',
		zip: '11000',
	},
	email: 'fakturace@acme.cz',
};

const IMPORTED: ImportedInvoice = {
	number: '2026017',
	customer: 'Acme s.r.o.',
	issueDate: '2026-02-01',
	totalCents: 121_000,
};

const SKIPPED: SkippedFile = {
	file: 'sken.pdf',
	reason: 'PDF bez vloženého ISDOC',
};

const REPORT: ImportReport = {
	imported: [IMPORTED],
	skipped: [SKIPPED],
	customers: [CUSTOMER_FROM_DOCUMENT],
};

const CANDIDATE: AdoptCandidate = {
	path: '/vault/Vydaná faktura - 2026017.pdf',
	file: 'Vydaná faktura - 2026017.pdf',
	number: '2026017',
	customer: 'Acme s.r.o.',
	issueDate: '2026-02-01',
	totalCents: 121_000,
};

const SUPPLIER_FROM_DOCUMENT: AdoptedSupplier = {
	name: 'Jan Novák',
	ico: '12345679',
	address: {
		street: 'Krátká 2',
		city: 'Brno',
		zip: '60200',
	},
	email: 'jan@novak.cz',
	registration: '',
	bankAccount: '2000145399',
	bankCode: '0800',
	iban: '',
	invoiceNumberFormat: '{RRRR}{NNNN}',
	defaultDueDays: 14,
};

const SCAN: AdoptScan = {
	candidates: [CANDIDATE],
	skipped: [SKIPPED],
	supplier: SUPPLIER_FROM_DOCUMENT,
	truncated: false,
};

const RECEIVED_DOCUMENT: ReceivedDocument = {
	file: 'prijate/2026-03-01-hosting.pdf',
	supplier: 'Server s.r.o.',
	supplierIco: '25596641',
	number: '',
	uuid: '',
	description: 'Hosting 03/2026',
	amountCents: 50_000,
	date: '2026-03-01',
	recipientIco: '12345679',
};

function withExtraField(answer: object): Record<string, unknown> {
	return {
		...answer,
		newFieldFromBackend: 'přibylo v backendu',
	};
}

function onWire(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value));
}

describe.each(['Z', '+02:00', '-05:30', '+14:00', '-14:00'])('datum ISDOC s posunem %s', (offset) => {
	it('otevření dokladu zachová den vystavení i splatnosti', async () => {
		backend.returns('load_invoice', {
			...INVOICE,
			issueDate: `2026-03-01${offset}`,
			dueDate: `2026-03-15${offset}`,
		});

		const loaded = await useNuxtApp().vueApp.runWithContext(useInvoices).load('20260005');
		expect(String(loaded.issueDate)).toBe('2026-03-01');
		expect(String(loaded.dueDate)).toBe('2026-03-15');
	});

	it('doklad nezablokuje seznam faktur', async () => {
		const rows = [
			SUMMARY,
			{
				...SUMMARY,
				number: '20260006',
				issueDate: `2026-03-01${offset}`,
				dueDate: `2026-03-15${offset}`,
			},
		];
		backend.returns('list_invoices', {
			items: rows,
			broken: [],
		});

		expect(onWire(await useNuxtApp().vueApp.runWithContext(useInvoices).list())).toEqual([
			SUMMARY,
			{
				...SUMMARY,
				number: '20260006',
			},
		]);
	});

	it('import a převzetí složky přijmou datum dokladu', async () => {
		const report = {
			...REPORT,
			imported: [
				{
					...IMPORTED,
					issueDate: `2026-02-01${offset}`,
				},
			],
		};
		backend.returns('import_documents', report);
		backend.returns('adopt_documents', report);
		backend.returns('scan_vault', {
			...SCAN,
			candidates: [
				{
					...CANDIDATE,
					issueDate: `2026-02-01${offset}`,
				},
			],
		});

		const imported = await useNuxtApp().vueApp.runWithContext(useImport).importFiles(['/a.pdf']);
		const adopted = await useNuxtApp().vueApp.runWithContext(useImport).adoptFiles(['/a.pdf'], '12345679');
		expect(onWire(imported.report.imported)).toEqual([IMPORTED]);
		expect(onWire(adopted.report.imported)).toEqual([IMPORTED]);
		expect(onWire(await useNuxtApp().vueApp.runWithContext(useAdopt).refresh())).toEqual(SCAN);
	});

	it('přijatý doklad dostane kalendářní datum výdaje', async () => {
		backend.returns('import_received', {
			...RECEIVED_DOCUMENT,
			date: `2026-03-01${offset}`,
		});

		const received = await useNuxtApp().vueApp.runWithContext(useExpenses).importDocument('/x.pdf');
		expect(String(received.expense.date)).toBe('2026-03-01');
	});
});

describe('faktura načtená z vaultu', () => {
	it('projde celá, jak ji backend posílá', async () => {
		backend.returns('load_invoice', INVOICE);

		const loaded = await useNuxtApp().vueApp.runWithContext(useInvoices).load('20260005');
		expect(loaded.originalIssueDate).toBeUndefined();
		expect(onWire(loaded)).toEqual({
			...INVOICE,
			originalIssueDate: undefined,
			lines: INVOICE.lines.map((line) => ({
				...line,
				id: expect.any(String),
			})),
		});
	});

	it('data dokladu jsou po načtení kalendářní hodnoty', async () => {
		backend.returns('load_invoice', INVOICE);

		const loaded = await useNuxtApp().vueApp.runWithContext(useInvoices).load('20260005');
		expect(yearOf(loaded.issueDate)).toBe(2026);
	});

	it('prázdná splatnost je chybějící datum, ne chyba', async () => {
		backend.returns('load_invoice', {
			...INVOICE,
			dueDate: '',
		});

		const loaded = await useNuxtApp().vueApp.runWithContext(useInvoices).load('20260005');
		expect(loaded.dueDate).toBeUndefined();
	});

	it('nesmyslné datum vystavení se ohlásí i s polem', async () => {
		backend.returns('load_invoice', {
			...INVOICE,
			issueDate: '2026-02-30',
		});

		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).load('20260005')).rejects.toThrow(
			new Error('Doklad má poškozený obsah (issueDate: Datum musí být ve tvaru RRRR-MM-DD.).'),
		);
	});

	it('řádek si nese itemId až do formuláře', async () => {
		backend.returns('load_invoice', INVOICE);

		const inv = await useNuxtApp().vueApp.runWithContext(useInvoices).load('20260005');
		expect(inv.lines[0]?.itemId).toBe('p-konzultace');
	});

	it('prázdné itemId je platná odpověď', async () => {
		backend.returns('load_invoice', {
			...INVOICE,
			lines: [
				{
					...ROW,
					itemId: '',
				},
			],
		});

		const inv = await useNuxtApp().vueApp.runWithContext(useInvoices).load('20260005');
		expect(inv.lines[0]?.itemId).toBe('');
	});

	it('řádek bez itemId se odmítne — backend ho posílá vždycky', async () => {
		const { itemId: _number, ...withoutLink } = ROW;
		backend.returns('load_invoice', {
			...INVOICE,
			lines: [withoutLink],
		});

		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).load('20260005')).rejects.toThrow(
			new Error(
				'Doklad má poškozený obsah (lines.0.itemId: Neplatný vstup: očekáváno řetězec, obdrženo undefined).',
			),
		);
	});

	it('pole navíc v dokladu se ohlásí', async () => {
		backend.returns('load_invoice', withExtraField(INVOICE));

		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).load('20260005')).rejects.toThrow(
			new Error('Doklad má poškozený obsah (Neznámé klíče: "newFieldFromBackend").'),
		);
	});

	it('pole navíc na straně dokladu se ohlásí taky', async () => {
		backend.returns('load_invoice', {
			...INVOICE,
			customer: withExtraField(SIDE),
		});

		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).load('20260005')).rejects.toThrow(
			new Error('Doklad má poškozený obsah (customer: Neznámé klíče: "newFieldFromBackend").'),
		);
	});
});

describe('souhrn dokladu v seznamu', () => {
	it('projde celý, jak ho backend posílá', async () => {
		backend.returns('list_invoices', {
			items: [SUMMARY],
			broken: [],
		});

		expect(onWire(await useNuxtApp().vueApp.runWithContext(useInvoices).list())).toEqual([SUMMARY]);
	});

	it('nesmyslné datum v seznamu se ohlásí i s pořadím dokladu', async () => {
		backend.returns('list_invoices', {
			items: [
				SUMMARY,
				{
					...SUMMARY,
					number: '20260006',
					issueDate: 'včera',
				},
			],
			broken: [],
		});

		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).list()).rejects.toThrow(
			new Error('Seznam faktur má poškozený obsah (items.1.issueDate: Datum musí být ve tvaru RRRR-MM-DD.).'),
		);
	});

	it('pole navíc se ohlásí', async () => {
		backend.returns('list_invoices', {
			items: [withExtraField(SUMMARY)],
			broken: [],
		});

		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).list()).rejects.toThrow(
			new Error('Seznam faktur má poškozený obsah (items.0: Neznámé klíče: "newFieldFromBackend").'),
		);
	});

	it('součet ve zlomcích haléře se ohlásí', async () => {
		backend.returns('list_invoices', {
			items: [
				{
					...SUMMARY,
					totalCents: 0.5,
				},
			],
			broken: [],
		});

		await expect(useNuxtApp().vueApp.runWithContext(useInvoices).list()).rejects.toThrow(
			new Error(
				'Seznam faktur má poškozený obsah (items.0.totalCents: Neplatný vstup: očekáváno int, obdrženo číslo).',
			),
		);
	});
});

describe('příchozí platba z Fio', () => {
	// Bez tokenu se appka banky vůbec nezeptá — tvar odpovědi by tak neměl kdo zkontrolovat.
	beforeEach(() => {
		backend.fio.token = 'a'.repeat(64);
	});

	it('projde celá, jak ji backend posílá', async () => {
		backend.returns('fio_fetch', [PAYMENT]);

		expect(onWire(await useFio().fetchPayments(date('2026-03-01'), date('2026-03-31')))).toEqual([PAYMENT]);
	});

	it('pole navíc se ohlásí', async () => {
		backend.returns('fio_fetch', [withExtraField(PAYMENT)]);

		await expect(useFio().fetchPayments(date('2026-03-01'), date('2026-03-31'))).rejects.toThrow(
			new Error('Výpis z Fia má poškozený obsah (0: Neznámé klíče: "newFieldFromBackend").'),
		);
	});

	it('částka ve zlomcích haléře se ohlásí', async () => {
		backend.returns('fio_fetch', [
			{
				...PAYMENT,
				amountCents: 0.5,
			},
		]);

		await expect(useFio().fetchPayments(date('2026-03-01'), date('2026-03-31'))).rejects.toThrow(
			new Error('Výpis z Fia má poškozený obsah (0.amountCents: Neplatný vstup: očekáváno int, obdrženo číslo).'),
		);
	});
});

describe('report importu', () => {
	it('projde celý, jak ho backend posílá', async () => {
		backend.returns('import_documents', REPORT);

		const { report, addedContacts } = await useNuxtApp().vueApp.runWithContext(useImport).importFiles(['/a.pdf']);
		expect(onWire(report.imported)).toEqual([IMPORTED]);
		expect(report.skipped).toEqual([SKIPPED]);
		expect(addedContacts).toBe(1);
	});

	it('pole navíc v reportu se ohlásí', async () => {
		backend.returns('import_documents', withExtraField(REPORT));

		await expect(useNuxtApp().vueApp.runWithContext(useImport).importFiles(['/a.pdf'])).rejects.toThrow(
			new Error('Zpráva o importu má poškozený obsah (Neznámé klíče: "newFieldFromBackend").'),
		);
	});

	it('pole navíc u naimportovaného dokladu se ohlásí', async () => {
		backend.returns('import_documents', {
			...REPORT,
			imported: [withExtraField(IMPORTED)],
		});

		await expect(useNuxtApp().vueApp.runWithContext(useImport).importFiles(['/a.pdf'])).rejects.toThrow(
			new Error('Zpráva o importu má poškozený obsah (imported.0: Neznámé klíče: "newFieldFromBackend").'),
		);
	});

	it('součet ve zlomcích haléře u naimportovaného dokladu se ohlásí', async () => {
		backend.returns('import_documents', {
			...REPORT,
			imported: [
				{
					...IMPORTED,
					totalCents: 0.5,
				},
			],
		});

		await expect(useNuxtApp().vueApp.runWithContext(useImport).importFiles(['/a.pdf'])).rejects.toThrow(
			new Error(
				'Zpráva o importu má poškozený obsah (imported.0.totalCents: Neplatný vstup: očekáváno int, obdrženo číslo).',
			),
		);
	});

	it('týž tvar hlídá i převzetí složky', async () => {
		backend.returns('adopt_documents', withExtraField(REPORT));

		await expect(useNuxtApp().vueApp.runWithContext(useImport).adoptFiles(['/a.pdf'], '12345679')).rejects.toThrow(
			new Error('Zpráva o převzetí má poškozený obsah (Neznámé klíče: "newFieldFromBackend").'),
		);
	});
});

describe('sken složky k převzetí', () => {
	it('projde celý, jak ho backend posílá', async () => {
		backend.returns('scan_vault', SCAN);

		expect(onWire(await useNuxtApp().vueApp.runWithContext(useAdopt).refresh())).toEqual(SCAN);
	});

	it('složka bez odvoditelného dodavatele je platný nález', async () => {
		backend.returns('scan_vault', {
			...SCAN,
			supplier: null,
		});

		const found = await useNuxtApp().vueApp.runWithContext(useAdopt).refresh();
		expect(found?.supplier).toBeNull();
	});

	it('pole navíc znamená žádný nález, ne pád', async () => {
		backend.returns('scan_vault', withExtraField(SCAN));

		expect(await useNuxtApp().vueApp.runWithContext(useAdopt).refresh()).toBeNull();
	});

	it('pole navíc u kandidáta znamená taky žádný nález', async () => {
		backend.returns('scan_vault', {
			...SCAN,
			candidates: [withExtraField(CANDIDATE)],
		});

		expect(await useNuxtApp().vueApp.runWithContext(useAdopt).refresh()).toBeNull();
	});
});

describe('přijatý doklad', () => {
	it('projde celý, jak ho backend posílá', async () => {
		backend.returns('import_received', RECEIVED_DOCUMENT);
		const v = await useNuxtApp().vueApp.runWithContext(useExpenses).importDocument('/Users/jan/hosting.pdf');

		expect(v.expense.amountCents).toBe(50_000);
		expect(v.expense.documentFile).toBe('prijate/2026-03-01-hosting.pdf');
	});

	it('pole navíc se ohlásí', async () => {
		backend.returns('import_received', withExtraField(RECEIVED_DOCUMENT));

		await expect(useNuxtApp().vueApp.runWithContext(useExpenses).importDocument('/x.pdf')).rejects.toThrow(
			new Error('Přijatý doklad se nepodařilo přečíst: Neznámé klíče: "newFieldFromBackend"'),
		);
	});
});
