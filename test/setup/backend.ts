import { CLOSE_REQUESTED_EVENT, FOCUS_CHANGED_EVENT, MCP_MESSAGE_EVENT } from '~/bindings';
import { isDateString } from '~/utils/date';
import { isValidIco } from '~/utils/validators';

import type { Scheduler } from 'fast-check';
import type { BrokenReceived, DesktopBridge, FioPayment, Invoice, InvoiceSummary } from '~/bindings';
import type { AresParty } from '~/schemas/ares';
import type { Invoice as MemoryInvoice } from '~/schemas/invoices';

/** Testy jím složku plní, aby nemusely psát doklad podruhé s daty jako řetězci. */
export function wireInvoice(inv: MemoryInvoice): Invoice {
	return {
		...inv,
		lines: inv.lines.map(({ id: _id, usageYear, ...line }) => ({
			...line,
			...(usageYear !== undefined && { usageYear }),
		})),
		issueDate: inv.issueDate.toString(),
		dueDate: inv.dueDate?.toString() ?? '',
		originalIssueDate: inv.originalIssueDate?.toString() ?? '',
	};
}

interface Folder {
	files: Map<string, string>;
	/** Obsah, jak ho appka naposledy přečetla nebo zapsala — backend si drží jeho otisk. */
	seen: Map<string, string | null>;
	invoices: Map<string, Invoice>;
	sent: Map<string, string>;
	/** Cesta ke složce záloh, nebo `null`, dokud se žádná neuložila. */
	snapshotsPath: string | null;
	/** Soubory v `prijate/`, které backend nepřečte. */
	brokenReceived: BrokenReceived[];
	/** Čísla dokladů převzatých z cizího softwaru; archivovaný záznam backend přepsat nedovolí. */
	issuedElsewhere: Set<string>;
}

function emptyFolder(): Folder {
	return {
		files: new Map(),
		seen: new Map(),
		invoices: new Map(),
		sent: new Map(),
		snapshotsPath: null,
		brokenReceived: [],
		issuedElsewhere: new Set(),
	};
}

type Answer = { value: unknown } | { error: string };

class Window {
	theme: string | null = null;
	closed = false;
}

export type AresCompany = Omit<AresParty, 'registration'> & {
	inCommercialRegister?: boolean;
	tradeLicensed?: boolean;
};

/** ARES jako **rejstřík**, ne jako nadiktovaná odpověď. */
class Ares {
	companies = new Map<string, unknown>();

	unavailable = false;

	write(company: AresCompany): void {
		this.companies.set(company.ico, {
			obchodniJmeno: company.name,
			ico: company.ico,
			dic: company.dic,
			sidlo: {
				textovaAdresa: company.address.street,
				nazevObce: company.address.city,
				psc: Number(company.address.zip.replace(/\s/g, '')),
			},
			seznamRegistraci: {
				stavZdrojeVr: company.inCommercialRegister ? 'AKTIVNI' : 'NEEXISTUJICI',
				stavZdrojeRzp: company.tradeLicensed ? 'AKTIVNI' : 'NEEXISTUJICI',
			},
		});
	}

	writeLiteral(ico: string, body: unknown): void {
		this.companies.set(ico, body);
	}
}

class Fio {
	token: string | null = null;

	keychainFails = false;

	unavailable = false;

	movements: FioPayment[] = [];
}

class Mcp {
	socket = '/tmp/fakturian-test.sock';

	connector = {
		command: '/Applications/Fakturian.app/Contents/MacOS/Fakturian',
		args: ['--mcp'],
	};

	private nextId = 0;

	/** Pošle oknu, co most přeposílá ze spojení klienta. */
	deliver(payload: unknown): void {
		backend.emit(MCP_MESSAGE_EVENT, payload);
	}

	/** Pošle oknu požadavek JSON-RPC ze spojení `session` a vrátí jeho `id`. */
	request(method: string, params: unknown, session = 1): number {
		this.nextId += 1;
		this.deliver({
			session,
			line: JSON.stringify({
				jsonrpc: '2.0',
				id: this.nextId,
				method,
				params,
			}),
		});
		return this.nextId;
	}

