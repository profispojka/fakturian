import { beforeEach, describe, expect, it, vi } from 'vitest';

import { expenseServices } from '~/services/expenses';
import { fioServices } from '~/services/fio';
import { importServices } from '~/services/import';

import { date } from './setup/dates';

const invoke = vi.fn();
vi.stubGlobal('fakturian', {
	invoke,
});
beforeEach(() => {
	invoke.mockReset();
});

const payment = {
	id: '26001',
	amountCents: 12_500,
	vs: '1',
	date: '2026-03-01',
	message: 'Platba',
};

const receivedDocument = {
	file: 'a.pdf',
	supplier: 'A',
	supplierIco: '',
	number: '',
	uuid: '',
	description: 'Práce',
	amountCents: 125,
	date: '2026-03-01',
	recipientIco: '',
};

const report = {
	imported: [],
	skipped: [
		{
			file: 'a',
			reason: 'Duplicitní',
		},
	],
	customers: [],
};

describe('fioServices', () => {
	it('hasToken se ptá klíčenky', async () => {
		invoke.mockResolvedValue(true);
		expect(await fioServices.hasToken()).toBe(true);
		expect(invoke).toHaveBeenCalledExactlyOnceWith('fio_has_token', {});
	});
	it('setToken předá token', async () => {
		invoke.mockResolvedValue(null);
		await fioServices.setToken('token');
		expect(invoke).toHaveBeenCalledExactlyOnceWith('fio_set_token', { token: 'token' });
	});
	it('clearToken token zapomene', async () => {
		invoke.mockResolvedValue(null);
		await fioServices.clearToken();
		expect(invoke).toHaveBeenCalledExactlyOnceWith('fio_clear_token', {});
	});
	it('fetchPayments předá období jako data a vrátí platby', async () => {
		invoke.mockResolvedValue([payment]);
		expect(await fioServices.fetchPayments(date('2026-03-01'), date('2026-03-31'))).toEqual([payment]);
		expect(invoke).toHaveBeenCalledExactlyOnceWith('fio_fetch', {
			from: '2026-03-01',
			to: '2026-03-31',
		});
	});
	it('fetchPayments odmítne platbu s neplatným datem', async () => {
		invoke.mockResolvedValue([
			{
				...payment,
				date: '2026-02-30',
			},
		]);
		await expect(fioServices.fetchPayments(date('2026-03-01'), date('2026-03-31'))).rejects.toThrow(
			new Error('Výpis z Fia má poškozený obsah (0.date: Datum musí být ve tvaru RRRR-MM-DD.).'),
		);
	});
});

describe('expenseServices', () => {
	it('importReceived vrátí přečtený doklad', async () => {
		invoke.mockResolvedValue(receivedDocument);
		expect(await expenseServices.importReceived('/vault', '/source')).toEqual({
			success: true,
			doc: receivedDocument,
		});
		expect(invoke).toHaveBeenCalledExactlyOnceWith('import_received', {
			vaultPath: '/vault',
			sourcePath: '/source',
		});
	});
	it('nečitelný doklad vrátí i se jménem kopie', async () => {
		// Soubor v `prijate/` už leží a bez jména by tam zůstal bez záznamu ve `vydaje.json`.
		invoke.mockResolvedValue({
			...receivedDocument,
			amountCents: 'x',
		});
		expect(await expenseServices.importReceived('/vault', '/source')).toEqual({
			success: false,
			file: 'a.pdf',
			error: 'Přijatý doklad se nepodařilo přečíst: amountCents: Neplatný vstup: očekáváno číslo, obdrženo řetězec',
		});
	});
	it('odpověď bez objektu vrátí bez jména kopie', async () => {
		invoke.mockResolvedValue(null);
		expect(await expenseServices.importReceived('/vault', '/source')).toEqual({
			success: false,
			file: '',
			error: 'Přijatý doklad se nepodařilo přečíst: Neplatný vstup: očekáváno object, obdrženo null',
		});
	});
	it('removeReceived smaže přesný soubor', async () => {
		invoke.mockResolvedValue(null);
		await expenseServices.removeReceived('/vault', 'a.pdf');
		expect(invoke).toHaveBeenCalledExactlyOnceWith('remove_received', {
			vaultPath: '/vault',
			file: 'a.pdf',
		});
	});
	it('documentPath vrátí cestu k dokladu', async () => {
		invoke.mockResolvedValue('/vault/prijate/a.pdf');
		expect(await expenseServices.documentPath('/vault', 'a.pdf')).toBe('/vault/prijate/a.pdf');
		expect(invoke).toHaveBeenCalledExactlyOnceWith('received_path', {
			vaultPath: '/vault',
			file: 'a.pdf',
		});
	});
});

