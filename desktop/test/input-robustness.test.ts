import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Writable } from 'node:stream';

import { assert, asyncProperty, constantFrom, nat, oneof, property, string, tuple, uint8Array } from 'fast-check';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { validateNumber } from '~/utils/numbering';
import { z } from '~/utils/zod';

import { parseFio } from '../fio.ts';
import { parse, sentAt, toXml } from '../isdoc/mod.ts';
import { intoInvoice } from '../isdoc/projection.ts';
import { runConnector } from '../mcp/connector.ts';
import { rejection } from '../mcp/mod.ts';
import { hasSignature, loadPdf, readIsdoc, type EmbeddedIsdoc } from '../pdf.ts';
import { parseJson, readDataFile, writeDataFile, type DataFileWrite } from '../store.ts';
import { ensureVault } from '../vault.ts';

import type { Document } from '@xmldom/xmldom';
import type { Arbitrary } from 'fast-check';
import type { PDFDocument } from 'pdf-lib';
import type { FioPayment } from '~/bindings';

const SEED = 202_609;
// `bun run test:fuzz` počet zvedá; běžné sadě stačí krátký běh se stejným seedem.
const requested = process.env.FUZZ_CASES ?? '64';
if (!/^[1-9]\d*$/.test(requested)) throw new Error(`FUZZ_CASES musí být kladné celé číslo, ne „${requested}“.`);
const CASES = Number(requested);

// Ztrátově jako text z cizího souboru: nečitelný bajt se změní na U+FFFD.
const TEXT = new TextDecoder();

const ISDOC_FILES = [
	'example1.isdoc',
	'example2.isdoc',
	'foreign-document.isdoc',
	'two-payments.isdoc',
	'zalohova.isdoc',
	'zaokrouhleni.isdoc',
	'bez-castky.isdoc',
	'bez-mnozstvi.isdoc',
];
const ISDOC_SEEDS = await Promise.all(
	ISDOC_FILES.map((name) => readFile(new URL(`fixtures/${name}`, import.meta.url))),
);
const PDF_SEEDS = await Promise.all(
	['2026017', '2026018', '2026022'].map((number) =>
		readFile(new URL(`fixtures/adopt/Vydaná faktura - ${number}.pdf`, import.meta.url)),
	),
);
const FIO_SEED = new TextEncoder().encode(
	'{"accountStatement":{"info":{"currency":"CZK"},"transactionList":{"transaction":[{"column0":{"value":"2026-09-10"},"column1":{"value":1250.5},"column5":{"value":"20260001"},"column22":{"value":"fixture-payment"}}]}}}',
);
const JSON_SEEDS = [
	...(await Promise.all(
		['adopt-folder.json', 'document-number-parity.json', 'money-parity.json'].map((name) =>
			readFile(new URL(`../../src/utils/fixtures/${name}`, import.meta.url)),
		),
	)),
	new TextEncoder().encode(
		'{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"summary","arguments":{"year":2026}}}',
	),
	new TextEncoder().encode('{"jsonrpc":"2.0","id":"a\\"b\\n","method":"tools/list"}'),
	new TextEncoder().encode(
		'{"jsonrpc":"2.0","id":9007199254740992,"method":"tools/call","params":{"name":"summary"}}',
	),
	FIO_SEED,
];

// Znaky, na kterých se láme cesta (i obrácení směru textu); náhodný kód Unicode je trefí jen zřídka.
const PATH_CHARS = ['.', '/', '\\', '\0', ' ', '~', ':', '-', 'a', 'Z', '0', 'ř', String.fromCodePoint(0x20_2e)];

const toolErrorSchema = z.object({
	jsonrpc: z.literal('2.0'),
	result: z.object({
		content: z.tuple([
			z.object({
				type: z.literal('text'),
				text: z.string(),
			}),
		]),
		isError: z.literal(true),
	}),
});

const rpcLineSchema = z.object({ jsonrpc: z.literal('2.0') });

