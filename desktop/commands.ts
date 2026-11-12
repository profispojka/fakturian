import { app, type BaseWindow } from 'electron';

import { errorText, issuesText } from '~/utils/errors';
import { type Zod, z } from '~/utils/zod';

import { adoptDocuments, scanVault } from './adopt.ts';
import { aresSubject } from './ares.ts';
import { fioClearToken, fioFetch, fioHasToken, fioSetToken } from './fio.ts';
import { deleteInvoice } from './invoice/delete.ts';
import { importDocuments } from './invoice/import.ts';
import { listInvoices, listUsedNumbers } from './invoice/index.ts';
import { exportInvoicePdf, loadInvoice, saveInvoice } from './invoice/mod.ts';
import { previewInvoice } from './invoice/preview.ts';
import { markInvoiceSent } from './invoice/status.ts';
import { log } from './log.ts';
import { mailComposeWithAttachment } from './mail.ts';
import { type Bridge, mcpConnector, mcpSocketPath } from './mcp/mod.ts';
import { defaultVaultPath, homeDir, loadVaultPath, saveVaultPath } from './preferences.ts';
import { importReceived, listBrokenReceived, receivedPath, removeReceived } from './received.ts';
import { readDataFile, snapshotsPath, writeDataFile } from './store.ts';
import { notify, openUrl, pickFiles, pickFolder, pickSavePath, revealPath, setWindowTheme } from './system.ts';
import { ensureVault, removeVaultLogo, setVaultLogo, vaultHasLogo } from './vault.ts';

import type { IpcResult } from './ipc.ts';
import type { CommandArgs, CommandName, CommandResults } from '~/bindings';

// Vstup schématu zná jen klíče argumentů: webview nesmí poslat klíč, který `strictObject` odmítne.
type Keys<Args> = { [Key in keyof Args]: unknown };

export interface Command<Args, Result> {
	args: Zod.ZodType<unknown, Keys<Args>>;
	run: (args: Args) => Result | Promise<Result>;
	invoke(name: string, input: unknown): Promise<IpcResult>;
}

// Každý příkaz musí přijmout argumenty, které mu `commands` ve webview posílá, a vrátit, co čeká.
type Contract = { [Name in CommandName]: Command<CommandArgs[Name], CommandResults[Name]> };

// Okno, ke kterému patří dialogy, a úklid, po kterém se zavře.
export interface Shell {
	window: BaseWindow;
	close(): Promise<null>;
}

// Hranice mezi webview a backendem: příkaz dostane jen objekt, který prošel schématem, nikdy nic
// navíc. Chyba dojde jako věta, kterou `errorText()` ve frontendu ukáže beze změny.
export function command<Args, Result>(
	args: Zod.ZodType<Args, Keys<Args>>,
	run: (args: Args) => Result | Promise<Result>,
): Command<Args, Result> {
	return {
		args,
		run,
		async invoke(name, input) {
			const parsed = args.safeParse(input);
			if (!parsed.success) {
				return {
					ok: false,
					error: `Příkaz ${name} dostal neplatné argumenty (${issuesText(parsed.error)}).`,
				};
			}
			try {
				const value = await run(parsed.data);
				return {
					ok: true,
					value,
				};
			} catch (error) {
				// Technická příčina do věty pro uživatele nepatří; v logu ji najde ten, kdo chybu hledá.
				if (error instanceof Error && error.cause !== undefined) {
					await log(`Příkaz ${name} selhal: ${errorText(error)} Příčina: ${errorText(error.cause)}`);
				}
				return {
					ok: false,
					error: errorText(error),
				};
			}
		},
	};
}

const none = z.strictObject({});

const vault = z.strictObject({ vaultPath: z.string() });

const numbered = z.strictObject({
	vaultPath: z.string(),
	number: z.string(),
});

const receivedFile = z.strictObject({
	vaultPath: z.string(),
	file: z.string(),
});

const documents = z.strictObject({
	vaultPath: z.string(),
	paths: z.array(z.string()),
	ourIco: z.string().nullable(),
});

// Tvar dokladu ověřuje celý `invoiceArgument` uvnitř příkazu, hranice hlídá jen, že jde o objekt.
const draft = {
	vaultPath: z.string(),
	invoice: z.record(z.string(), z.unknown()),
};

// Prázdný seznam přípon by panel pustil na libovolný soubor.
const filter = {
	filterName: z.string().trim().min(1, 'Filtr dialogu potřebuje název.'),
	extensions: z
		.array(z.string().regex(/^[a-z0-9]+$/i, 'Přípona smí mít jen písmena a číslice, bez tečky.'))
		.min(1, 'Dialog potřebuje aspoň jednu příponu.'),
};