	/** Agent vzdal čekání na volání `requestId`. */
	cancel(requestId: number, session = 1): void {
		this.deliver({
			session,
			line: JSON.stringify({
				jsonrpc: '2.0',
				method: 'notifications/cancelled',
				params: {
					requestId,
				},
			}),
		});
	}

	call(tool: string, args: unknown = {}, session = 1): number {
		return this.request(
			'tools/call',
			{
				name: tool,
				arguments: args,
			},
			session,
		);
	}
}

class Backend {
	folders = new Map<string, Folder>();

	files = new Set<string>();

	/** Cizí PDF s ISDOC podle cesty — co import a převzetí do `faktury/` přesunou. */
	foreign = new Map<string, Invoice>();

	/** Nastavení hlavního procesu (`vaultPath`), které přežije restart appky. */
	store = new Map<string, string>();

	/** Odpovědi systémových dialogů po řadě; `null` je zrušený dialog. */
	dialog: (string | string[] | null)[] = [];

	/** Kde dialog startoval — appka tím říká, kde uživatel složku nejspíš hledá. */
	dialogStarts: (string | undefined)[] = [];

	open: string[] = [];
	exposed: string[] = [];

	notification: { title: string; body: string }[] = [];

	ares = new Ares();

	/** Domovská složka uživatele; doporučená datová složka pod ní leží jen tehdy, když ji test nepřestaví. */
	home = '/Users/test';

	/** Posluchače událostí hlavního procesu podle kanálu (`window.fakturian.on`). */
	listeners = new Map<string, Set<{ listener: (payload: unknown) => void }>>();

	/** Cesty souborů přetažených z Finderu; Chromium je `File` nedá, zná je jen preload. */
	dropped = new Map<File, string>();

	fio = new Fio();

	mcp = new Mcp();

	/** Nadiktované odpovědi; každá platí pro jedno volání, po nich odpovídá fake. */
	answers = new Map<string, Answer[]>();

	/** Odpověď příkazu bez fake na každé volání, které nemá nadiktované `returns`/`fails`. */
	steady = new Map<string, unknown>();

	/** Příkazy rozbité, dokud je test neopraví (`repairs`) — plný disk nebo zamčený soubor. */
	broken = new Map<string, string>();

	calls: { command: string; args: Record<string, unknown> }[] = [];

	forgetCalls(): void {
		this.calls.length = 0;
	}

	args(command: string): Record<string, unknown>[] {
		return this.calls.filter((v) => v.command === command).map((v) => v.args);
	}

	returns(command: string, ...values: unknown[]): void {
		const queue = this.answers.get(command) ?? [];
		for (const value of values) queue.push({ value });
		this.answers.set(command, queue);
	}

	/** Příští volání selže; další už odpoví podle fronty nebo fake. */
	fails(command: string, error: string): void {
		const queue = this.answers.get(command) ?? [];
		queue.push({ error });
		this.answers.set(command, queue);
	}

	/** Příkaz bez fake, který appka volá opakovaně (sken složky), odpovídá pořád stejně. */
	keepsReturning(command: string, value: unknown): void {
		this.steady.set(command, value);
	}

	/** Každé další volání selže, dokud test nezavolá `repairs`. */
	breaks(command: string, error: string): void {
		this.broken.set(command, error);
	}

	repairs(command: string): void {
		this.broken.delete(command);
	}

	window = new Window();

	/** Pošle oknu událost hlavního procesu. */
	emit(channel: string, payload?: unknown): void {
		for (const entry of this.listeners.get(channel) ?? []) entry.listener(payload);
	}

	listening(channel: string): number {
		return this.listeners.get(channel)?.size ?? 0;
	}

	/** Zaostření okna, jak ho hlásí hlavní proces. */
	setFocused(focused: boolean): void {
		this.emit(FOCUS_CHANGED_EVENT, focused);
	}

	postponed = new Map<string, (() => Promise<void>)[]>();

	/** Kdy doběhnou asynchronní příkazy z `ASYNC_COMMANDS`; bez něj hned, v pořadí volání. */
	scheduler: Scheduler | null = null;

	/** Selhání rozhodnuté pro každé volání zvlášť — ze souběžných volání tak padne jen některé. */
	fault: ((command: string) => string | null) | null = null;