// Mutace seedu přepíše kus náhodnými bajty a zbytek posune; čistě náhodný vstup hlídá, že parser
// neprojde jen tvarem, který zná.
function seededBytes(seeds: Uint8Array[], maxPatch: number, maxLength: number): Arbitrary<Uint8Array> {
	return oneof(
		{
			weight: 1,
			arbitrary: uint8Array({ maxLength: maxPatch }),
		},
		{
			weight: 5,
			arbitrary: tuple(constantFrom(...seeds), nat(), uint8Array({ maxLength: maxPatch })).map(
				([seed, offset, patch]) => {
					const at = offset % (seed.length + 1);
					const end = Math.min(at + Math.floor(patch.length / 2), seed.length);
					return new Uint8Array(
						Buffer.concat([seed.subarray(0, at), patch, seed.subarray(end)]).subarray(0, maxLength),
					);
				},
			),
		},
	);
}

// Odmítnutý vstup je `Error` s větou pro uživatele. `TypeError` nebo `RangeError` z hloubi kódu je pád
// na neošetřeném vstupu a jde dál jako selhání vlastnosti.
function expectRefusal(error: unknown): void {
	if (!(error instanceof Error) || error.constructor !== Error || error.message === '') throw error;
}

// `false`, když parser vstup odmítl; seed, který takhle skončí, by mutacemi hloubku nepokryl.
async function exerciseIsdoc(data: Uint8Array): Promise<boolean> {
	let document: Document;
	try {
		document = await parse(TEXT.decode(data));
	} catch (error) {
		expectRefusal(error);
		return false;
	}
	try {
		sentAt(document);
	} catch (error) {
		expectRefusal(error);
	}
	try {
		intoInvoice(document);
	} catch (error) {
		expectRefusal(error);
	}
	await parse(toXml(document));
	return true;
}

// `true` jen u PDF, které nese ISDOC — až tam dojde i rozbor přílohy.
async function exercisePdf(data: Uint8Array): Promise<boolean> {
	let pdf: PDFDocument;
	try {
		pdf = await loadPdf(data);
	} catch {
		// Důvod nese pdf-lib a volající ho zasadí do své věty.
		return false;
	}
	hasSignature(pdf);
	let isdoc: EmbeddedIsdoc;
	try {
		isdoc = await readIsdoc(pdf);
	} catch (error) {
		expectRefusal(error);
		return false;
	}
	await parse(isdoc.xml);
	return true;
}

// `true`, když vstup přijal rozbor výpisu Fio.
async function exerciseJsonProtocols(data: Uint8Array): Promise<boolean> {
	const text = TEXT.decode(data);
	let payments: FioPayment[] = [];
	let fioAccepted = false;
	try {
		payments = parseFio(parseJson(text));
		fioAccepted = true;
	} catch (error) {
		// Nečitelný JSON odmítne `fioFetch` vlastní větou ještě před rozborem výpisu.
		if (!(error instanceof SyntaxError)) expectRefusal(error);
	}
	expect(payments.filter(({ amountCents }) => !(Number.isSafeInteger(amountCents) && amountCents > 0))).toEqual([]);

	// Na požadavek, který nedošel k oknu, most odpovídá sám; odpověď musí být jeden řádek JSON-RPC.
	const answers = [rejection(text, 'Okno neposlouchá.')].filter((answer) => answer !== undefined);
	for (const answer of answers) {
		expect(answer.includes('\n')).toBe(false);
		expect(toolErrorSchema.safeParse(JSON.parse(answer)).data?.result.content[0].text).toBe('Okno neposlouchá.');
	}

	// Connector skládá odpovědi z `id` agenta; každá musí zůstat jedním řádkem JSON-RPC.
	let output = '';
	const collected = new Writable({
		write(chunk: Buffer, _encoding, done) {
			output += chunk.toString();
			done();
		},
	});
	expect(await runConnector([Buffer.from(data)], collected, '/neexistuje/mcp.sock')).toBe(0);
	for (const line of output.split('\n').slice(0, -1)) {
		expect(rpcLineSchema.safeParse(JSON.parse(line)).success).toBe(true);
	}
	return fioAccepted;
}

