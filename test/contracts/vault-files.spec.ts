import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it } from 'vitest';

import { useSettings } from '~/composables/useSettings';
import { useVaultData } from '~/composables/useVaultData';

import { backend } from '../setup/backend';
import { backendSession } from '../setup/bridge';
import { completeSupplier } from '../setup/fixtures';
import { answerDialog, mountUi } from '../setup/mount';
import { prepareVault } from '../setup/vault';

let directory: string;
let session: ReturnType<typeof backendSession>;

function onDisk(name: string): string {
	return readFileSync(join(directory, '.fakturian', name), 'utf8');
}

beforeEach(async () => {
	directory = mkdtempSync(join(tmpdir(), 'fakturian-vault-'));
	session = backendSession();
	backend.forwards('read_data_file', (args) =>
		session.call({
			command: 'read_data',
			vault: args.vaultPath,
			name: args.name,
		}),
	);
	backend.forwards('write_data_file', (args) =>
		session.call({
			command: 'write_data',
			vault: args.vaultPath,
			name: args.name,
			json: args.json,
		}),
	);
	await prepareVault({}, directory);
});
afterEach(() => {
	session.close();
	rmSync(directory, {
		recursive: true,
		force: true,
	});
});

it('nová složka bez .fakturian je prázdná evidence, ne chyba', () => {
	expect(useVaultData().loaded.value).toBe(true);
	expect(useSettings().supplier.value).toBeNull();
	expect(backend.args('read_data_file')).toEqual([
		{
			vaultPath: directory,
			name: 'nastaveni.json',
		},
		{
			vaultPath: directory,
			name: 'platby.json',
		},
		{
			vaultPath: directory,
			name: 'vydaje.json',
		},
	]);
});

it('dodavatel uložený appkou leží na disku a projde znovu schématem', async () => {
	await useSettings().setSupplier(completeSupplier());

	expect(JSON.parse(onDisk('nastaveni.json'))).toEqual({
		supplier: completeSupplier(),
		contacts: [],
		pricelist: [],
	});
	await useVaultData().load();
	expect(useSettings().supplier.value).toEqual(completeSupplier());
});

it('soubor změněný mimo appku backend nepřepíše a appka to řekne', async () => {
	mountUi({ render: () => null });
	const outside = JSON.stringify({
		supplier: null,
		contacts: [],
		pricelist: [],
		note: 'jiný Mac',
	});
	mkdirSync(join(directory, '.fakturian'), { recursive: true });
	writeFileSync(join(directory, '.fakturian', 'nastaveni.json'), outside);

	const saving = Promise.allSettled([useSettings().setSupplier(completeSupplier())]);
	await answerDialog(false);

	expect(await saving).toEqual([
		{
			status: 'rejected',
			reason: new Error('Změna se neuložila: soubor nastaveni.json mezitím změnil jiný počítač nebo program.'),
		},
	]);
	expect(onDisk('nastaveni.json')).toBe(outside);
	expect(useSettings().supplier.value).toBeNull();
});

it('nečitelný soubor appka nenačte a hlášku dostane od backendu', async () => {
	mkdirSync(join(directory, '.fakturian'), { recursive: true });
	writeFileSync(join(directory, '.fakturian', 'vydaje.json'), '{"expenses": [');

	await expect(useVaultData().load()).rejects.toThrow(
		new Error('Soubor vydaje.json není platný JSON: Unexpected end of JSON input'),
	);
	expect(onDisk('vydaje.json')).toBe('{"expenses": [');
});
