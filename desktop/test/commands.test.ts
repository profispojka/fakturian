import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dialog, nativeTheme } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { z } from '~/utils/zod';

import { names } from './support.ts';

import { adoptDocuments, scanVault } from '../adopt.ts';
import { aresSubject } from '../ares.ts';
import { command, commands, dispatcher } from '../commands.ts';
import { fioClearToken, fioFetch, fioHasToken, fioSetToken } from '../fio.ts';
import { deleteInvoice } from '../invoice/delete.ts';
import { importDocuments } from '../invoice/import.ts';
import { listInvoices, listUsedNumbers } from '../invoice/index.ts';
import { exportInvoicePdf, loadInvoice, saveInvoice } from '../invoice/mod.ts';
import { previewInvoice } from '../invoice/preview.ts';
import { markInvoiceSent } from '../invoice/status.ts';
import { mailComposeWithAttachment } from '../mail.ts';
import { Bridge } from '../mcp/mod.ts';
import { defaultVaultPath, homeDir, loadVaultPath, saveVaultPath } from '../preferences.ts';
import { importReceived, listBrokenReceived, receivedPath, removeReceived } from '../received.ts';
import { readDataFile, snapshotsPath, writeDataFile } from '../store.ts';
import { notify, openUrl, revealPath, setWindowTheme } from '../system.ts';
import { checkVault, ensureVault, removeVaultLogo, setVaultLogo, vaultHasLogo } from '../vault.ts';

// Dialogy jen zaznamenané: test nesmí nic otevřít.
vi.mock('electron', () => ({
	app: {
		getAppPath: () => '/Users/jana/fakturian',
		isPackaged: false,
	},
	dialog: {
		showOpenDialog: vi.fn(() =>
			Promise.resolve({
				canceled: true,
				filePaths: [],
			}),
		),
		showSaveDialog: vi.fn(() =>
			Promise.resolve({
				canceled: true,
				filePath: '',
			}),
		),
	},
	nativeTheme: {
		themeSource: 'system',
	},
	shell: {},
	Notification: {},
}));

const VAULT = '/Users/jana/Fakturian';

const STRING_GOT = 'Neplatný vstup: očekáváno řetězec, obdrženo';

let home = '';

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), 'fakturian-commands-'));
	vi.stubEnv('HOME', home);
});

afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(home, { recursive: true });
});

