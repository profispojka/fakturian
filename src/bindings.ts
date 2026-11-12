export interface CommandArgs {
	ensure_vault: { vaultPath: string };
	vault_has_logo: { vaultPath: string };
	set_vault_logo: { vaultPath: string; source: string };
	remove_vault_logo: { vaultPath: string };
	read_data_file: { vaultPath: string; name: string };
	write_data_file: { vaultPath: string; name: string; json: string };
	snapshots_path: { vaultPath: string };
	import_documents: { vaultPath: string; paths: string[]; ourIco: string | null };
	scan_vault: { vaultPath: string; ourIco: string | null };
	adopt_documents: { vaultPath: string; paths: string[]; ourIco: string | null };
	mail_compose_with_attachment: { vaultPath: string; to: string; subject: string; body: string; attachment: string };
	import_received: { vaultPath: string; sourcePath: string };
	list_broken_received: { vaultPath: string };
	remove_received: { vaultPath: string; file: string };
	received_path: { vaultPath: string; file: string };
	list_used_numbers: { vaultPath: string };
	mark_invoice_sent: { vaultPath: string; number: string };
	delete_invoice: { vaultPath: string; number: string };
	save_invoice: { vaultPath: string; invoice: Invoice_Deserialize; isNew: boolean };
	preview_invoice: { vaultPath: string; invoice: Invoice_Deserialize };
	load_invoice: { vaultPath: string; number: string };
	export_invoice_pdf: { vaultPath: string; number: string; target: string };
	list_invoices: { vaultPath: string };
	fio_set_token: { token: string };
	fio_has_token: Record<string, never>;
	fio_clear_token: Record<string, never>;
	fio_fetch: { from: string; to: string };
	ares_subject: { ico: string };
	mcp_attach: Record<string, never>;
	mcp_send: { session: number; line: string };
	mcp_socket_path: Record<string, never>;
	mcp_connector: Record<string, never>;
	pick_folder: { defaultPath: string };
	pick_files: { filterName: string; extensions: string[]; multiple: boolean };
	pick_save_path: { defaultName: string; filterName: string; extensions: string[] };
	open_url: { url: string };
	reveal_path: { path: string };
	notify: { title: string; body: string };
	home_dir: Record<string, never>;
	default_vault_path: Record<string, never>;
	load_vault_path: Record<string, never>;
	save_vault_path: { vaultPath: string };
	set_window_theme: { theme: 'light' | 'dark' };
	close_window: Record<string, never>;
}

export interface CommandResults {
	ensure_vault: null;
	vault_has_logo: boolean;
	set_vault_logo: null;
	remove_vault_logo: null;
	read_data_file: string;
	write_data_file: DataFileWrite;
	snapshots_path: string | null;
	import_documents: ImportReport;
	scan_vault: AdoptScan;
	adopt_documents: ImportReport;
	mail_compose_with_attachment: null;
	import_received: ReceivedDocument;
	list_broken_received: BrokenReceived[];
	remove_received: null;
	received_path: string;
	list_used_numbers: string[];
	mark_invoice_sent: string;
	delete_invoice: null;
	save_invoice: string;
	preview_invoice: string[];
	load_invoice: Invoice_Serialize;
	export_invoice_pdf: null;
	list_invoices: InvoiceList_Serialize;
	fio_set_token: null;
	fio_has_token: boolean;
	fio_clear_token: null;
	fio_fetch: FioPayment[];
	// Odpověď ARES je cizí JSON; tvar ověřuje `services/ares.ts`.
	ares_subject: unknown;
	mcp_attach: null;
	mcp_send: null;
	mcp_socket_path: string;
	mcp_connector: McpConnector;
	// `null` je zrušený dialog, `pick_files` ho hlásí prázdným seznamem.
	pick_folder: string | null;
	pick_files: string[];
	pick_save_path: string | null;
	open_url: null;
	reveal_path: null;
	notify: null;
	home_dir: string;
	default_vault_path: string;
	load_vault_path: string | null;
	save_vault_path: null;
	set_window_theme: null;
	close_window: null;
}

export type CommandName = keyof CommandArgs;

