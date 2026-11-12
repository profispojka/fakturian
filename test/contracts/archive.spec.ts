import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it } from 'vitest';

import { useAdopt } from '~/composables/useAdopt';
import { useInvoices } from '~/composables/useInvoices';
import { useSettings } from '~/composables/useSettings';

import { backend } from '../setup/backend';
import { fixture, foreignPdf, realBackend, sample } from '../setup/bridge';
import { prepareVault } from '../setup/vault';

const NUMBER = '2026-0043';
let directory: string;

/** Skutečný doklad ve `faktury/`; odeslání se zapisuje do ISDOC uvnitř toho PDF. */
function issueDocument(): void {
	const source = foreignPdf(join(directory, 'source.pdf'), sample('bez-mnozstvi.isdoc'));
	realBackend({
		command: 'import',
		vault: directory,
		paths: [source],
	});
}

// Backend dostává argumenty, které poslala appka, ne ty, které by zvolil test.
beforeEach(async () => {
	directory = mkdtempSync(join(tmpdir(), 'fakturian-archive-'));
	backend.forwards('list_invoices', (args) =>
		realBackend({
			command: 'list',
			vault: args.vaultPath,
		}),
	);
	backend.forwards('scan_vault', (args) =>
		realBackend({
			command: 'scan',
			vault: args.vaultPath,
			ico: args.ourIco,
		}),
	);
	backend.forwards('adopt_documents', (args) =>
		realBackend({
			command: 'adopt',
			vault: args.vaultPath,
			paths: args.paths,
			ico: args.ourIco,
		}),
	);
	backend.forwards('delete_invoice', (args) =>
		realBackend({
			command: 'delete',
			vault: args.vaultPath,
			number: args.number,
		}),
	);
	backend.forwards('mark_invoice_sent', (args) =>
		realBackend({
			command: 'mark_sent',
			vault: args.vaultPath,
			number: args.number,
		}),
	);
	await prepareVault({}, directory);
});
afterEach(() =>
	rmSync(directory, {
		recursive: true,
		force: true,
	}),
);

it('převzetí cizí složky projde skutečným backendem až do nastavení a kontaktů', async () => {
	for (const file of readdirSync(fixture('adopt'))) {
		copyFileSync(join(fixture('adopt'), file), join(directory, file));
	}

	const scan = await useAdopt().refresh();
	if (!scan) throw new Error('Sken skončil bez nálezu — backend nic nevrátil, nebo to neprošlo schématem.');
	expect(scan.candidates).toHaveLength(3);
	expect(scan.supplier?.ico).toBe('12345679');

	const result = await useAdopt().adopt(scan);

	expect(result.adopted).toBe(3);
	expect(result.skipped).toEqual([]);
	expect(result.addedContacts).toBe(2);
	expect(result.supplierFilled).toBe(true);
	expect(useSettings().supplier.value?.ico).toBe('12345679');
	expect(useSettings().supplier.value?.bankAccount).toBe('19-2000145399');
	expect(backend.args('adopt_documents')).toEqual([
		{
			vaultPath: directory,
			paths: scan.candidates.map((candidate) => candidate.path),
			ourIco: '12345679',
		},
	]);
});

it('doklad smazaný backendem zmizí z přehledu i ze složky', async () => {
	issueDocument();
	const before = await useInvoices().list();
	expect(before.map((summary) => summary.number)).toEqual([NUMBER]);

	await useInvoices().remove(NUMBER);

	expect(await useInvoices().list()).toEqual([]);
	expect(readdirSync(join(directory, 'faktury'))).toEqual([]);
});

it('čas odeslání zapsaný backendem projde přes schéma přehledu', async () => {
	issueDocument();
	const sentAt = await useInvoices().markSent(NUMBER);

	const [summary] = await useInvoices().list();
	expect(summary?.sentAt).toBe(sentAt);
	// Druhé odeslání čas nepřepíše: backend vrátí ten zapsaný v PDF.
	expect(await useInvoices().markSent(NUMBER)).toBe(sentAt);
});

it('nedotčený doklad nemá čas odeslání', async () => {
	issueDocument();
	const [summary] = await useInvoices().list();
	expect(summary?.number).toBe(NUMBER);
	expect(summary?.sentAt).toBeNull();
});