describe('brána příkazů', () => {
	const vault = z.strictObject({ vaultPath: z.string() });

	it('příkaz dostane jen objekt, který prošel schématem', async () => {
		const run = vi.fn((args: { vaultPath: string }) => Promise.resolve(args.vaultPath));

		expect(await command(vault, run).invoke('ensure_vault', { vaultPath: VAULT })).toEqual({
			ok: true,
			value: VAULT,
		});
		expect(run).toHaveBeenCalledWith({ vaultPath: VAULT });
	});

	it('neplatné argumenty pojmenují příkaz i vadná pole a příkaz nespustí', async () => {
		const run = vi.fn(() => Promise.resolve(null));
		const entry = command(vault, run);

		expect(await entry.invoke('ensure_vault', { vaultPath: 42 })).toEqual({
			ok: false,
			error: `Příkaz ensure_vault dostal neplatné argumenty (vaultPath: ${STRING_GOT} číslo).`,
		});
		expect(await entry.invoke('ensure_vault', undefined)).toEqual({
			ok: false,
			error: 'Příkaz ensure_vault dostal neplatné argumenty (Neplatný vstup: očekáváno object, obdrženo undefined).',
		});
		expect(run).not.toHaveBeenCalled();
	});

	it('chyba příkazu dojde jako holá věta', async () => {
		const failing = command(vault, () => Promise.reject(new Error('Doklad 20260001 ve složce faktury/ není.')));
		const throwing = command(vault, () => {
			throw new TypeError('Domovská složka není známá.');
		});
		const invalid = command(vault, () => z.strictObject({ number: z.string() }).parse({}));

		expect(
			await Promise.all([
				failing.invoke('load_invoice', { vaultPath: VAULT }),
				throwing.invoke('home_dir', { vaultPath: VAULT }),
				invalid.invoke('save_invoice', { vaultPath: VAULT }),
			]),
		).toEqual([
			{
				ok: false,
				error: 'Doklad 20260001 ve složce faktury/ není.',
			},
			{
				ok: false,
				error: 'Domovská složka není známá.',
			},
			{
				ok: false,
				error: `number: ${STRING_GOT} undefined`,
			},
		]);
	});

	it('technickou příčinu chyby zapíše do logu appky, chybu bez příčiny ne', async () => {
		const logFile = join(home, 'Library', 'Logs', 'com.fakturian.desktop', 'Fakturian.log');
		const plain = command(vault, () => Promise.reject(new Error('Doklad 20260001 ve složce faktury/ není.')));
		const caused = command(vault, () =>
			Promise.reject(new Error('Doklad se nepodařilo vysázet.', { cause: new Error('unclosed delimiter') })),
		);

		await plain.invoke('load_invoice', { vaultPath: VAULT });
		expect(await names(home)).toEqual([]);

		expect(await caused.invoke('save_invoice', { vaultPath: VAULT })).toEqual({
			ok: false,
			error: 'Doklad se nepodařilo vysázet.',
		});
		const written = await readFile(logFile, 'utf8');
		expect(written.replace(/^\S+ /, '')).toBe(
			'Příkaz save_invoice selhal: Doklad se nepodařilo vysázet. Příčina: unclosed delimiter\n',
		);
	});

	it('synchronní příkaz odpoví slibem', async () => {
		const answer = command(z.strictObject({}), () => 42).invoke('home_dir', {});

		expect(answer).toBeInstanceOf(Promise);
		expect(await answer).toEqual({
			ok: true,
			value: 42,
		});
	});

	it('neznámé jméno ani klíč z prototypu nic nespustí', async () => {
		const dispatch = dispatcher({ home_dir: command(z.strictObject({}), () => '/Users/jana') });

		expect(await dispatch('home_dir', {})).toEqual({
			ok: true,
			value: '/Users/jana',
		});
		expect(
			await Promise.all(
				['nope', 'toString', '__proto__', 'constructor', 42, undefined].map((name) => dispatch(name, {})),
			),
		).toEqual([
			{
				ok: false,
				error: 'Příkaz nope appka nezná.',
			},
			{
				ok: false,
				error: 'Příkaz toString appka nezná.',
			},
			{
				ok: false,
				error: 'Příkaz __proto__ appka nezná.',
			},
			{
				ok: false,
				error: 'Příkaz constructor appka nezná.',
			},
			{
				ok: false,
				error: 'Příkaz 42 appka nezná.',
			},
			{
				ok: false,
				error: 'Příkaz undefined appka nezná.',
			},
		]);
	});
});

