import { encode } from 'fast-png';
// @ts-types="@types/qrcode"
import { create } from 'qrcode';

import { invoiceTotalCents, variableSymbolFor } from '~/utils/invoice';
import { isValidBankAccount, isValidBankCode } from '~/utils/validators';

import { fromCents } from '../isdoc/mod.ts';

import type { Invoice } from './model.ts';

const MODULE_PIXELS = 8;
const QUIET_ZONE = 4;
const MODULE_ROWS = [...Array.from({ length: MODULE_PIXELS }).keys()];

export function czechIban(account: string, bankCode: string): string | undefined {
	if (!isValidBankAccount(account) || !isValidBankCode(bankCode)) return undefined;
	const bank = bankCode.replace(/\s/g, '');
	const normalized = account.replace(/\s/g, '');
	const dash = normalized.indexOf('-');
	const prefix = dash === -1 ? '' : normalized.slice(0, dash);
	const number = normalized.slice(dash + 1);
	const bban = `${bank}${prefix.padStart(6, '0')}${number.padStart(10, '0')}`;
	// BBAN s kódem země má 26 číslic; tolik jich `number` přesně neunese.
	const check = 98n - (BigInt(`${bban}123500`) % 97n);
	return `CZ${String(check).padStart(2, '0')}${bban}`;
}

// Variabilní symbol, jak ho uvádí PDF, ISDOC, přehled pro Fio i QR kód: jen číslice, nejvýš 10 (ČNB).
// Syrový řetězec by rozbil kód (`2026*007`) nebo by ho banka odmítla (`F2026-007`).
export function paymentSymbol(invoice: Invoice): string {
	const given = invoice.variableSymbol.trim();
	if (given.length >= 1 && given.length <= 10 && !/\D/.test(given)) return given;
	// Z čísla dokladu, ne z číslic vyplněného VS: ty by u `20260007*ACC:CZ00…9999999999` propašovaly
	// podstrčený účet.
	return variableSymbolFor(invoice.number);
}

// SPAYD pouští v `AM` nejvýš 10 znaků. Od 10 milionů se vejde jen částka bez haléřů, a to bez desetinné
// části; jinak by banka celý kód odmítla.
export function spaydAmount(cents: number): string | undefined {
	const whole = Math.trunc(cents / 100);
	const amount = fromCents(cents);
	if (amount.length <= 10) return amount;
	if (cents % 100 !== 0 || String(whole).length > 10) return undefined;
	return String(whole);
}

export function buildSpayd(invoice: Invoice): string | undefined {
	const cents = invoiceTotalCents(invoice);
	if (cents <= 0) return undefined;
	const iban = czechIban(invoice.bankAccount, invoice.bankCode);
	if (iban === undefined) return undefined;
	const amount = spaydAmount(cents);
	if (amount === undefined) return undefined;
	const fields = [`SPD*1.0*ACC:${iban}`, `AM:${amount}`, 'CC:CZK'];
	const due = invoice.dueDate.replace(/\D/g, '');
	if (due.length === 8) fields.push(`DT:${due}`);
	const symbol = paymentSymbol(invoice);
	if (symbol) fields.push(`X-VS:${symbol}`);
	// Rozklad na NFD odpojí od písmene diakritické znaménko a to vypadne s ostatními neASCII znaky.
	// Hvězdička je oddělovač polí SPAYD.
	const message = `Faktura ${invoice.number}`.normalize('NFD').replace(/[^\p{ASCII}]|\*/gu, '');
	fields.push(`MSG:${message.slice(0, 60)}`);
	return fields.join('*');
}

export function qrPng(data: string): Uint8Array {
	let qr: ReturnType<typeof create>;
	try {
		// Stryker disable next-line ObjectLiteral,StringLiteral: ekvivalentní mutant, `qrcode` bez volby i s neznámou úrovní kreslí úroveň M, kterou chce SPAYD.
		qr = create(data, { errorCorrectionLevel: 'M' });
	} catch (error) {
		throw new Error('QR platbu nejde vytvořit: údaje se do QR kódu nevejdou.', { cause: error });
	}
	const { size, data: modules } = qr.modules;
	const side = (size + 2 * QUIET_ZONE) * MODULE_PIXELS;
	const pixels = new Uint8Array(side * side).fill(255);
	for (const [i, dark] of modules.entries()) {
		if (!dark) continue;
		const left = (QUIET_ZONE + (i % size)) * MODULE_PIXELS;
		const top = (QUIET_ZONE + Math.floor(i / size)) * MODULE_PIXELS;
		for (const y of MODULE_ROWS) {
			const start = (top + y) * side + left;
			pixels.fill(0, start, start + MODULE_PIXELS);
		}
	}
	return encode({
		width: side,
		height: side,
		data: pixels,
		channels: 1,
		depth: 8,
	});
}