describe('importServices', () => {
	it('importFiles vrátí report tak, jak přišel', async () => {
		invoke.mockResolvedValue(report);
		expect(await importServices.importFiles('/vault', ['/a'], '123')).toEqual(report);
		expect(invoke).toHaveBeenCalledExactlyOnceWith('import_documents', {
			vaultPath: '/vault',
			paths: ['/a'],
			ourIco: '123',
		});
	});
	it('adoptFiles vrátí report tak, jak přišel', async () => {
		invoke.mockResolvedValue(report);
		expect(await importServices.adoptFiles('/vault', ['/b'], null)).toEqual(report);
		expect(invoke).toHaveBeenCalledExactlyOnceWith('adopt_documents', {
			vaultPath: '/vault',
			paths: ['/b'],
			ourIco: null,
		});
	});
	it('scan vrátí nález ve složce', async () => {
		const scan = {
			candidates: [],
			skipped: [],
			supplier: null,
			truncated: false,
		};
		invoke.mockResolvedValue(scan);
		expect(await importServices.scan('/vault', null)).toEqual(scan);
		expect(invoke).toHaveBeenCalledExactlyOnceWith('scan_vault', {
			vaultPath: '/vault',
			ourIco: null,
		});
	});
	it.each([
		[
			'scan',
			() => importServices.scan('/vault', null),
			'Nález ve složce má poškozený obsah (candidates: Neplatný vstup: očekáváno pole, obdrženo undefined, skipped: Neplatný vstup: očekáváno pole, obdrženo undefined a supplier: Neplatný vstup: očekáváno object, obdrženo undefined).',
		],
		[
			'importFiles',
			() => importServices.importFiles('/vault', [], null),
			'Zpráva o importu má poškozený obsah (imported: Neplatný vstup: očekáváno pole, obdrženo undefined, skipped: Neplatný vstup: očekáváno pole, obdrženo undefined a customers: Neplatný vstup: očekáváno pole, obdrženo undefined).',
		],
		[
			'adoptFiles',
			() => importServices.adoptFiles('/vault', [], null),
			'Zpráva o převzetí má poškozený obsah (imported: Neplatný vstup: očekáváno pole, obdrženo undefined, skipped: Neplatný vstup: očekáváno pole, obdrženo undefined a customers: Neplatný vstup: očekáváno pole, obdrženo undefined).',
		],
	])('%s odmítne vadnou odpověď', async (_name, call, message) => {
		invoke.mockResolvedValue({});
		await expect(call()).rejects.toThrow(new Error(message));
	});
});

describe('odmítnutí z backendu', () => {
	it.each([
		['fioServices.hasToken', () => fioServices.hasToken()],
		['fioServices.setToken', () => fioServices.setToken('token')],
		['fioServices.clearToken', () => fioServices.clearToken()],
		['fioServices.fetchPayments', () => fioServices.fetchPayments(date('2026-03-01'), date('2026-03-31'))],
		['expenseServices.importReceived', () => expenseServices.importReceived('/vault', '/a')],
		['expenseServices.removeReceived', () => expenseServices.removeReceived('/vault', 'a')],
		['expenseServices.documentPath', () => expenseServices.documentPath('/vault', 'a')],
		['importServices.importFiles', () => importServices.importFiles('/vault', ['/a'], null)],
		['importServices.adoptFiles', () => importServices.adoptFiles('/vault', ['/a'], null)],
		['importServices.scan', () => importServices.scan('/vault', null)],
	])('%s předá hlášku backendu beze změny', async (_name, call) => {
		// Backend posílá chybu jako řetězec, ne jako `Error`.
		invoke.mockRejectedValue('Zamčeno');
		await expect(call()).rejects.toBe('Zamčeno');
	});
});
