import { execFile } from 'node:child_process';
import { STATUS_CODES } from 'node:http';

import { AsyncEntry } from '@napi-rs/keyring';
import BigDecimal from 'big.js';

import { isDateString } from '~/utils/date';

import { amountCents } from './isdoc/mod.ts';
import { parseJson } from './store.ts';
import { USER_AGENT } from './util.ts';

import type { FioPayment } from '~/bindings';

// Stryker disable next-line StringLiteral: prázdná služba shodí `AsyncEntry` už při importu, takže se nespustí žádný test.
const KEYCHAIN_SERVICE = 'com.fakturian.desktop';
// Stryker disable next-line StringLiteral: prázdný účet shodí `AsyncEntry` už při importu, takže se nespustí žádný test.
const KEYCHAIN_ACCOUNT = 'fio-token';
const ACCOUNT_CURRENCY = 'CZK';
const FIO_BASE = 'https://fioapi.fio.cz/v1/rest';
const SECURITY = '/usr/bin/security';
// Návratový kód `security`, když položka v klíčence není.
const NOT_FOUND = 44;

// Bez limitu visí dotaz na nedostupné síti minuty se zamrzlým tlačítkem.
const TIMEOUT = 15_000;

// Fio vydává token o 64 znacích `[A-Za-z0-9]`. Tvar se hlídá přesně, protože token jde do cesty URL:
// mezera, `/`, `?` nebo `#` by dotaz poslaly jinam.
const TOKEN = /^[A-Za-z0-9]{64}$/;

// Klíčenka umí otevřít systémový dialog; `AsyncEntry` na něj čeká mimo smyčku událostí.
let keychain: AsyncEntry | undefined = new AsyncEntry(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);

// E2E sada běží na stroji toho, kdo ji pouští, a do jeho klíčenky nesmí sáhnout; token pak drží jen
// `knownToken` po dobu běhu procesu.
export function keepTokenInMemory(): void {
	keychain = undefined;
}

export function checkToken(token: string): void {
	if (!TOKEN.test(token)) {
		throw new Error('Fio token má být 64 znaků A–Z, a–z, 0–9 (zkopíruj ho z internetového bankovnictví celý).');
	}
}

// Data jdou do cesty URL vedle tokenu, takže by je `../` odklonilo na jiný endpoint.
function checkDate(description: string, date: string): void {
	if (!isDateString(date)) throw new Error(`Neplatné datum ${description} (čekám RRRR-MM-DD).`);
}

// Každé čtení hesla z klíčenky může otevřít systémový dialog, takže se token čte nejvýš jednou za běh
// a dál se bere odsud.
let knownToken: string | undefined;

// Chybějící záznam vrací knihovna jako `null`, ačkoli její typy slibují `undefined`.
async function storedToken(): Promise<string | undefined> {
	if (knownToken === undefined) {
		const token = await keychain?.getPassword();
		knownToken = token ?? undefined;
	}
	return knownToken;
}

export async function fioSetToken({ token }: { token: string }): Promise<null> {
	const trimmed = token.trim();
	checkToken(trimmed);
	await keychain?.setPassword(trimmed);
	knownToken = trimmed;
	return null;
}