// Červené tlačítko, ⌘W i ⌘Q: okno se zavře až přes `close_window`, když hlídka rozepsaného dokladu pustí.
export const CLOSE_REQUESTED_EVENT = 'close-requested' as const;
export const FOCUS_CHANGED_EVENT = 'focus-changed' as const;

// Chybu příkazu dostane webview jako holý řetězec, stejně jako ji `errorText()` čeká. Tvar výsledku
// zaručuje `satisfies Contract` v `desktop/commands.ts`.
export interface DesktopBridge {
	// Argumenty ověří až hlavní proces; přes most jdou jako kopie obyčejných dat.
	invoke<Name extends CommandName>(name: Name, args: unknown): Promise<CommandResults[Name]>;
	on(channel: string, listener: (payload: unknown) => void): () => void;
	// Chromium přetaženému `File` cestu nedá; zná ji jen `webUtils` v preloadu.
	pathForFile(file: File): string;
}

// Přes `globalThis`, ne `Window`: soubor importuje i hlavní proces, který typy DOM nemá.
declare global {
	var fakturian: DesktopBridge | undefined;
}

function invoke<Name extends CommandName>(name: Name, args: CommandArgs[Name]): Promise<CommandResults[Name]> {
	const bridge = globalThis.fakturian;
	if (!bridge) return Promise.reject(new Error('Příkaz běží jen v desktopové appce.'));
	// `contextBridge` argumenty kopíruje a reaktivní proxy Vue neunese („An object could not be cloned.“);
	// kopie přes JSON z nich udělá obyčejná data. Kontrakt jiné hodnoty než JSON nepřenáší.
	return bridge.invoke(name, JSON.parse(JSON.stringify(args)));
}