	folder(path: string): Folder {
		const s = this.folders.get(path);
		if (!s) throw new Error(`Datová složka ${path} neexistuje.`);
		return s;
	}

	create(path = '/vault'): Folder {
		const s = emptyFolder();
		this.folders.set(path, s);
		return s;
	}

	/** Zapíše doménový soubor tak, jak by ho na disku našla appka. */
	writeFile(path: string, name: string, content: unknown): void {
		// `unknown` schválně: testy poškozených souborů sem posílají i to, co doménovým obsahem není.
		this.folder(path).files.set(name, JSON.stringify(content));
	}

	readFile(path: string, name: string): Record<string, unknown> {
		const json = this.folder(path).files.get(name);
		if (json === undefined) return {};
		return JSON.parse(json);
	}

	reset(): void {
		this.folders.clear();
		this.files.clear();
		this.foreign.clear();
		this.store.clear();
		this.dialog.length = 0;
		this.dialogStarts.length = 0;
		this.open.length = 0;
		this.exposed.length = 0;
		this.notification.length = 0;
		this.listeners.clear();
		this.dropped.clear();
		this.answers.clear();
		this.steady.clear();
		this.broken.clear();
		this.calls.length = 0;
		this.window = new Window();
		this.postponed.clear();
		this.scheduler = null;
		this.fault = null;
		this.ares = new Ares();
		this.home = '/Users/test';
		this.fio = new Fio();
		this.mcp = new Mcp();
	}

	postpone(command: string): { finish: () => void } {
		const { promise, resolve } = Promise.withResolvers<void>();
		const queue = this.postponed.get(command) ?? [];
		queue.push((): Promise<void> => promise);
		this.postponed.set(command, queue);
		return { finish: resolve };
	}

	writeText(path: string, name: string, content: string): void {
		this.folder(path).files.set(name, content);
	}
}

export const backend = new Backend();

function checkNumber(number: string): void {
	if (!number.trim()) throw new Error('Číslo dokladu nesmí být prázdné.');
	if (/[/\\]|\.\./.test(number)) throw new Error(`Číslo dokladu ${number} nesmí obsahovat cestu.`);
}

function overToken(token: string): void {
	if (!/^[A-Za-z0-9]{64}$/.test(token)) {
		throw new Error('Fio token má být 64 znaků A–Z, a–z, 0–9 (zkopíruj ho z internetového bankovnictví celý).');
	}
}

function overDatum(label: string, d: string): void {
	if (!isDateString(d)) {
		throw new Error(`Neplatné datum ${label} (čekám RRRR-MM-DD).`);
	}
}

function documentPath(vault: string, number: string): string {
	return `${vault}/faktury/${number}.pdf`;
}

function summary(vault: string, inv: Invoice): InvoiceSummary {
	const sign = inv.documentType === 2 ? -1 : 1;
	return {
		number: inv.number,
		customer: inv.customer.name,
		issueDate: inv.issueDate,
		dueDate: inv.dueDate,
		// Součet počítá backend; kdyby ho fake bral z `invoiceTotalCents`, rozjezd backendu a formuláře by sada neviděla.
		totalCents: sign * inv.lines.reduce((sum, l) => sum + Math.round(l.quantity * l.unitPriceCents), 0),
		variableSymbol: inv.variableSymbol ?? '',
		documentType: inv.documentType ?? 1,
		originalInvoice: inv.originalInvoice ?? '',
		sentAt: backend.folder(vault).sent.get(inv.number) ?? null,
		usageLines: inv.lines
			.filter((l) => l.itemId?.trim())
			.map((l) => ({
				itemId: l.itemId ?? '',
				quantity: l.quantity,
				...(l.usageYear !== undefined && { usageYear: l.usageYear }),
			})),
		path: documentPath(vault, inv.number),
	};
}

/** Argumenty příkazů — vypsané, ne indexová signatura. */
type Args = {
	body: string;
	defaultPath: string;
	from: string;
	ico: string;
	invoice: Invoice;
	isNew: boolean;
	json: string;
	name: string;
	number: string;
	ourIco: string | null;
	path: string;
	paths: string[];
	reason: string;
	source: string;
	startNumber: string;
	target: string;
	template: string;
	theme: string;
	title: string;
	to: string;
	token: string;
	url: string;
	vaultPath: string;
	weeks: number;
	year: number;
};

