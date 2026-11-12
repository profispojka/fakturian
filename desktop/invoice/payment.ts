import { encode } from 'fast-png';
// @ts-types="@types/qrcode"
import { create } from 'qrcode';

import { invoiceTotalCents, variableSymbolFor } from '~/utils/invoice';

import type { Invoice } from './model.ts';

const PREFIX_WEIGHTS = [10, 5, 8, 4, 2, 1];
const NUMBER_WEIGHTS = [6, 3, 7, 9, 10, 5, 8, 4, 2, 1];

const MODULE_PIXELS = 8;
const QUIET_ZONE = 4;
const MODULE_ROWS = [...Array.from({ length: MODULE_PIXELS }).keys()];

// Vážený součet čísla účtu podle vyhlášky ČNB. Musí sedět s `isValidBankAccount`
// v `src/utils/validators.ts`: formulář faktury podle něj hlásí, že doklad odejde bez QR.
function weightedMod11(digits: string, weights: readonly number[]): boolean {
	const padded = digits.padStart(weights.length, '0');
	// Stryker disable next-line ArithmeticOperator: ekvivalentní mutant, záporný součet je dělitelný jedenácti právě tehdy, když kladný.
	return weights.reduce((sum, weight, i) => sum + weight * Number(padded[i]), 0) % 11 === 0;
}

export function czechIban(account: string, bankCode: string): string | undefined {
	const bank = bankCode.replace(/\D/g, '');
	if (bank.length !== 4) return undefined;
	const dash = account.indexOf('-');
	const prefix = account.slice(0, Math.max(dash, 0)).replace(/\D/g, '');
	const number = account.slice(dash + 1).replace(/\D/g, '');
	// Nula projde váženým součtem, takže účet z nul by dostal platný IBAN.
	if (number.length < 2 || prefix.length > 6 || number.length > 10 || /^0+$/.test(number)) return undefined;
	if (!weightedMod11(prefix, PREFIX_WEIGHTS) || !weightedMod11(number, NUMBER_WEIGHTS)) return undefined;
	const bban = `${bank}${prefix.padStart(6, '0')}${number.padStart(10, '0')}`;
	// BBAN s kódem země má 26 číslic; tolik jich `number` přesně neunese.
	const check = 98n - (BigInt(`${bban}123500`) % 97n);
	return `CZ${String(check).padStart(2, '0')}${bban}`;
}