export const commands = {
	// `.fakturian/` založí až první zápis dat nebo cache.
	ensureVault: (vaultPath: string) => invoke('ensure_vault', { vaultPath }),
	vaultHasLogo: (vaultPath: string) => invoke('vault_has_logo', { vaultPath }),
	setVaultLogo: (vaultPath: string, source: string) =>
		invoke('set_vault_logo', {
			vaultPath,
			source,
		}),
	removeVaultLogo: (vaultPath: string) => invoke('remove_vault_logo', { vaultPath }),
	// Chybějící soubor je normální stav (nový vault), ne chyba.
	readDataFile: (vaultPath: string, name: string) =>
		invoke('read_data_file', {
			vaultPath,
			name,
		}),
	writeDataFile: (vaultPath: string, name: string, json: string) =>
		invoke('write_data_file', {
			vaultPath,
			name,
			json,
		}),
	// `null`: ještě se žádná záloha neuložila. Obnova je ruční, appka složku jen ukáže ve Finderu.
	snapshotsPath: (vaultPath: string) => invoke('snapshots_path', { vaultPath }),
	// `ourIco` brání tomu, aby se mezi vydané faktury dostal přijatý doklad a nafoukl limit plátcovství.
	importDocuments: (vaultPath: string, paths: string[], ourIco: string | null) =>
		invoke('import_documents', {
			vaultPath,
			paths,
			ourIco,
		}),
	scanVault: (vaultPath: string, ourIco: string | null) =>
		invoke('scan_vault', {
			vaultPath,
			ourIco,
		}),
	adoptDocuments: (vaultPath: string, paths: string[], ourIco: string | null) =>
		invoke('adopt_documents', {
			vaultPath,
			paths,
			ourIco,
		}),
	// Selže, když AppleScript nedoběhne — volající pak spadne zpátky na `mailto:`.
	mailComposeWithAttachment: (vaultPath: string, to: string, subject: string, body: string, attachment: string) =>
		invoke('mail_compose_with_attachment', {
			vaultPath,
			to,
			subject,
			body,
			attachment,
		}),
	importReceived: (vaultPath: string, sourcePath: string) =>
		invoke('import_received', {
			vaultPath,
			sourcePath,
		}),
	listBrokenReceived: (vaultPath: string) => invoke('list_broken_received', { vaultPath }),
	// Volá se, když se import odmítne kvůli příjemci — cizí doklad nemá ve vaultu co dělat.
	removeReceived: (vaultPath: string, file: string) =>
		invoke('remove_received', {
			vaultPath,
			file,
		}),
	receivedPath: (vaultPath: string, file: string) =>
		invoke('received_path', {
			vaultPath,
			file,
		}),
	// Smazaný doklad leží v Koši a své číslo uvolnil.
	listUsedNumbers: (vaultPath: string) => invoke('list_used_numbers', { vaultPath }),
	// Jednosměrné: zrušení příznaku by znovu dovolilo přepsat doklad, který už mohl dostat zákazník.
	markInvoiceSent: (vaultPath: string, number: string) =>
		invoke('mark_invoice_sent', {
			vaultPath,
			number,
		}),
	deleteInvoice: (vaultPath: string, number: string) =>
		invoke('delete_invoice', {
			vaultPath,
			number,
		}),
	saveInvoice: (vaultPath: string, invoice: Invoice_Deserialize, isNew: boolean) =>
		invoke('save_invoice', {
			vaultPath,
			invoice,
			isNew,
		}),
	previewInvoice: (vaultPath: string, invoice: Invoice_Deserialize) =>
		invoke('preview_invoice', {
			vaultPath,
			invoice,
		}),
	// Podle čísla ve `faktury/`, ne podle cesty: příkaz, který přečte libovolný soubor, by s XSS
	// posloužil jako čtečka disku.
	loadInvoice: (vaultPath: string, number: string) =>
		invoke('load_invoice', {
			vaultPath,
			number,
		}),
	exportInvoicePdf: (vaultPath: string, number: string, target: string) =>
		invoke('export_invoice_pdf', {
			vaultPath,
			number,
			target,
		}),
	listInvoices: (vaultPath: string) => invoke('list_invoices', { vaultPath }),
	fioSetToken: (token: string) => invoke('fio_set_token', { token }),
	// Hledání vrací jen atributy položky, ne heslo, takže se klíčenka na povolení neptá.
	fioHasToken: () => invoke('fio_has_token', {}),
	fioClearToken: () => invoke('fio_clear_token', {}),
	fioFetch: (from: string, to: string) =>
		invoke('fio_fetch', {
			from,
			to,
		}),
	// Z hlavního procesu: webview by na ares.gov.cz narazilo na CORS.
	aresSubject: (ico: string) => invoke('ares_subject', { ico }),
	mcpAttach: () => invoke('mcp_attach', {}),
	mcpSend: (session: number, line: string) =>
		invoke('mcp_send', {
			session,
			line,
		}),
	mcpSocketPath: () => invoke('mcp_socket_path', {}),
	mcpConnector: () => invoke('mcp_connector', {}),
	pickFolder: (defaultPath: string) => invoke('pick_folder', { defaultPath }),
	pickFiles: (filterName: string, extensions: string[], multiple: boolean) =>
		invoke('pick_files', {
			filterName,
			extensions,
			multiple,
		}),
	pickSavePath: (defaultName: string, filterName: string, extensions: string[]) =>
		invoke('pick_save_path', {
			defaultName,
			filterName,
			extensions,
		}),
	openUrl: (url: string) => invoke('open_url', { url }),
	revealPath: (path: string) => invoke('reveal_path', { path }),
	notify: (title: string, body: string) =>
		invoke('notify', {
			title,
			body,
		}),
	homeDir: () => invoke('home_dir', {}),
	defaultVaultPath: () => invoke('default_vault_path', {}),
	loadVaultPath: () => invoke('load_vault_path', {}),
	saveVaultPath: (vaultPath: string) => invoke('save_vault_path', { vaultPath }),
	setWindowTheme: (theme: 'light' | 'dark') => invoke('set_window_theme', { theme }),
	closeWindow: () => invoke('close_window', {}),
};

// Agent spouští connector jako `command` s `args` (`--mcp`); ve vývoji je to Electron s cestou k appce.
export type McpConnector = {
	command: string;
	args: string[];
};

/* Constants */
export const DOCUMENT_EXTENSION = 'pdf' as const;

export const DOCUMENT_TYPE_CREDIT_NOTE = 2 as const;

export const DOCUMENT_TYPE_INVOICE = 1 as const;

export const MAX_CENTS = 9000000000000 as const;

export const MCP_MESSAGE_EVENT = 'mcp-message' as const;

export const NON_VAT_PAYER_NOTE = 'Nejsem plátce DPH.' as const;

export const SNAPSHOT_WEEKS = 5 as const;