const emptyParty = {
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
};

function emptyArgs(): Args {
	return {
		body: '',
		defaultPath: '',
		from: '',
		ico: '',
		invoice: {
			number: '',
			issueDate: '',
			dueDate: '',
			supplier: {
				...emptyParty,
			},
			customer: {
				...emptyParty,
			},
			lines: [],
		},
		isNew: false,
		json: '',
		name: '',
		number: '',
		ourIco: null,
		path: '',
		paths: [],
		reason: '',
		source: '',
		startNumber: '',
		target: '',
		template: '',
		theme: '',
		title: '',
		to: '',
		token: '',
		url: '',
		vaultPath: '',
		weeks: 0,
		year: 0,
	};
}

const commands: Record<string, (a: Args) => unknown> = {
	ensure_vault: ({ vaultPath }) => {
		if (!backend.folders.has(vaultPath)) backend.folders.set(vaultPath, emptyFolder());
		return null;
	},
	vault_has_logo: ({ vaultPath }) => backend.files.has(`${vaultPath}/logo.png`),
	set_vault_logo: ({ vaultPath }) => {
		backend.folder(vaultPath);
		backend.files.add(`${vaultPath}/logo.png`);
		return null;
	},
	remove_vault_logo: ({ vaultPath }) => {
		backend.folder(vaultPath);
		backend.files.delete(`${vaultPath}/logo.png`);
		return null;
	},
	snapshots_path: ({ vaultPath }) => backend.folder(vaultPath).snapshotsPath,
	list_broken_received: ({ vaultPath }) => backend.folder(vaultPath).brokenReceived,

	/** Kdyby to fake pustil dál, testoval by cestu, kterou appka nikdy neujde. */
	read_data_file: ({ vaultPath, name }) => {
		const folder = backend.folder(vaultPath);
		const json = folder.files.get(name);
		folder.seen.set(name, json ?? null);
		// Chybějící soubor je normální stav (nový vault), ne chyba.
		if (json === undefined) return '{}';

		let v: unknown;
		try {
			v = JSON.parse(json);
		} catch (e) {
			throw new Error(`Soubor ${name} není platný JSON: ${String(e)}`, { cause: e });
		}

		if (typeof v !== 'object' || v === null || Array.isArray(v)) {
			throw new Error(`Soubor ${name} musí být JSON objekt, ne pole nebo hodnota.`);
		}

		return json;
	},
	write_data_file: ({ vaultPath, name, json }) => {
		const folder = backend.folder(vaultPath);
		const current = folder.files.get(name) ?? null;
		const known = folder.seen.has(name) ? folder.seen.get(name) : null;
		if (known !== current) return 'conflict';
		folder.files.set(name, json);
		folder.seen.set(name, json);
		return 'written';
	},

	list_used_numbers: ({ vaultPath }) => {
		const s = backend.folder(vaultPath);
		return [...new Set([...s.invoices.keys(), ...s.sent.keys()])].toSorted();
	},

	save_invoice: ({ vaultPath, invoice, isNew }) => {
		checkNumber(invoice.number);
		if (!invoice.lines.length) throw new Error('Doklad nemá žádnou položku — ISDOC vyžaduje aspoň jednu.');
		const s = backend.folder(vaultPath);
		if (isNew && s.sent.has(invoice.number)) {
			throw new Error(`Číslo ${invoice.number} už patří odeslanému dokladu a nelze ho použít znovu.`);
		}
		if (isNew && s.invoices.has(invoice.number)) {
			throw new Error(`Faktura ${invoice.number} už existuje.`);
		}
		if (!isNew && !s.invoices.has(invoice.number)) {
			throw new Error(
				`Doklad ${invoice.number} ve složce faktury/ není — smazal ho někdo mimo appku, nebo je odpojený disk? Ulož ho jako nový doklad.`,
			);
		}
		if (!isNew && s.issuedElsewhere.has(invoice.number)) {
			throw new Error(
				`Fakturu ${invoice.number} vystavil jiný software, ne Fakturian — přepsat archivovaný doklad nejde. Ulož ji jako nový doklad s vlastním číslem.`,
			);
		}
		// `usageYear: null` znamená rok bez čerpání a do dokladu se nezapíše.
		const lines = invoice.lines.map(({ usageYear, ...line }) => ({
			...line,
			...(usageYear != null && { usageYear }),
		}));
		s.invoices.set(invoice.number, {
			...invoice,
			lines,
		});
		return documentPath(vaultPath, invoice.number);
	},
	mark_invoice_sent: ({ vaultPath, number }) => {
		const folder = backend.folder(vaultPath);
		if (!folder.invoices.has(number)) throw new Error(`Fakturu ${number} se nepodařilo najít.`);
		const existing = folder.sent.get(number);
		if (existing) return existing;
		const sentAt = '2026-08-30T14:15:00Z';
		folder.sent.set(number, sentAt);
		return sentAt;
	},
	delete_invoice: ({ vaultPath, number }) => {
		checkNumber(number);
		const folder = backend.folder(vaultPath);
		if (!folder.invoices.has(number)) throw new Error(`Doklad ${number} se nepodařilo najít.`);
		const credits = [...folder.invoices.values()]
			.filter((i) => i.documentType === 2 && i.originalInvoice === number)
			.map((i) => i.number);
		if (credits.length) {
			throw new Error(
				`Faktura ${number} má dobropis ${credits.join(', ')}, smazat ji nejde. Nejdřív smaž dobropis.`,
			);
		}
		folder.invoices.delete(number);
		folder.sent.delete(number);
		return null;
	},
	preview_invoice: ({ invoice }) => [`<svg data-number="${invoice.number}"/>`],
	load_invoice: ({ vaultPath, number }) => {
		const inv = backend.folder(vaultPath).invoices.get(number);
		if (!inv) throw new Error(`Doklad ${number} ve složce faktury/ není.`);
		return documentFromVault(inv);
	},
	export_invoice_pdf: ({ vaultPath, number, target }) => {
		if (!backend.folder(vaultPath).invoices.has(number))
			throw new Error(`Doklad ${number} ve složce faktury/ není.`);
		backend.files.add(target);
		return null;
	},
	import_documents: ({ vaultPath, paths }) => takeOver(vaultPath, paths, false),
	adopt_documents: ({ vaultPath, paths }) => takeOver(vaultPath, paths, true),
	scan_vault: ({ vaultPath }) => ({
		candidates: [...backend.foreign]
			.filter(([path]) => path.startsWith(`${vaultPath}/`))
			.map(([path, inv]) => ({
				path,
				file: path.slice(path.lastIndexOf('/') + 1),
				number: inv.number,
				customer: inv.customer.name,
				issueDate: inv.issueDate,
				totalCents: summary(vaultPath, inv).totalCents,
			})),
		skipped: [],
		supplier: null,
		truncated: false,
	}),
	list_invoices: ({ vaultPath }) => ({
		items: [...backend.folder(vaultPath).invoices.values()].map((i) => summary(vaultPath, i)),
		broken: [],
	}),

	fio_set_token: ({ token }) => {
		const clean = token.trim();
		overToken(clean);
		if (backend.fio.keychainFails) throw new Error('Klíčenka je nedostupná.');
		backend.fio.token = clean;
		return null;
	},
	fio_has_token: () => {
		if (backend.fio.keychainFails) throw new Error('Klíčenka je nedostupná.');
		return backend.fio.token !== null;
	},
	fio_clear_token: () => {
		if (backend.fio.keychainFails) throw new Error('Klíčenka je nedostupná.');
		backend.fio.token = null;
		return null;
	},
	fio_fetch: ({ from, to }) => {
		if (backend.fio.keychainFails) throw new Error('Klíčenka je nedostupná.');
		if (backend.fio.token === null) throw new Error('Není uložený Fio token.');
		overToken(backend.fio.token);
		overDatum('„od"', from);
		overDatum('„do"', to);
		if (backend.fio.unavailable) throw new Error('Nepodařilo se spojit s Fio (jste offline?).');
		return backend.fio.movements.filter((p) => p.amountCents > 0 && p.date >= from && p.date <= to);
	},

	mcp_socket_path: () => backend.mcp.socket,
	mcp_connector: () => backend.mcp.connector,
	mcp_attach: () => null,
	mcp_send: () => null,

	// Hlášky jako `desktop/ares.ts`: síť a stav odpovědi obsluhuje hlavní proces.
	ares_subject: ({ ico }) => {
		if (/\s/.test(ico) || !isValidIco(ico)) throw new Error('Neplatné IČO (8 číslic).');
		if (backend.ares.unavailable) throw new Error('Nepodařilo se spojit s ARES (jste offline?).');
		const company = backend.ares.companies.get(ico);
		if (company === undefined) throw new Error('Firma s tímto IČO nebyla v ARES nalezena.');
		return company;
	},

	pick_folder: ({ defaultPath }) => {
		backend.dialogStarts.push(defaultPath);
		return backend.dialog.shift() ?? null;
	},
	pick_files: () => {
		const picked = backend.dialog.shift() ?? [];
		return typeof picked === 'string' ? [picked] : picked;
	},
	pick_save_path: () => backend.dialog.shift() ?? null,
	open_url: ({ url }) => {
		backend.open.push(url);
		return null;
	},
	reveal_path: ({ path }) => {
		backend.exposed.push(path);
		return null;
	},
	notify: ({ title, body }) => {
		backend.notification.push({
			title,
			body,
		});
		return null;
	},
	home_dir: () => backend.home,
	default_vault_path: () => '/Users/test/Documents/Fakturian',
	load_vault_path: () => backend.store.get('vaultPath') ?? null,
	save_vault_path: ({ vaultPath }) => {
		backend.store.set('vaultPath', vaultPath);
		return null;
	},
	set_window_theme: ({ theme }) => {
		backend.window.theme = theme;
		return null;
	},
	close_window: () => {
		backend.window.closed = true;
		return null;
	},
};