// Všechno, co webview smí zavolat přes `commands.*` ze `src/bindings.ts`.
export function commands(shell: Shell, bridge: Bridge) {
	return {
		ensure_vault: command(vault, ensureVault),
		vault_has_logo: command(vault, vaultHasLogo),
		set_vault_logo: command(
			z.strictObject({
				vaultPath: z.string(),
				source: z.string(),
			}),
			setVaultLogo,
		),
		remove_vault_logo: command(vault, removeVaultLogo),
		read_data_file: command(
			z.strictObject({
				vaultPath: z.string(),
				name: z.string(),
			}),
			readDataFile,
		),
		write_data_file: command(
			z.strictObject({
				vaultPath: z.string(),
				name: z.string(),
				json: z.string(),
			}),
			writeDataFile,
		),
		snapshots_path: command(vault, snapshotsPath),
		import_documents: command(documents, importDocuments),
		scan_vault: command(
			z.strictObject({
				vaultPath: z.string(),
				ourIco: z.string().nullable(),
			}),
			scanVault,
		),
		adopt_documents: command(documents, adoptDocuments),
		mail_compose_with_attachment: command(
			z.strictObject({
				vaultPath: z.string(),
				to: z.string(),
				subject: z.string(),
				body: z.string(),
				attachment: z.string(),
			}),
			mailComposeWithAttachment,
		),
		import_received: command(
			z.strictObject({
				vaultPath: z.string(),
				sourcePath: z.string(),
			}),
			importReceived,
		),
		list_broken_received: command(vault, listBrokenReceived),
		remove_received: command(receivedFile, removeReceived),
		received_path: command(receivedFile, receivedPath),
		list_used_numbers: command(vault, listUsedNumbers),
		mark_invoice_sent: command(numbered, markInvoiceSent),
		delete_invoice: command(numbered, deleteInvoice),
		save_invoice: command(
			z.strictObject({
				...draft,
				isNew: z.boolean(),
			}),
			saveInvoice,
		),
		preview_invoice: command(z.strictObject(draft), previewInvoice),
		load_invoice: command(numbered, loadInvoice),
		export_invoice_pdf: command(
			z.strictObject({
				vaultPath: z.string(),
				number: z.string(),
				target: z.string(),
			}),
			exportInvoicePdf,
		),
		list_invoices: command(vault, listInvoices),
		fio_set_token: command(z.strictObject({ token: z.string() }), fioSetToken),
		fio_has_token: command(none, fioHasToken),
		fio_clear_token: command(none, fioClearToken),
		fio_fetch: command(
			z.strictObject({
				from: z.string(),
				to: z.string(),
			}),
			fioFetch,
		),
		ares_subject: command(z.strictObject({ ico: z.string() }), aresSubject),
		mcp_attach: command(none, () => {
			bridge.attach();
			return null;
		}),
		mcp_send: command(
			z.strictObject({
				session: z.int().positive(),
				line: z.string(),
			}),
			async ({ session, line }) => {
				await bridge.send(session, line);
				return null;
			},
		),
		mcp_socket_path: command(none, mcpSocketPath),
		mcp_connector: command(none, () =>
			mcpConnector({
				execPath: process.execPath,
				appPath: app.getAppPath(),
				packaged: app.isPackaged,
			}),
		),
		pick_folder: command(z.strictObject({ defaultPath: z.string() }), (args) => pickFolder(shell.window, args)),
		pick_files: command(
			z.strictObject({
				...filter,
				multiple: z.boolean(),
			}),
			(args) => pickFiles(shell.window, args),
		),
		pick_save_path: command(
			z.strictObject({
				...filter,
				defaultName: z.string(),
			}),
			(args) => pickSavePath(shell.window, args),
		),
		open_url: command(z.strictObject({ url: z.string() }), openUrl),
		reveal_path: command(z.strictObject({ path: z.string() }), revealPath),
		notify: command(
			z.strictObject({
				title: z.string(),
				body: z.string(),
			}),
			notify,
		),
		home_dir: command(none, homeDir),
		default_vault_path: command(none, defaultVaultPath),
		load_vault_path: command(none, loadVaultPath),
		save_vault_path: command(vault, saveVaultPath),
		set_window_theme: command(z.strictObject({ theme: z.enum(['light', 'dark']) }), setWindowTheme),
		close_window: command(none, () => shell.close()),
	} satisfies Contract;
}

// Jméno příkazu přichází z webview; `Map` místo indexu objektu, aby `toString` ani jiný klíč
// z prototypu nic nespustil.
export function dispatcher(
	table: Record<string, Pick<Command<unknown, unknown>, 'invoke'>>,
): (name: unknown, input: unknown) => Promise<IpcResult> {
	const entries = new Map(Object.entries(table));
	return (name, input) => {
		// Stryker disable next-line ConditionalExpression: ekvivalentní mutant, klíče tabulky jsou jen řetězce, takže jiné jméno nenajde nic tak jako tak.
		const entry = typeof name === 'string' ? entries.get(name) : undefined;
		if (entry === undefined)
			return Promise.resolve({
				ok: false,
				error: `Příkaz ${String(name)} appka nezná.`,
			});
		return entry.invoke(String(name), input);
	};
}