// Jeden platný a jeden neplatný vstup každého příkazu a hláška, kterou neplatný dostane.
const CASES: [string, unknown, unknown, string][] = [
	['ensure_vault', { vaultPath: VAULT }, { vaultPath: 42 }, `vaultPath: ${STRING_GOT} číslo`],
	['check_vault', { vaultPath: VAULT }, { vaultPath: null }, `vaultPath: ${STRING_GOT} null`],
	['vault_has_logo', { vaultPath: VAULT }, {}, `vaultPath: ${STRING_GOT} undefined`],
	[
		'set_vault_logo',
		{
			vaultPath: VAULT,
			source: '/Users/jana/logo.png',
		},
		{ vaultPath: VAULT },
		`source: ${STRING_GOT} undefined`,
	],
	[
		'remove_vault_logo',
		{ vaultPath: VAULT },
		{
			vaultPath: VAULT,
			logo: true,
		},
		'Neznámé klíče: "logo"',
	],
	[
		'read_data_file',
		{
			vaultPath: VAULT,
			name: 'platby.json',
		},
		{
			vaultPath: VAULT,
			name: null,
		},
		`name: ${STRING_GOT} null`,
	],
	[
		'write_data_file',
		{
			vaultPath: VAULT,
			name: 'platby.json',
			json: '{}',
		},
		{
			vaultPath: VAULT,
			name: 'platby.json',
			json: 7,
		},
		`json: ${STRING_GOT} číslo`,
	],
	['snapshots_path', { vaultPath: VAULT }, null, 'Neplatný vstup: očekáváno object, obdrženo null'],
	[
		'import_documents',
		{
			vaultPath: VAULT,
			paths: ['/Users/jana/faktura.pdf'],
			ourIco: null,
		},
		{
			vaultPath: VAULT,
			paths: '/Users/jana/faktura.pdf',
			ourIco: null,
		},
		'paths: Neplatný vstup: očekáváno pole, obdrženo řetězec',
	],
	[
		'scan_vault',
		{
			vaultPath: VAULT,
			ourIco: '12345679',
		},
		{ vaultPath: VAULT },
		`ourIco: ${STRING_GOT} undefined`,
	],
	[
		'adopt_documents',
		{
			vaultPath: VAULT,
			paths: [],
			ourIco: '12345679',
		},
		{
			vaultPath: VAULT,
			paths: [1],
			ourIco: null,
		},
		`paths.0: ${STRING_GOT} číslo`,
	],
	[
		'mail_compose_with_attachment',
		{
			vaultPath: VAULT,
			to: 'jana@example.com',
			subject: 'Faktura',
			body: 'Dobrý den',
			attachment: `${VAULT}/faktury/20260001.pdf`,
		},
		{
			vaultPath: VAULT,
			to: 'jana@example.com',
			subject: 'Faktura',
			body: 'Dobrý den',
		},
		`attachment: ${STRING_GOT} undefined`,
	],
	[
		'import_received',
		{
			vaultPath: VAULT,
			sourcePath: '/Users/jana/doklad.pdf',
		},
		{
			vaultPath: VAULT,
			sourcePath: 1,
		},
		`sourcePath: ${STRING_GOT} číslo`,
	],
	['list_broken_received', { vaultPath: VAULT }, { vaultPath: [VAULT] }, `vaultPath: ${STRING_GOT} pole`],
	[
		'remove_received',
		{
			vaultPath: VAULT,
			file: 'doklad.pdf',
		},
		{ vaultPath: VAULT },
		`file: ${STRING_GOT} undefined`,
	],
	[
		'received_path',
		{
			vaultPath: VAULT,
			file: 'doklad.pdf',
		},
		{
			vaultPath: VAULT,
			file: 7,
		},
		`file: ${STRING_GOT} číslo`,
	],
	['list_used_numbers', { vaultPath: VAULT }, [VAULT], 'Neplatný vstup: očekáváno object, obdrženo pole'],
	[
		'mark_invoice_sent',
		{
			vaultPath: VAULT,
			number: '20260001',
		},
		{
			vaultPath: VAULT,
			number: 20260001,
		},
		`number: ${STRING_GOT} číslo`,
	],
	[
		'delete_invoice',
		{
			vaultPath: VAULT,
			number: '20260001',
		},
		{
			vaultPath: VAULT,
			number: '20260001',
			discard: true,
		},
		'Neznámé klíče: "discard"',
	],
	[
		'save_invoice',
		{
			vaultPath: VAULT,
			invoice: {
				number: '20260001',
			},
			isNew: true,
		},
		{
			vaultPath: VAULT,
			invoice: {},
			isNew: 'ano',
		},
		'isNew: Neplatný vstup: očekáváno boolean, obdrženo řetězec',
	],
	[
		'preview_invoice',
		{
			vaultPath: VAULT,
			invoice: {},
		},
		{
			vaultPath: VAULT,
			invoice: [],
		},
		'invoice: Neplatný vstup: očekáváno record, obdrženo pole',
	],
	[
		'load_invoice',
		{
			vaultPath: VAULT,
			number: '20260001',
		},
		{ number: '20260001' },
		`vaultPath: ${STRING_GOT} undefined`,
	],
	[
		'export_invoice_pdf',
		{
			vaultPath: VAULT,
			number: '20260001',
			target: '/Users/jana/kopie.pdf',
		},
		{
			vaultPath: VAULT,
			number: '20260001',
		},
		`target: ${STRING_GOT} undefined`,
	],
	['list_invoices', { vaultPath: VAULT }, VAULT, 'Neplatný vstup: očekáváno object, obdrženo řetězec'],
	['fio_set_token', { token: 'token' }, { token: null }, `token: ${STRING_GOT} null`],
	['fio_has_token', {}, { token: 'token' }, 'Neznámé klíče: "token"'],
	['fio_clear_token', {}, null, 'Neplatný vstup: očekáváno object, obdrženo null'],
	[
		'fio_fetch',
		{
			from: '2026-05-01',
			to: '2026-05-31',
		},
		{
			from: 20260501,
			to: '2026-05-31',
		},
		`from: ${STRING_GOT} číslo`,
	],
	['ares_subject', { ico: '12345679' }, { ico: 12345679 }, `ico: ${STRING_GOT} číslo`],
	['mcp_attach', {}, { session: 1 }, 'Neznámé klíče: "session"'],
	[
		'mcp_send',
		{
			session: 1,
			line: '{}',
		},
		{
			session: 0,
			line: '{}',
		},
		'session: Hodnota je příliš malá: number musí být >0',
	],
	['mcp_socket_path', {}, { path: '/tmp/mcp.sock' }, 'Neznámé klíče: "path"'],
	['mcp_connector', {}, null, 'Neplatný vstup: očekáváno object, obdrženo null'],
	['pick_folder', { defaultPath: VAULT }, {}, `defaultPath: ${STRING_GOT} undefined`],
	[
		'pick_files',
		{
			filterName: 'Faktury',
			extensions: ['pdf'],
			multiple: true,
		},
		{
			filterName: 'Faktury',
			extensions: ['pdf'],
			multiple: 'true',
		},
		'multiple: Neplatný vstup: očekáváno boolean, obdrženo řetězec',
	],
	[
		'pick_save_path',
		{
			defaultName: '20260001.pdf',
			filterName: 'PDF',
			extensions: ['pdf'],
		},
		{
			defaultName: '20260001.pdf',
			filterName: 'PDF',
			extensions: [],
		},
		'extensions: Dialog potřebuje aspoň jednu příponu.',
	],
	['open_url', { url: 'https://binaro.cz' }, { url: null }, `url: ${STRING_GOT} null`],
	['reveal_path', { path: VAULT }, { path: 1 }, `path: ${STRING_GOT} číslo`],
	[
		'notify',
		{
			title: 'Fakturian',
			body: 'Faktura odeslána',
		},
		{ title: 'Fakturian' },
		`body: ${STRING_GOT} undefined`,
	],
	['home_dir', {}, { home: '/Users/jana' }, 'Neznámé klíče: "home"'],
	['default_vault_path', {}, null, 'Neplatný vstup: očekáváno object, obdrženo null'],
	['load_vault_path', {}, { vaultPath: VAULT }, 'Neznámé klíče: "vaultPath"'],
	['save_vault_path', { vaultPath: VAULT }, { vaultPath: null }, `vaultPath: ${STRING_GOT} null`],
	[
		'set_window_theme',
		{ theme: 'dark' },
		{ theme: 'system' },
		'theme: Neplatná možnost: očekávána jedna z hodnot "light"|"dark"',
	],
	['close_window', {}, { force: true }, 'Neznámé klíče: "force"'],
];

