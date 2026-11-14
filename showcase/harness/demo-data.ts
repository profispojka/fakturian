import type {
	AdoptScan,
	DataFileWrite,
	FioPayment,
	ImportReport,
	InvoiceList_Serialize,
	InvoiceSummary_Serialize,
	Invoice_Serialize,
	ReceivedDocument,
} from '../../src/bindings.ts';

interface DemoLine {
	description: string;
	quantity: number;
	unit: string;
	unitPriceCents: number;
	// Vykázané množství se počítá z těchhle řádků, takže demo vault soubor s čerpáním ceníku nemá.
	itemId?: string;
}

interface DemoContact {
	id?: string;
	name: string;
	ico: string;
	dic?: string;
	address: { street: string; city: string; zip: string };
	email?: string;
}

interface DemoInvoice {
	number: string;
	contactId: string;
	issueDate: string;
	dueDate: string;
	lines: DemoLine[];
	documentType: number;
	originalInvoice: string;
	totalCents: number;
	sentAt: string | null;
}

function uuidOf(number: string): string {
	return `00000000-0000-4000-8000-${number.padStart(12, '0')}`;
}

interface CommandArgs {
	key?: string;
	value?: unknown;
	paths?: string[];
	path?: string;
	name?: string;
	json?: string;
	invoice?: { number?: string };
	number?: string;
	reason?: string;
	sourcePath?: string;
	file?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type CommandHandler = (args: CommandArgs) => unknown;

const toCents = (czk: number): number => Math.round(czk * 100); // koruny → haléře
const line = (
	description: string,
	quantity: number,
	unit: string,
	unitPriceCents: number,
	itemId?: string,
): DemoLine => ({
	description,
	quantity,
	unit,
	unitPriceCents,
	itemId,
});
const sum = (lines: DemoLine[]): number =>
	lines.reduce((total, item) => total + Math.round(item.quantity * item.unitPriceCents), 0);
const party = (contact: DemoContact) => ({
	name: contact.name,
	ico: contact.ico,
	dic: contact.dic ?? '',
	address: {
		...contact.address,
	},
	email: contact.email ?? '',
	registration: '',
});
const emptyImport = () =>
	({
		imported: [],
		skipped: [],
		customers: [],
	}) satisfies ImportReport;

(() => {
	const VAULT = '/Users/demo/Documents/Fakturian';

	// Účet i IBAN musí projít kontrolou mod 11 a mod 97: jinak `supplierReadyForInvoicing` neprojde
	// a appka místo dat otevře průvodce.
	const supplier = {
		name: 'Tomáš Havelka',
		ico: '63014726',
		address: {
			street: 'Krátká 12',
			city: 'Brno',
			zip: '60200',
		},
		registration: 'Zapsáno v živnostenském rejstříku',
		bankAccount: '2801937468',
		bankCode: '2010',
		iban: 'CZ2520100000002801937468',
		email: 'faktury@havelka.priklad.cz',
		defaultDueDays: 14,
		invoiceNumberFormat: '{RRRR}{NNNN}',
	};

	const contacts = [
		{
			id: 'c-kolma',
			name: 'Studio Kolmá s.r.o.',
			ico: '28471954',
			dic: 'CZ28471954',
			address: {
				street: 'Sochorova 34',
				city: 'Brno',
				zip: '61600',
			},
			email: 'fakturace@kolma.priklad.cz',
			note: 'Sazba 1 250 Kč/h dohodnutá do konce roku. Fakturovat vždy k 15.',
		},
		{
			id: 'c-novakova',
			name: 'Nováková Design',
			ico: '45190631',
			address: {
				street: 'Bělehradská 18',
				city: 'Praha 2',
				zip: '12000',
			},
			email: 'eva@novakova.priklad.cz',
			note: 'Menší zakázky, platí do týdne.',
		},
		{
			id: 'c-kovoservis',
			name: 'Kovoservis Hrubý a.s.',
			ico: '88025144',
			dic: 'CZ88025144',
			address: {
				street: 'Průmyslová 88',
				city: 'Ostrava',
				zip: '70200',
			},
			email: 'ucetni@kovoservis.priklad.cz',
		},
		{
			id: 'c-bistro',
			name: 'Bistro Pod Lipou s.r.o.',
			ico: '26503182',
			address: {
				street: 'Denisova 7',
				city: 'Olomouc',
				zip: '77900',
			},
			email: 'provoz@podlipou.priklad.cz',
		},
		{
			id: 'c-maly',
			name: 'Petr Malý',
			ico: '71048294',
			address: {
				street: 'Husova 41',
				city: 'Plzeň',
				zip: '30100',
			},
			email: 'petr@maly.priklad.cz',
			note: 'Fyzická osoba, faktury po e-mailu.',
		},
	];

	const pricelist = [
		{
			id: 'p-vyvoj',
			name: 'Vývoj na zakázku',
			priceCents: 125_000,
			unit: 'hod',
			icon: 'i-lucide-code',
		},
		{
			id: 'p-konzultace',
			name: 'Konzultace a code review',
			priceCents: 160_000,
			unit: 'hod',
			icon: 'i-lucide-users',
		},
		{
			id: 'p-udrzba',
			name: 'Měsíční správa a údržba',
			priceCents: 650_000,
			unit: 'měsíc',
			icon: 'i-lucide-calendar',
			annualLimit: 12,
		},
		{
			id: 'p-web',
			name: 'Návrh a nasazení webu',
			priceCents: 7_800_000,
			unit: 'projekt',
			icon: 'i-lucide-paintbrush',
		},
		{
			id: 'p-konzultacni',
			name: 'Konzultační činnost',
			note: 'dovolená',
			priceCents: 125_000,
			unit: 'hod',
			icon: 'i-lucide-tree-palm',
			annualLimit: 160,
		},
	];

	// `lines` jsou zdroj pravdy; částka se z nich dopočítá, ať nikde nesedí součet jinak než na
	// dokladu.
	const invoiceDefs: [string, string, string, string, DemoLine[]][] = [
		['2026001', 'c-kolma', '2026-01-12', '2026-01-26', [line('Vývoj na zakázku', 34, 'hod', 125_000)]],
		['2026002', 'c-novakova', '2026-01-30', '2026-02-13', [line('Konzultace a code review', 12, 'hod', 160_000)]],
		['2026003', 'c-kovoservis', '2026-02-09', '2026-02-23', [line('E-shop — první etapa', 1, 'etapa', 9_600_000)]],
		['2026004', 'c-kolma', '2026-02-27', '2026-03-13', [line('Vývoj na zakázku', 30, 'hod', 125_000)]],
		[
			'2026005',
			'c-bistro',
			'2026-03-11',
			'2026-03-25',
			[line('Návrh objednávkového webu', 1, 'projekt', 2_400_000)],
		],
		['2026006', 'c-kovoservis', '2026-03-30', '2026-04-13', [line('E-shop — druhá etapa', 1, 'etapa', 9_600_000)]],
		[
			'2026007',
			'c-maly',
			'2026-04-14',
			'2026-04-28',
			[line('Konzultace a code review', 5, 'hod', 160_000), line('Vývoj na zakázku', 3.6, 'hod', 125_000)],
		],
		[
			'2026008',
			'c-novakova',
			'2026-04-29',
			'2026-05-13',
			[
				line('Vývoj na zakázku', 11, 'hod', 125_000),
				line('Měsíční správa a údržba', 1, 'měsíc', 750_000, 'p-udrzba'),
			],
		],
		[
			'2026009',
			'c-kolma',
			'2026-05-13',
			'2026-05-27',
			[
				line('Vývoj na zakázku', 56, 'hod', 125_000),
				line('Konzultační činnost', 16, 'hod', 125_000, 'p-konzultacni'),
			],
		],
		[
			'2026010',
			'c-bistro',
			'2026-06-02',
			'2026-06-16',
			[line('Rozvoz — objednávkový modul', 1, 'etapa', 2_650_000)],
		],
		[
			'2026011',
			'c-maly',
			'2026-06-24',
			'2026-07-08',
			[
				line('Vývoj na zakázku', 4.8, 'hod', 125_000),
				line('Konzultační činnost', 8, 'hod', 125_000, 'p-konzultacni'),
			],
		],
		['2026012', 'c-kolma', '2026-07-14', '2026-07-28', [line('Vývoj na zakázku', 72, 'hod', 125_000)]],
		[
			'2026013',
			'c-bistro',
			'2026-07-31',
			'2026-08-14',
			[
				line('Rebranding — vizuál a web', 1, 'projekt', 4_000_000),
				line('Konzultační činnost', 16, 'hod', 125_000, 'p-konzultacni'),
			],
		],
		['2026014', 'c-novakova', '2026-08-11', '2026-08-25', [line('Vývoj na zakázku', 19, 'hod', 125_000)]],
	];

	const contactById = (id: string): DemoContact => {
		const contact = contacts.find((candidate) => candidate.id === id);
		if (!contact) throw new Error(`Kontakt ${id} v demo datech není.`);
		return contact;
	};

	const invoices: DemoInvoice[] = invoiceDefs.map(([number, contactId, issueDate, dueDate, lines]) => ({
		number,
		contactId,
		issueDate,
		dueDate,
		lines,
		documentType: 1,
		originalInvoice: '',
		totalCents: sum(lines),
		sentAt: `${issueDate}T09:00:00Z`,
	}));

	// Dobropis vrací vždy celou fakturu — částečný by appka neuložila.
	const credited = invoices.find((i) => i.number === '2026005');
	if (!credited) throw new Error('Dobropisovaná faktura 2026005 v ukázce chybí.');
	const creditLines = credited.lines.map((l) => ({
		...l,
		unitPriceCents: -l.unitPriceCents,
	}));
	invoices.push({
		number: '2026015',
		contactId: 'c-bistro',
		issueDate: '2026-08-12',
		dueDate: '2026-08-26',
		documentType: 2,
		originalInvoice: '2026005',
		lines: creditLines,
		totalCents: sum(creditLines),
		sentAt: '2026-08-12T09:00:00Z',
	});

	const invoiceByNumber = (number: string | undefined): DemoInvoice => {
		const found = invoices.find((i) => i.number === number);
		if (!found) throw new Error(`Doklad ${number ?? ''} ve vaultu není.`);
		return found;
	};

	// Tvar odpovědí hlídají typy vygenerované z Rustu; obsah pak při načtení ještě projde zod schématy
	// ve `src/services`, stejně jako odpověď skutečného backendu.
	const summary = (i: DemoInvoice) =>
		({
			number: i.number,
			customer: contactById(i.contactId).name,
			issueDate: i.issueDate,
			dueDate: i.dueDate,
			totalCents: i.totalCents,
			variableSymbol: i.number,
			documentType: i.documentType,
			originalInvoice: i.originalInvoice,
			sentAt: i.sentAt,
			usageLines: i.lines.flatMap((l) =>
				l.itemId
					? [
							{
								itemId: l.itemId,
								quantity: l.quantity,
							},
						]
					: [],
			),
			path: `${VAULT}/faktury/${i.number}.pdf`,
		}) satisfies InvoiceSummary_Serialize;

	const detail = (i: DemoInvoice) =>
		({
			number: i.number,
			uuid: uuidOf(i.number),
			documentType: i.documentType,
			originalInvoice: i.originalInvoice,
			originalIssueDate: invoices.find((o) => o.number === i.originalInvoice)?.issueDate ?? '',
			originalUuid: i.originalInvoice ? uuidOf(i.originalInvoice) : '',
			issueDate: i.issueDate,
			dueDate: i.dueDate,
			supplier: {
				...party(supplier),
				registration: supplier.registration,
			},
			customer: party(contactById(i.contactId)),
			vatNote: 'Nejsem plátce DPH.',
			bankAccount: supplier.bankAccount,
			bankCode: supplier.bankCode,
			iban: supplier.iban,
			variableSymbol: i.number,
			note: '',
			lines: i.lines.map((l) => ({
				...l,
				itemId: l.itemId ?? '',
			})),
		}) satisfies Invoice_Serialize;

	const paidDates = {
		2026001: '2026-01-24',
		2026002: '2026-02-10',
		2026003: '2026-02-20',
		2026004: '2026-03-09',
		2026005: '2026-03-21',
		2026006: '2026-04-08',
		2026007: '2026-04-25',
		2026008: '2026-05-11',
		2026009: '2026-05-26',
		2026010: '2026-06-15',
		2026011: '2026-07-06',
	};
	const payments: Record<string, { id: string; date: string; amountCents: number }[]> = {};
	for (const [number, date] of Object.entries(paidDates)) {
		payments[number] = [
			{
				id: `pay-${number}`,
				date,
				amountCents: invoiceByNumber(number).totalCents,
			},
		];
	}
	// Faktura 2026005 byla zaplacená, takže dobropis k ní peníze vrátil.
	payments['2026015'] = [
		{
			id: 'pay-2026015',
			date: '2026-08-14',
			amountCents: -invoiceByNumber('2026015').totalCents,
		},
	];

	const expenses = [
		{
			id: 'e-1',
			supplier: 'Klára Šimková',
			description: 'Grafika — Studio Kolmá',
			amountCents: toCents(40000),
			date: '2026-04-20',
			paid: true,
		},
		{
			id: 'e-2',
			supplier: 'Jan Ryba',
			description: 'Texty na web',
			amountCents: toCents(12000),
			date: '2026-05-05',
			paid: true,
		},
		{
			id: 'e-3',
			supplier: 'Ateliér Světlo',
			description: 'Produktové foto',
			amountCents: toCents(18000),
			date: '2026-03-15',
			paid: true,
		},
		{
			id: 'e-4',
			supplier: 'Anthropic',
			description: 'Claude — předplatné',
			amountCents: toCents(620),
			date: '2026-01-05',
			paid: true,
		},
		{
			id: 'e-5',
			supplier: 'Adobe',
			description: 'Creative Cloud',
			amountCents: toCents(1490),
			date: '2026-01-05',
			paid: true,
		},
		{
			id: 'e-6',
			supplier: 'Ing. Vlková',
			description: 'Účetní',
			amountCents: toCents(1800),
			date: '2026-01-15',
			paid: true,
		},
		{
			id: 'e-7',
			supplier: 'Wedos',
			description: 'Doména a hosting',
			amountCents: toCents(2400),
			date: '2026-02-01',
			paid: true,
		},
		{
			id: 'e-8',
			supplier: 'Alfa Computers',
			description: 'Notebook',
			amountCents: toCents(68000),
			date: '2026-02-02',
			paid: true,
		},
	];

	const files: Record<string, unknown> = {
		'nastaveni.json': {
			supplier,
			contacts,
			pricelist,
		},
		'vydaje.json': {
			expenses,
		},
		'platby.json': {
			payments,
		},
	};

	let hasLogo = false;

	const handlers: Record<string, CommandHandler> = {
		load_vault_path: () => VAULT,
		save_vault_path: () => null,
		default_vault_path: () => VAULT,
		home_dir: () => '/Users/demo',
		set_window_theme: () => null,
		close_window: () => null,
		notify: () => null,
		open_url: () => null,
		reveal_path: () => null,
		pick_folder: () => null,
		pick_files: () => [],
		pick_save_path: () => null,
		snapshots_path: () => null,
		ares_subject: () => null,

		ensure_vault: () => null,
		check_vault: () => null,
		vault_has_logo: () => hasLogo,
		set_vault_logo: () => {
			hasLogo = true;
			return null;
		},
		remove_vault_logo: () => {
			hasLogo = false;
			return null;
		},
		read_data_file: ({ name }) => JSON.stringify((name && files[name]) ?? {}),
		write_data_file: ({ name, json }) => {
			if (!name || !json) throw new Error('Chybí název nebo obsah souboru.');
			const parsed: unknown = JSON.parse(json);
			if (!isRecord(parsed)) throw new Error('Obsah datového souboru musí být objekt.');
			files[name] = parsed;
			return 'written' satisfies DataFileWrite;
		},
		restore_weeks_back: () => null,

		list_invoices: () =>
			({
				items: invoices.map(summary),
				broken: [],
			}) satisfies InvoiceList_Serialize,
		list_used_numbers: () => invoices.map((i) => i.number),
		load_invoice: ({ number }) => detail(invoiceByNumber(number)),
		save_invoice: ({ invoice }) => `${VAULT}/faktury/${invoice?.number ?? '2026016'}.pdf`,
		preview_invoice: () => ['<svg xmlns="http://www.w3.org/2000/svg" width="595" height="842"/>'],
		export_invoice_pdf: () => null,
		mark_invoice_sent: ({ number }) => {
			const invoice = invoiceByNumber(number);
			invoice.sentAt = invoice.sentAt ?? new Date().toISOString();
			return invoice.sentAt;
		},
		delete_invoice: ({ number }) => {
			invoices.splice(invoices.indexOf(invoiceByNumber(number)), 1);
			return null;
		},

		fio_has_token: () => true,
		fio_set_token: () => null,
		fio_clear_token: () => null,
		fio_fetch: () => [] satisfies FioPayment[],

		mcp_attach: () => null,
		mcp_send: () => null,
		mcp_socket_path: () => '/Users/demo/Library/Application Support/com.fakturian.desktop/mcp.sock',
		mcp_connector: () => ({ command: '/Applications/Fakturian.app/Contents/MacOS/Fakturian', args: ['--mcp'] }),

		scan_vault: () =>
			({
				candidates: [],
				skipped: [],
				supplier: null,
				truncated: false,
			}) satisfies AdoptScan,
		import_documents: emptyImport,
		adopt_documents: emptyImport,
		import_received: ({ sourcePath }) =>
			({
				file: sourcePath?.split('/').pop() ?? 'doklad.pdf',
				supplier: 'Wedos',
				supplierIco: '',
				number: 'FV2026118',
				uuid: '',
				description: 'Faktura FV2026118',
				amountCents: toCents(2400),
				date: '',
				recipientIco: supplier.ico,
			}) satisfies ReceivedDocument,
		list_broken_received: () => [],
		remove_received: () => null,
		received_path: ({ file }) => `${VAULT}/prijate/${file}`,
		mail_compose_with_attachment: () => null,
	};

	const invoke = async (cmd: string, args: unknown = {}): Promise<unknown> => {
		const fn = handlers[cmd];
		// Tiché `null` by appka vzala jako platnou odpověď a snímek by vznikl nad chybějícími daty.
		if (!fn) throw new Error(`Demo harness neobsluhuje příkaz ${cmd}.`);
		const commandArgs = typeof args === 'object' && args !== null ? (args as CommandArgs) : {};
		return await fn(commandArgs);
	};

	// Přes `Object.assign`: odpověď harnessu typ příkazu nenese, její tvar ověří až schémata ve frontendu.
	Object.assign(globalThis, {
		fakturian: {
			invoke,
			// Harness žádné události neposílá, takže odhlášení posluchače nemá co uklízet.
			on: () => () => undefined,
			pathForFile: (file: File) => `/Users/demo/Downloads/${file.name}`,
		},
	});
})();