// `false`, když zápis vstup odmítl.
async function exerciseVaultJson(vaultPath: string, data: Uint8Array): Promise<boolean> {
	let written: DataFileWrite;
	try {
		written = await writeDataFile({
			vaultPath,
			name: 'nastaveni.json',
			json: TEXT.decode(data),
		});
	} catch (error) {
		expectRefusal(error);
		return false;
	}
	expect(written).toBe('written');
	const stored = await readDataFile({
		vaultPath,
		name: 'nastaveni.json',
	});
	expect(z.record(z.string(), z.unknown()).safeParse(JSON.parse(stored)).success).toBe(true);
	return true;
}

describe('generativní testy vstupů zvenku', () => {
	let vault = '';

	beforeAll(async () => {
		vault = await mkdtemp(join(tmpdir(), 'fakturian-fuzz-'));
		await ensureVault({ vaultPath: vault });
	});

	afterAll(async () => {
		await rm(vault, { recursive: true });
	});

	it('ISDOC odmítne větou, nebo ho projekce přečte a přeuložený projde čtením znovu', async () => {
		const accepted = [];
		for (const seed of ISDOC_SEEDS) accepted.push(await exerciseIsdoc(seed));
		expect(accepted).toEqual(ISDOC_FILES.map((name) => name !== 'bez-castky.isdoc'));

		// Vlastnost nic nevrací: `false` by fast-check vzal za selhání, přijetí hlídají jen seedy výš.
		await assert(
			asyncProperty(seededBytes(ISDOC_SEEDS, 4096, 1024 * 1024), async (data) => {
				await exerciseIsdoc(data);
			}),
			{
				seed: SEED + 1,
				numRuns: CASES,
			},
		);
	});

	it('z PDF vydá jen čitelnou přílohu ISDOC a podpis hledá bez pádu', async () => {
		const accepted = [];
		for (const seed of PDF_SEEDS) accepted.push(await exercisePdf(seed));
		expect(accepted).toEqual([true, true, true]);

		// pdf-lib hlásí každý vadný objekt na konzoli; tisíce případů by zahltily výstup testu.
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		await assert(
			asyncProperty(seededBytes(PDF_SEEDS, 4096, 1024 * 1024), async (data) => {
				await exercisePdf(data);
			}),
			{
				seed: SEED + 2,
				numRuns: CASES,
			},
		);
	});

	it('výpis Fio dá jen kladné částky a odpovědi MCP zůstanou jedním řádkem JSON-RPC', async () => {
		const fioAccepted = [];
		for (const seed of JSON_SEEDS) fioAccepted.push(await exerciseJsonProtocols(seed));
		expect(fioAccepted).toEqual([false, false, false, false, false, false, true]);
		expect(parseFio(parseJson(TEXT.decode(FIO_SEED)))).toEqual([
			{
				id: 'fixture-payment',
				amountCents: 125_050,
				vs: '20260001',
				date: '2026-09-10',
				message: '',
			},
		]);

		await assert(
			asyncProperty(seededBytes(JSON_SEEDS, 4096, 256 * 1024), async (data) => {
				await exerciseJsonProtocols(data);
			}),
			{
				seed: SEED + 3,
				numRuns: CASES,
			},
		);
	});

	it('zápis dat do vaultu odmítne větou, nebo zapsané jde přečíst zpátky jako objekt', async () => {
		const written = [];
		for (const seed of JSON_SEEDS) written.push(await exerciseVaultJson(vault, seed));
		expect(written).toEqual([true, true, true, true, true, true, true]);

		await assert(
			asyncProperty(seededBytes(JSON_SEEDS, 4096, 256 * 1024), async (data) => {
				await exerciseVaultJson(vault, data);
			}),
			{
				seed: SEED + 4,
				numRuns: CASES,
			},
		);
	});

	it('přijaté číslo dokladu je jediná relativní složka cesty', () => {
		const folder = join('/', 'vault', 'faktury');
		assert(
			property(
				oneof(
					string({
						unit: 'binary',
						maxLength: 256,
					}),
					string({
						unit: constantFrom(...PATH_CHARS),
						maxLength: 16,
					}),
				),
				(number) => {
					if (validateNumber(number) !== null) return;
					const path = join(folder, number);
					expect([dirname(path), basename(path)]).toEqual([folder, number]);
				},
			),
			{
				seed: SEED + 5,
				numRuns: CASES,
			},
		);
	});
});