/** Import doklad zkopíruje, převzetí ho ze složky přesune; obsazené číslo se přeskočí jako v backendu. */
function takeOver(vaultPath: string, paths: string[], move: boolean) {
	const folder = backend.folder(vaultPath);
	const report = {
		imported: [] as { number: string; customer: string; issueDate: string; totalCents: number }[],
		skipped: [] as { file: string; reason: string }[],
		customers: [],
	};
	for (const path of paths) {
		const inv = backend.foreign.get(path);
		if (!inv) {
			report.skipped.push({
				file: path,
				reason: 'Soubor zmizel.',
			});
			continue;
		}
		if (folder.invoices.has(inv.number) || folder.sent.has(inv.number)) {
			report.skipped.push({
				file: path,
				reason: `Doklad ${inv.number} už v evidenci je.`,
			});
			continue;
		}
		folder.invoices.set(inv.number, inv);
		folder.issuedElsewhere.add(inv.number);
		if (move) backend.foreign.delete(path);
		const { number, customer, issueDate, totalCents } = summary(vaultPath, inv);
		report.imported.push({
			number,
			customer,
			issueDate,
			totalCents,
		});
	}
	return report;
}

function documentFromVault(inv: Invoice): Invoice {
	// Strana dokladu má v typu všechna pole povinná, takže se jen přebírá; kdyby se doplňovala
	// „výchozími" hodnotami před spreadem, byl by to mrtvý kód.
	const side = (p: Invoice['supplier']) => ({ ...p });
	const rest = inv;
	return {
		...rest,
		uuid: rest.uuid ?? '',
		documentType: rest.documentType ?? 1,
		originalInvoice: rest.originalInvoice ?? '',
		originalIssueDate: rest.originalIssueDate ?? '',
		originalUuid: rest.originalUuid ?? '',
		vatNote: rest.vatNote ?? '',
		bankAccount: rest.bankAccount ?? '',
		bankCode: rest.bankCode ?? '',
		iban: rest.iban ?? '',
		variableSymbol: rest.variableSymbol ?? '',
		note: rest.note ?? '',
		supplier: side(inv.supplier),
		customer: side(inv.customer),
		lines: inv.lines.map((l) => ({
			itemId: '',
			...l,
		})),
	};
}