// Hledání bez `-w` vrací jen atributy položky, ne heslo, takže se klíčenka na povolení neptá.
export async function fioHasToken(): Promise<boolean> {
	if (knownToken !== undefined) return true;
	if (keychain === undefined) return false;
	const search = Promise.withResolvers<boolean>();
	execFile(
		SECURITY,
		['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT],
		// Stryker disable next-line BlockStatement: bez odpovědi příslib visí, mutant skončí jen timeoutem.
		(failed, _stdout, stderr) => {
			if (failed === null) search.resolve(true);
			else if (failed.code === NOT_FOUND) search.resolve(false);
			// Stryker disable next-line BlockStatement: bez odmítnutí příslib visí, mutant skončí jen timeoutem.
			else {
				search.reject(
					new Error(`Fio token v klíčence nejde vyhledat: ${stderr.trim() || failed.message}`, {
						cause: failed,
					}),
				);
			}
		},
	);
	const found = await search.promise;
	return found;
}

export async function fioClearToken(): Promise<null> {
	await keychain?.deleteCredential();
	knownToken = undefined;
	return null;
}

function field(value: unknown, key: string): unknown {
	if (typeof value !== 'object' || value === null) return undefined;
	return Object.entries(value).find(([name]) => name === key)?.[1];
}

function column(transaction: unknown, name: string): unknown {
	return field(field(transaction, name), 'value');
}

// Fio posílá ID i variabilní symbol jednou jako text, jindy jako číslo.
function columnText(transaction: unknown, name: string): string {
	const value = column(transaction, name);
	if (typeof value === 'string') return value;
	if (typeof value === 'number') return String(value);
	return '';
}

// Doklady jsou v korunách a párování porovnává haléře: pohyb z účtu v jiné měně by se zapsal jako
// úhrada ve stejném čísle Kč. Nečitelná částka je chyba, ne nula, se kterou by pohyb tiše vypadl.
export function parseFio(statement: unknown): FioPayment[] {
	const account = field(statement, 'accountStatement');
	const currency = field(field(account, 'info'), 'currency');
	if (typeof currency !== 'string') throw new Error('Fio neposlalo měnu účtu, platby proto nejde spárovat.');
	if (currency !== ACCOUNT_CURRENCY) {
		throw new Error(
			`Fio účet je vedený v ${currency}. Fakturian páruje jen platby na korunový účet — ulož token k účtu v CZK.`,
		);
	}
	const transactions = field(field(account, 'transactionList'), 'transaction');
	if (!Array.isArray(transactions)) return [];
	const listed: unknown[] = transactions;
	const payments: FioPayment[] = [];
	for (const [i, transaction] of listed.entries()) {
		const amount = column(transaction, 'column1');
		// Přes zápis čísla, ne přes násobení: `1250.3 × 100` by v plovoucí čárce nevyšlo na celé haléře.
		const cents = typeof amount === 'number' ? amountCents(new BigDecimal(amount)) : undefined;
		const id = columnText(transaction, 'column22');
		const label = id === '' ? `č. ${i + 1} v pořadí` : `id ${id}`;
		if (cents === undefined) {
			throw new Error(
				`Fio poslalo transakci (${label}) s nečitelnou nebo nesmyslně velkou částkou — Fakturian ji radši nezpracuje, než aby ji spolkl jako nulu.`,
			);
		}
		if (cents <= 0) continue;
		// Fio posílá den s časovou zónou (`2026-03-10+0100`); platba se datuje dnem.
		const date = Array.from(columnText(transaction, 'column0')).slice(0, 10).join('');
		if (!isDateString(date)) {
			throw new Error(`Fio poslalo transakci (${label}) bez čitelného data — Fakturian ji radši nezpracuje.`);
		}
		payments.push({
			id,
			amountCents: cents,
			vs: columnText(transaction, 'column5'),
			date,
			message: columnText(transaction, 'column16'),
		});
	}
	return payments;
}

export async function fioFetch({ from, to }: { from: string; to: string }): Promise<FioPayment[]> {
	const token = await storedToken();
	if (token === undefined) throw new Error('Není uložený Fio token.');
	checkToken(token);
	checkDate('„od"', from);
	checkDate('„do"', to);

	const limit = AbortSignal.timeout(TIMEOUT);
	let response: Response;
	try {
		// Přesměrování by token odneslo na cizí server.
		response = await fetch(`${FIO_BASE}/periods/${token}/${from}/${to}/transactions.json`, {
			redirect: 'manual',
			signal: limit,
			headers: {
				'User-Agent': USER_AGENT,
			},
		});
	} catch {
		// Bez `cause`: chyba `fetch` nese v textu celou adresu i s tokenem.
		if (limit.aborted) throw new Error('Fio neodpovědělo do 15 sekund. Zkus to za chvíli.');
		throw new Error('Nepodařilo se spojit s Fio (jste offline?).');
	}
	if (!response.ok) {
		await response.body?.cancel();
		if (response.status === 409) throw new Error('Fio: příliš mnoho dotazů (limit 1 za 30 s). Zkus to za chvíli.');
		if (response.status === 422 || response.status === 404) throw new Error('Fio: neplatný token nebo požadavek.');
		// Text stavu podle čísla, ne ten, který poslal server.
		const status = `${response.status} ${STATUS_CODES[response.status] ?? ''}`.trimEnd();
		throw new Error(`Fio vrátil chybu ${status}.`);
	}
	let text: string;
	try {
		text = await response.text();
	} catch {
		throw new Error('Odpověď z Fio se nepodařilo přečíst.');
	}
	let statement: unknown;
	try {
		statement = parseJson(text);
	} catch {
		throw new Error('Fio vrátilo odpověď, které Fakturian nerozumí.');
	}
	return parseFio(statement);
}