describe('seznam příkazů', () => {
	const win = { id: 'okno' };
	const close = vi.fn(() => Promise.resolve(null));
	const list = commands(
		{
			window: win,
			close,
			mcpSocket: () => Promise.resolve('/Users/jana/Library/Application Support/com.fakturian.desktop/mcp.sock'),
		},
		new Bridge(() => undefined),
	);
	const entries = new Map(Object.entries(list));

	it('webview smí volat právě příkazy z tabulky', () => {
		expect([...entries.keys()].toSorted()).toEqual(CASES.map(([name]) => name).toSorted());
	});

	for (const [name, valid, invalid, issue] of CASES) {
		it(`${name} pustí platné argumenty a neplatné odmítne`, async () => {
			const entry = entries.get(name);

			expect(entry.args.safeParse(valid).data).toEqual(valid);
			expect(await entry.invoke(name, invalid)).toEqual({
				ok: false,
				error: `Příkaz ${name} dostal neplatné argumenty (${issue}).`,
			});
		});
	}

	it('filtr dialogu potřebuje název a přípony bez tečky', () => {
		const files = entries.get('pick_files').args;

		expect(
			files
				.safeParse({
					filterName: ' ',
					extensions: ['.pdf', 'pdf;'],
					multiple: false,
				})
				.error.issues.map((i) => i.message),
		).toEqual([
			'Filtr dialogu potřebuje název.',
			'Přípona smí mít jen písmena a číslice, bez tečky.',
			'Přípona smí mít jen písmena a číslice, bez tečky.',
		]);
	});

	it('každé jméno vede na svou funkci', () => {
		const wrapped = [
			'mcp_attach',
			'mcp_send',
			'mcp_socket_path',
			'mcp_connector',
			'pick_folder',
			'pick_files',
			'pick_save_path',
			'close_window',
		];
		const handlers = Object.fromEntries(
			[...entries].filter(([name]) => !wrapped.includes(name)).map(([name, entry]) => [name, entry.run]),
		);

		expect(handlers).toEqual({
			ensure_vault: ensureVault,
			check_vault: checkVault,
			vault_has_logo: vaultHasLogo,
			set_vault_logo: setVaultLogo,
			remove_vault_logo: removeVaultLogo,
			read_data_file: readDataFile,
			write_data_file: writeDataFile,
			snapshots_path: snapshotsPath,
			import_documents: importDocuments,
			scan_vault: scanVault,
			adopt_documents: adoptDocuments,
			mail_compose_with_attachment: mailComposeWithAttachment,
			import_received: importReceived,
			list_broken_received: listBrokenReceived,
			remove_received: removeReceived,
			received_path: receivedPath,
			list_used_numbers: listUsedNumbers,
			mark_invoice_sent: markInvoiceSent,
			delete_invoice: deleteInvoice,
			save_invoice: saveInvoice,
			preview_invoice: previewInvoice,
			load_invoice: loadInvoice,
			export_invoice_pdf: exportInvoicePdf,
			list_invoices: listInvoices,
			fio_set_token: fioSetToken,
			fio_has_token: fioHasToken,
			fio_clear_token: fioClearToken,
			fio_fetch: fioFetch,
			ares_subject: aresSubject,
			open_url: openUrl,
			reveal_path: revealPath,
			notify,
			home_dir: homeDir,
			default_vault_path: defaultVaultPath,
			load_vault_path: loadVaultPath,
			save_vault_path: saveVaultPath,
			set_window_theme: setWindowTheme,
		});
		expect(new Set(Object.values(handlers)).size).toBe(Object.keys(handlers).length);
	});

	it('každé jméno spustí svůj příkaz', async () => {
		const vaultPath = join(home, 'Fakturian');
		const answers = [];
		for (const [name, args] of [
			['ensure_vault', { vaultPath }],
			['check_vault', { vaultPath }],
			['vault_has_logo', { vaultPath }],
			[
				'read_data_file',
				{
					vaultPath,
					name: 'platby.json',
				},
			],
			['snapshots_path', { vaultPath }],
			['list_broken_received', { vaultPath }],
			['list_used_numbers', { vaultPath }],
			['list_invoices', { vaultPath }],
			['home_dir', {}],
			['default_vault_path', {}],
			['load_vault_path', {}],
			['mcp_attach', {}],
			['mcp_socket_path', {}],
			['mcp_connector', {}],
			['set_window_theme', { theme: 'dark' }],
		] as const) {
			const answer = await entries.get(name).invoke(name, args);
			answers.push([name, answer]);
		}

		expect(answers).toEqual([
			[
				'ensure_vault',
				{
					ok: true,
					value: null,
				},
			],
			[
				'check_vault',
				{
					ok: true,
					value: null,
				},
			],
			[
				'vault_has_logo',
				{
					ok: true,
					value: false,
				},
			],
			[
				'read_data_file',
				{
					ok: true,
					value: '{}',
				},
			],
			[
				'snapshots_path',
				{
					ok: true,
					value: null,
				},
			],
			[
				'list_broken_received',
				{
					ok: true,
					value: [],
				},
			],
			[
				'list_used_numbers',
				{
					ok: true,
					value: [],
				},
			],
			[
				'list_invoices',
				{
					ok: true,
					value: {
						items: [],
						broken: [],
					},
				},
			],
			[
				'home_dir',
				{
					ok: true,
					value: home,
				},
			],
			[
				'default_vault_path',
				{
					ok: true,
					value: join(home, 'Documents', 'Fakturian'),
				},
			],
			[
				'load_vault_path',
				{
					ok: true,
					value: null,
				},
			],
			[
				'mcp_attach',
				{
					ok: true,
					value: null,
				},
			],
			[
				'mcp_socket_path',
				{
					ok: true,
					value: '/Users/jana/Library/Application Support/com.fakturian.desktop/mcp.sock',
				},
			],
			[
				'mcp_connector',
				{
					ok: true,
					value: {
						command: process.execPath,
						args: ['/Users/jana/fakturian', '--mcp'],
					},
				},
			],
			[
				'set_window_theme',
				{
					ok: true,
					value: null,
				},
			],
		]);
		expect(nativeTheme.themeSource).toBe('dark');
		expect(await names(vaultPath)).toEqual(['faktury', 'prijate']);
	});

	it('dialogy visí na okně appky', async () => {
		await entries.get('pick_folder').invoke('pick_folder', { defaultPath: home });
		await entries.get('pick_files').invoke('pick_files', {
			filterName: 'Faktury',
			extensions: ['pdf'],
			multiple: false,
		});
		await entries.get('pick_save_path').invoke('pick_save_path', {
			defaultName: 'a.pdf',
			filterName: 'PDF',
			extensions: ['pdf'],
		});

		expect(vi.mocked(dialog.showOpenDialog).mock.calls.map(([owner]) => owner)).toEqual([win, win]);
		expect(vi.mocked(dialog.showSaveDialog).mock.calls.map(([owner]) => owner)).toEqual([win]);
	});

	it('zavření okna předá slupce, jejíž úklid okno zavře', async () => {
		expect(await entries.get('close_window').invoke('close_window', {})).toEqual({
			ok: true,
			value: null,
		});
		expect(close).toHaveBeenCalledWith();
	});

	it('chyba skutečného příkazu dojde jako věta z příkazu', async () => {
		const missing = join(home, 'chybi');

		expect(
			await entries.get('load_invoice').invoke('load_invoice', {
				vaultPath: missing,
				number: '20260001',
			}),
		).toEqual({
			ok: false,
			error: `Datová složka ${missing} neexistuje.`,
		});
	});
});