// Tvar IBAN podle země z registru SWIFT (stav `iban_validate` 5.0.1). Země mimo registr
// IBAN nemá, takže QR na takový „IBAN“ by mířil na neexistující účet.
const IBAN_FORMATS = new Map([
	['AD', /^AD\d{10}[A-Z\d]{12}$/],
	['AE', /^AE\d{21}$/],
	['AL', /^AL\d{10}[A-Z\d]{16}$/],
	['AT', /^AT\d{18}$/],
	['AZ', /^AZ\d{2}[A-Z]{4}[A-Z\d]{20}$/],
	['BA', /^BA\d{18}$/],
	['BE', /^BE\d{14}$/],
	['BG', /^BG\d{2}[A-Z]{4}\d{6}[A-Z\d]{8}$/],
	['BH', /^BH\d{2}[A-Z]{4}[A-Z\d]{14}$/],
	['BI', /^BI\d{25}$/],
	['BR', /^BR\d{25}[A-Z][A-Z\d]$/],
	['BY', /^BY\d{2}[A-Z\d]{4}\d{4}[A-Z\d]{16}$/],
	['CH', /^CH\d{7}[A-Z\d]{12}$/],
	['CR', /^CR\d{20}$/],
	['CY', /^CY\d{10}[A-Z\d]{16}$/],
	['CZ', /^CZ\d{22}$/],
	['DE', /^DE\d{20}$/],
	['DJ', /^DJ\d{25}$/],
	['DK', /^DK\d{16}$/],
	['DO', /^DO\d{2}[A-Z\d]{4}\d{20}$/],
	['EE', /^EE\d{18}$/],
	['EG', /^EG\d{27}$/],
	['ES', /^ES\d{22}$/],
	['FI', /^FI\d{16}$/],
	['FK', /^FK\d{2}[A-Z]{2}\d{12}$/],
	['FO', /^FO\d{16}$/],
	['FR', /^FR\d{12}[A-Z\d]{11}\d{2}$/],
	['GB', /^GB\d{2}[A-Z]{4}\d{14}$/],
	['GE', /^GE\d{2}[A-Z]{2}\d{16}$/],
	['GI', /^GI\d{2}[A-Z]{4}[A-Z\d]{15}$/],
	['GL', /^GL\d{16}$/],
	['GR', /^GR\d{9}[A-Z\d]{16}$/],
	['GT', /^GT\d{2}[A-Z\d]{24}$/],
	['HR', /^HR\d{19}$/],
	['HU', /^HU\d{26}$/],
	['IE', /^IE\d{2}[A-Z]{4}\d{14}$/],
	['IL', /^IL\d{21}$/],
	['IQ', /^IQ\d{2}[A-Z]{4}\d{15}$/],
	['IS', /^IS\d{24}$/],
	['IT', /^IT\d{2}[A-Z]\d{10}[A-Z\d]{12}$/],
	['JO', /^JO\d{2}[A-Z]{4}\d{4}[A-Z\d]{18}$/],
	['KW', /^KW\d{2}[A-Z]{4}[A-Z\d]{22}$/],
	['KZ', /^KZ\d{5}[A-Z\d]{13}$/],
	['LB', /^LB\d{6}[A-Z\d]{20}$/],
	['LC', /^LC\d{2}[A-Z]{4}[A-Z\d]{24}$/],
	['LI', /^LI\d{7}[A-Z\d]{12}$/],
	['LT', /^LT\d{18}$/],
	['LU', /^LU\d{5}[A-Z\d]{13}$/],
	['LV', /^LV\d{2}[A-Z]{4}[A-Z\d]{13}$/],
	['LY', /^LY\d{23}$/],
	['MC', /^MC\d{12}[A-Z\d]{11}\d{2}$/],
	['MD', /^MD\d{2}[A-Z\d]{20}$/],
	['ME', /^ME\d{20}$/],
	['MK', /^MK\d{5}[A-Z\d]{10}\d{2}$/],
	['MN', /^MN\d{18}$/],
	['MR', /^MR\d{25}$/],
	['MT', /^MT\d{2}[A-Z]{4}\d{5}[A-Z\d]{18}$/],
	['MU', /^MU\d{2}[A-Z]{4}\d{19}[A-Z]{3}$/],
	['NI', /^NI\d{2}[A-Z]{4}\d{20}$/],
	['NL', /^NL\d{2}[A-Z]{4}\d{10}$/],
	['NO', /^NO\d{13}$/],
	['OM', /^OM\d{5}[A-Z\d]{16}$/],
	['PL', /^PL\d{26}$/],
	['PS', /^PS\d{2}[A-Z]{4}[A-Z\d]{21}$/],
	['PT', /^PT\d{23}$/],
	['QA', /^QA\d{2}[A-Z]{4}[A-Z\d]{21}$/],
	['RO', /^RO\d{2}[A-Z]{4}[A-Z\d]{16}$/],
	['RS', /^RS\d{20}$/],
	['RU', /^RU\d{16}[A-Z\d]{15}$/],
	['SA', /^SA\d{4}[A-Z\d]{18}$/],
	['SC', /^SC\d{2}[A-Z]{4}\d{20}[A-Z]{3}$/],
	['SD', /^SD\d{16}$/],
	['SE', /^SE\d{22}$/],
	['SI', /^SI\d{17}$/],
	['SK', /^SK\d{22}$/],
	['SM', /^SM\d{2}[A-Z]\d{10}[A-Z\d]{12}$/],
	['SO', /^SO\d{21}$/],
	['ST', /^ST\d{23}$/],
	['SV', /^SV\d{2}[A-Z]{4}\d{20}$/],
	['TL', /^TL\d{21}$/],
	['TN', /^TN\d{22}$/],
	['TR', /^TR\d{8}[A-Z\d]{16}$/],
	['UA', /^UA\d{8}[A-Z\d]{19}$/],
	['VA', /^VA\d{20}$/],
	['VG', /^VG\d{2}[A-Z]{4}\d{16}$/],
	['XK', /^XK\d{18}$/],
	['YE', /^YE\d{2}[A-Z]{4}\d{4}[A-Z\d]{18}$/],
]);

// Kontrolní součet IBAN (ISO 13616) — bez něj by překlep vyrobil QR na neexistující účet.
function ibanChecksumOk(iban: string): boolean {
	let rest = 0;
	for (const character of `${iban.slice(4)}${iban.slice(0, 4)}`) {
		const value = Number.parseInt(character, 36);
		rest = (rest * (value < 10 ? 10 : 100) + value) % 97;
	}
	return rest === 1;
}

// Variabilní symbol, jak ho uvádí PDF, ISDOC, přehled pro Fio i QR kód: jen číslice, nejvýš 10 (ČNB).
// Syrový řetězec by rozbil kód (`2026*007`) nebo by ho banka odmítla (`F2026-007`).
export function paymentSymbol(invoice: Invoice): string {
	const given = invoice.variableSymbol.trim();
	if (/^\d{1,10}$/.test(given)) return given;
	// Z čísla dokladu, ne z číslic vyplněného VS: ty by u `20260007*ACC:CZ00…9999999999` propašovaly
	// podstrčený účet.
	return variableSymbolFor(invoice.number);
}

// SPAYD pouští v `AM` nejvýš 10 znaků. Od 10 milionů se vejde jen částka bez haléřů, a to bez desetinné
// části; jinak by banka celý kód odmítla.
export function spaydAmount(cents: number): string | undefined {
	const whole = Math.trunc(cents / 100);
	const amount = `${whole}.${String(cents % 100).padStart(2, '0')}`;
	if (amount.length <= 10) return amount;
	if (cents % 100 !== 0 || String(whole).length > 10) return undefined;
	return String(whole);
}

export function buildSpayd(invoice: Invoice): string | undefined {
	const cents = invoiceTotalCents(invoice);
	if (cents <= 0) return undefined;
	const iban = invoice.iban.trim()
		? invoice.iban.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
		: czechIban(invoice.bankAccount, invoice.bankCode);
	if (iban === undefined || !IBAN_FORMATS.get(iban.slice(0, 2))?.test(iban) || !ibanChecksumOk(iban))
		return undefined;
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