// Příkazy, které v hlavním procesu čekají na disk, síť nebo jiný proces, a doběhnou proto v libovolném
// pořadí; ostatní se vyřídí jeden po druhém v pořadí volání.
const ASYNC_COMMANDS = new Set([
	'adopt_documents',
	'delete_invoice',
	'export_invoice_pdf',
	'fio_fetch',
	'import_documents',
	'import_received',
	'list_broken_received',
	'list_invoices',
	'mail_compose_with_attachment',
	'mark_invoice_sent',
	'mcp_send',
	'preview_invoice',
	'save_invoice',
	'scan_vault',
]);

export async function invoke(command: string, raw: Partial<Args> = {}): Promise<unknown> {
	// Kopie jako v `contextBridge`: reaktivní proxy Vue by neprošla a hlavní proces dostane jen snímek.
	const args: Partial<Args> = structuredClone(raw);
	backend.calls.push({
		command,
		args,
	});

	// Odložené volání drží odpověď, dokud ji test nepustí — a stav se čte až potom, tedy takový, jaký
	// je ve chvíli odpovědi, ne ve chvíli zavolání.
	const gateway = backend.postponed.get(command)?.shift();
	await (gateway ? gateway() : Promise.resolve());

	// Backend příkaz provede v jednu chvíli a odpoví později; mezitím doběhne jiný, a odpověď tak nese
	// stav z chvíle provedení.
	const scheduler = ASYNC_COMMANDS.has(command) ? backend.scheduler : null;
	await scheduler?.schedule(Promise.resolve(), `${command} se provádí`);
	const outcome = execute(command, args);
	await scheduler?.schedule(Promise.resolve(), `${command} odpovídá`);
	// Most posílá chybu jako řetězec, ne jako `Error` — appka na to spoléhá, takže odmítnutý příslib
	// nese přímo tentýž řetězec.
	if ('error' in outcome) return Promise.reject(outcome.error);
	return outcome.value;
}