/* Types */
export type Address = {
	street: string;
	city: string;
	zip: string;
};

export type AdoptCandidate = {
	path: string;
	file: string;
	number: string;
	customer: string;
	issueDate: string;
	totalCents: number;
};

export type AdoptScan = {
	candidates: AdoptCandidate[];
	skipped: SkippedFile[];
	supplier: AdoptedSupplier | null;
	/**
	 *  Sken narazil na limit souborů. Musí se říct nahlas: jinak vypadá neúplný výsledek jako
	 *  úplný.
	 */
	truncated: boolean;
};

export type AdoptedSupplier = {
	name: string;
	ico: string;
	address: Address;
	email: string;
	registration: string;
	bankAccount: string;
	bankCode: string;
	iban: string;
	invoiceNumberFormat: string;
	defaultDueDays: number | null;
};

export type BrokenInvoice = {
	fileName: string;
	path: string;
	reason: string;
};

export type BrokenReceived = {
	file: string;
	reason: string;
};

export type DataFileWrite = 'written' | 'conflict';

export type FioPayment = {
	/**  ID pohybu (`column22`); podle něj synchronizace pozná pohyb, který už zapsala. */
	id: string;
	/**
	 *  Celé haléře hned z rozboru: párování porovnává s `InvoiceSummary.totalCents` a desetinné
	 *  číslo by do něj vneslo nepřesnost plovoucí čárky.
	 */
	amountCents: number;
	vs: string;
	date: string;
	message: string;
};

export type ImportReport = {
	imported: ImportedInvoice[];
	skipped: SkippedFile[];
	customers: ImportedCustomer[];
};

export type ImportedCustomer = {
	name: string;
	ico: string;
	dic: string;
	address: Address;
	email: string;
};

export type ImportedInvoice = {
	number: string;
	customer: string;
	issueDate: string;
	totalCents: number;
};

export type Invoice = Invoice_Serialize | Invoice_Deserialize;

export type InvoiceLine = InvoiceLine_Serialize | InvoiceLine_Deserialize;

export type InvoiceLine_Deserialize = {
	description: string;
	quantity: number;
	unit: string;
	unitPriceCents: number;
	/**
	 *  Položka ceníku, ze které řádek vznikl. Jde do ISDOC (`Item/SellersItemIdentification/ID`),
	 *  takže vazbu nese doklad sám a neodvozuje se z názvu, který jde přejmenovat.
	 */
	itemId?: string;
	/**
	 *  Rok ročního limitu položky ceníku. Jde do ISDOC (`Extensions/fakturian:UsageYear`), takže
	 *  vykázané množství se dá spočítat z archivu dokladů.
	 */
	usageYear?: number | null;
};

export type InvoiceLine_Serialize = {
	description: string;
	quantity: number;
	unit: string;
	unitPriceCents: number;
	/**
	 *  Položka ceníku, ze které řádek vznikl. Jde do ISDOC (`Item/SellersItemIdentification/ID`),
	 *  takže vazbu nese doklad sám a neodvozuje se z názvu, který jde přejmenovat.
	 */
	itemId: string;
	/**
	 *  Rok ročního limitu položky ceníku. Jde do ISDOC (`Extensions/fakturian:UsageYear`), takže
	 *  vykázané množství se dá spočítat z archivu dokladů.
	 */
	usageYear?: number | null;
};

export type InvoiceList = InvoiceList_Serialize | InvoiceList_Deserialize;

export type InvoiceList_Deserialize = {
	items: InvoiceSummary_Deserialize[];
	broken: BrokenInvoice[];
};

export type InvoiceList_Serialize = {
	items: InvoiceSummary_Serialize[];
	broken: BrokenInvoice[];
};

export type InvoiceParty = {
	name: string;
	ico?: string;
	dic?: string;
	address?: Address;
	email?: string;
	/**  Zápis do obchodního rejstříku nebo jiné evidence, jak ho žádá § 435 odst. 1 OZ. */
	registration?: string;
};

export type InvoiceSummary = InvoiceSummary_Serialize | InvoiceSummary_Deserialize;