describe('příkazy mostu MCP', () => {
	const delivered: unknown[] = [];
	const bridge = new Bridge((message) => delivered.push(message));
	const list = commands(
		{
			window: {},
			close: () => Promise.resolve(null),
		},
		bridge,
	);

	it('připojení okna mu předá zprávy, které na něj čekaly, a odpověď dojde agentovi', async () => {
		const written: string[] = [];
		const socket = {
			write: (chunk: string, done: () => void) => {
				written.push(chunk);
				done();
			},
			destroy: vi.fn(),
		};
		const session = bridge.open(socket);
		await bridge.receive(session, '{}');
		expect(delivered).toEqual([]);

		expect(await list.mcp_attach.invoke('mcp_attach', {})).toEqual({
			ok: true,
			value: null,
		});
		expect(delivered).toEqual([
			{
				session,
				line: '{}',
			},
		]);

		expect(
			await list.mcp_send.invoke('mcp_send', {
				session,
				line: '{"jsonrpc":"2.0","id":1,"result":{}}',
			}),
		).toEqual({
			ok: true,
			value: null,
		});
		expect(written).toEqual(['{"jsonrpc":"2.0","id":1,"result":{}}\n']);
	});

	it('odpověď uzavřenému spojení je chyba', async () => {
		expect(
			await list.mcp_send.invoke('mcp_send', {
				session: 42,
				line: '{}',
			}),
		).toEqual({
			ok: false,
			error: 'Agent se od mostu odpojil.',
		});
	});
});