function execute(command: string, args: Partial<Args>): { value: unknown } | { error: unknown } {
	const error = backend.fault?.(command) ?? backend.broken.get(command);
	if (error) return { error };
	const dictated = backend.answers.get(command)?.shift();
	if (dictated) return dictated;
	if (backend.steady.has(command)) return { value: backend.steady.get(command) };
	const fn = commands[command];
	if (!fn) {
		throw new Error(`Test nenastavil odpověď na příkaz ${command} — viz backend.returns('${command}', …).`);
	}
	try {
		const value = fn({
			...emptyArgs(),
			...args,
		});
		return { value };
	} catch (e) {
		return { error: e instanceof Error ? e.message : e };
	}
}

/** Soubor přetažený z Finderu; cestu k němu vydá jen `pathForFile` mostu. */
export function finderFile(path: string): File {
	const file = new File([''], path.slice(path.lastIndexOf('/') + 1));
	backend.dropped.set(file, path);
	return file;
}

/** Hlavní proces chce zavřít okno (křížek, ⌘W, ⌘Q); zavře ho až `close_window`. */
export function requestClose(): void {
	backend.emit(CLOSE_REQUESTED_EVENT);
}

// `invoke` falešného mostu přijme i neznámý příkaz: testy zkouší, jak na něj odpoví hlavní proces.
const bridge: Omit<DesktopBridge, 'invoke'> & { invoke(name: string, args: Partial<Args>): Promise<unknown> } = {
	invoke: (name, args) => invoke(name, args),
	on: (channel, listener) => {
		const listeners = backend.listeners.get(channel) ?? new Set();
		backend.listeners.set(channel, listeners);
		// Vlastní záznam: `delete` by jinak odhlásil i druhou registraci téhož posluchače.
		const entry = { listener };
		listeners.add(entry);
		backend.calls.push({
			command: 'listen',
			args: {
				channel,
			},
		});
		return () => listeners.delete(entry);
	},
	pathForFile: (file) => backend.dropped.get(file) ?? '',
};

export function resetBackend(): void {
	backend.reset();
	Reflect.set(globalThis, 'fakturian', bridge);
}

/** Appka běží v obyčejném prohlížeči, ne v okně Electronu. */
export function outsideDesktop(): void {
	Reflect.deleteProperty(globalThis, 'fakturian');
}