export type InvoiceSummary_Deserialize = {
	number: string;
	customer: string;
	issueDate: string;
	dueDate: string;
	totalCents: number;
	/**
	 *  Variabilní symbol — Fio páruje podle něj, ne podle čísla dokladu (to může být u vlastní
	 *  šablony řady nečíselné).
	 */
	variableSymbol?: string;
	documentType: number;
	/**  U dobropisu číslo faktury, kterou opravuje; podle něj se faktura počítá jako vypořádaná. */
	originalInvoice: string;
	sentAt?: string | null;
	/**  Jen řádky s vazbou na ceník — doklad bez jediné položky z ceníku do limitů nemluví. */
	usageLines: UsageLine_Deserialize[];
	path: string;
};

export type InvoiceSummary_Serialize = {
	number: string;
	customer: string;
	issueDate: string;
	dueDate: string;
	totalCents: number;
	/**
	 *  Variabilní symbol — Fio páruje podle něj, ne podle čísla dokladu (to může být u vlastní
	 *  šablony řady nečíselné).
	 */
	variableSymbol: string;
	documentType: number;
	/**  U dobropisu číslo faktury, kterou opravuje; podle něj se faktura počítá jako vypořádaná. */
	originalInvoice: string;
	sentAt: string | null;
	/**  Jen řádky s vazbou na ceník — doklad bez jediné položky z ceníku do limitů nemluví. */
	usageLines: UsageLine_Serialize[];
	path: string;
};

export type Invoice_Deserialize = {
	number: string;
	uuid?: string;
	documentType?: number;
	/**  Číslo původní faktury (u dobropisu, jinak prázdné). */
	originalInvoice?: string;
	originalIssueDate?: string;
	originalUuid?: string;
	issueDate: string;
	dueDate: string;
	supplier: InvoiceParty;
	customer: InvoiceParty;
	/**
	 *  Veze se s dokladem, ne s konfigurací: pozdější změna formulace nesmí přepsat, co bylo
	 *  vytištěné na starých fakturách.
	 */
	vatNote?: string;
	bankAccount?: string;
	bankCode?: string;
	iban?: string;
	variableSymbol?: string;
	note?: string;
	lines: InvoiceLine_Deserialize[];
};

export type Invoice_Serialize = {
	number: string;
	uuid: string;
	documentType: number;
	/**  Číslo původní faktury (u dobropisu, jinak prázdné). */
	originalInvoice: string;
	originalIssueDate: string;
	originalUuid: string;
	issueDate: string;
	dueDate: string;
	supplier: InvoiceParty;
	customer: InvoiceParty;
	/**
	 *  Veze se s dokladem, ne s konfigurací: pozdější změna formulace nesmí přepsat, co bylo
	 *  vytištěné na starých fakturách.
	 */
	vatNote: string;
	bankAccount: string;
	bankCode: string;
	iban: string;
	variableSymbol: string;
	note: string;
	lines: InvoiceLine_Serialize[];
};

export type ReceivedDocument = {
	file: string;
	supplier: string;
	supplierIco: string;
	/**  Číslo a UUID dokladu z ISDOC; podle nich frontend pozná doklad, který už ve výdajích je. */
	number: string;
	uuid: string;
	description: string;
	amountCents: number;
	date: string;
	recipientIco: string;
};

export type SkippedFile = {
	file: string;
	reason: string;
};

/**
 *  Řádek s vazbou na ceník. Vykázané množství i roční limit se počítají z těchhle řádků, takže
 *  jdou do přehledu dokladů — samostatná evidence ve vaultu by byla druhá pravda.
 */
export type UsageLine = UsageLine_Serialize | UsageLine_Deserialize;

/**
 *  Řádek s vazbou na ceník. Vykázané množství i roční limit se počítají z těchhle řádků, takže
 *  jdou do přehledu dokladů — samostatná evidence ve vaultu by byla druhá pravda.
 */
export type UsageLine_Deserialize = {
	itemId: string;
	quantity: number;
	usageYear?: number | null;
};

/**
 *  Řádek s vazbou na ceník. Vykázané množství i roční limit se počítají z těchhle řádků, takže
 *  jdou do přehledu dokladů — samostatná evidence ve vaultu by byla druhá pravda.
 */
export type UsageLine_Serialize = {
	itemId: string;
	quantity: number;
	usageYear?: number | null;
};
