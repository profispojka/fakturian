import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { expensesFileSchema } from '~/schemas/expenses';
import { paymentsFileSchema } from '~/schemas/payments';
import { supplierReadyForInvoicing } from '~/schemas/suppliers';
import { vaultDataSchema } from '~/schemas/vault-data';

import { listInvoices } from '../invoice/index.ts';
import { loadInvoice } from '../invoice/mod.ts';

const RUN = fileURLToPath(new URL('../examples/run.ts', import.meta.url));
const E2E_SETTINGS = fileURLToPath(new URL('../../e2e/fixtures/vault/.fakturian/nastaveni.json', import.meta.url));

let base = '';

beforeEach(async () => {
	base = await mkdtemp(join(tmpdir(), 'fakturian-examples-'));
});

afterEach(async () => {
	await rm(base, { recursive: true });
});

interface Output {
	code: number | null;
	stdout: string;
	stderr: string;
}

// Generátor běží jako samostatný proces, jak ho spouští člověk z příkazové řádky.
async function generate(example: string, args: string[]): Promise<Output> {
	const child = spawn(process.execPath, [RUN, example, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
	let stdout = '';
	let stderr = '';
	child.stdout.on('data', (chunk: Buffer) => {
		stdout += chunk.toString();
	});
	child.stderr.on('data', (chunk: Buffer) => {
		stderr += chunk.toString();
	});
	const { promise, resolve } = Promise.withResolvers<number | null>();
	child.on('close', resolve);
	const code = await promise;
	return {
		code,
		stdout,
		stderr,
	};
}

async function dataFile(vault: string, name: string): Promise<unknown> {
	const text = await readFile(join(vault, '.fakturian', name), 'utf8');
	return JSON.parse(text);
}

describe('ukázkový vault', () => {
	it('projde výpisem backendu i schématy frontendu a pro stejný den vyjde stejně', async () => {
		const vault = join(base, 'demo');

		const output = await generate('demo-vault', [vault, '2026-08-21']);
		const again = await generate('demo-vault', [join(base, 'znovu'), '2026-08-21']);

		expect([output.code, output.stderr, again.code]).toEqual([0, '', 0]);
		expect(output.stdout.split('\n').slice(-9)).toEqual([
			'',
			`Hotovo → ${vault}`,
			'  appka ve složce načte: 86 dokladů',
			'  faktur: 86 (z toho 2 dobropisy)',
			'  zaplaceno: 78, nezaplaceno: 8',
			'  letos (2026) vyfakturováno: 1424850 Kč',
			'  klouzavých 12 měsíců: 1912150 Kč (95 % limitu 2 000 000)',
			'  výdajů: 24, řádků s vazbou na ceník: 110',
			'',
		]);
		const listed = await listInvoices({ vaultPath: vault });
		expect([listed.items.length, listed.broken]).toEqual([86, []]);
		const settings = vaultDataSchema.parse(await dataFile(vault, 'nastaveni.json'));
		expect(supplierReadyForInvoicing(settings.supplier)).toBe(true);
		const { payments } = paymentsFileSchema.parse(await dataFile(vault, 'platby.json'));
		const { expenses } = expensesFileSchema.parse(await dataFile(vault, 'vydaje.json'));
		expect([Object.keys(payments).length, expenses.length]).toEqual([78, 24]);
		// Platba s číslem, které ve vaultu není, by se v appce tiše ztratila.
		const numbers = listed.items.map(({ number }) => number);
		expect(Object.keys(payments).filter((number) => !numbers.includes(number))).toEqual([]);
		for (const name of ['nastaveni.json', 'platby.json', 'vydaje.json']) {
			expect(await dataFile(join(base, 'znovu'), name)).toEqual(await dataFile(vault, name));
		}
	}, 60_000);

	it('cizí složku s obsahem nepřepíše', async () => {
		await writeFile(join(base, 'poznamka.txt'), 'cizí data');

		const output = await generate('demo-vault', [base]);

		expect([output.code, output.stderr]).toEqual([
			1,
			`Složka ${base} není prázdná — ukázková data by přepsala cizí vault.\n`,
		]);
	});
});

describe('faktura pro E2E', () => {
	it('sedí s dodavatelem a odběratelem z nastavení fixture vaultu', async () => {
		await mkdir(join(base, '.fakturian'));
		await copyFile(E2E_SETTINGS, join(base, '.fakturian', 'nastaveni.json'));

		const output = await generate('e2e-invoice', [base, '2026-10-01']);

		expect([output.code, output.stdout]).toEqual([0, '  faktura 20260001  E2E odběratel  2 501 Kč\n']);
		const listed = await listInvoices({ vaultPath: base });
		expect(listed.items.map(({ number, totalCents }) => [number, totalCents])).toEqual([['20260001', 250_100]]);
		const settings = vaultDataSchema.parse(await dataFile(base, 'nastaveni.json'));
		expect(supplierReadyForInvoicing(settings.supplier)).toBe(true);
		const invoice = await loadInvoice({
			vaultPath: base,
			number: '20260001',
		});
		expect([invoice.supplier.name, invoice.supplier.ico, invoice.customer.name, invoice.customer.ico]).toEqual([
			settings.supplier?.name,
			settings.supplier?.ico,
			settings.contacts[0]?.name,
			settings.contacts[0]?.ico,
		]);
	});
});

describe('argumenty generátorů', () => {
	const usage = {
		'demo-vault': 'Použití: node desktop/examples/run.ts demo-vault <cesta k ukázkové složce> [RRRR-MM-DD]',
		'e2e-invoice': 'Použití: node desktop/examples/run.ts e2e-invoice <vault> <RRRR-MM-DD>',
	};

	for (const [script, text] of Object.entries(usage)) {
		it(`${script} bez argumentů vypíše použití a skončí kódem 2`, async () => {
			const output = await generate(script, []);

			expect([output.code, output.stderr]).toEqual([2, `${text}\n`]);
		});

		it(`${script} odmítne neplatné datum kódem 2`, async () => {
			const output = await generate(script, ['/nikde/vault', '2026-02-30']);

			expect([output.code, output.stderr]).toEqual([2, `Datum 2026-02-30 není RRRR-MM-DD.\n${text}\n`]);
		});
	}

	it('neznámý příklad odmítne kódem 2', async () => {
		const output = await generate('neexistuje', []);

		expect([output.code, output.stderr]).toEqual([
			2,
			'Použití: node desktop/examples/run.ts <demo-vault|e2e-invoice> …\n',
		]);
	});
});
