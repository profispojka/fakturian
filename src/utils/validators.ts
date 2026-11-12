import { zeroPadded } from '~/utils/locales';

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, '');

export function isValidIco(ico: string | undefined): boolean {
	const v = clean(ico);
	if (!/^\d{8}$/.test(v)) return false;
	const weights = [8, 7, 6, 5, 4, 3, 2];
	const sum = weights.reduce((s, w, i) => s + w * Number(v[i]), 0);
	const mod = sum % 11;
	let check = 11 - mod;
	if (mod === 0) check = 1;
	if (mod === 1) check = 0;
	return check === Number(v[7]);
}

export function isValidDic(dic: string | undefined): boolean {
	return /^CZ\d{8,10}$/.test(clean(dic).toUpperCase());
}

export function isValidZip(zip: string | undefined): boolean {
	return /^\d{5}$/.test(clean(zip));
}

export function isValidBankCode(code: string | undefined): boolean {
	return /^\d{4}$/.test(clean(code));
}

function weightedMod11(digits: string, weights: number[]): boolean {
	const padded = zeroPadded(Number(digits), weights.length);
	const sum = weights.reduce((s, w, i) => s + w * Number(padded[i]), 0);
	return sum % 11 === 0;
}

export function isValidBankAccount(acc: string | undefined): boolean {
	const v = clean(acc);
	const match = /^(?:(\d{1,6})-)?(\d{2,10})$/.exec(v);
	if (!match) return false;
	const [, prefix, main = ''] = match;
	// Nula je dělitelná jedenácti, takže samotný vážený součet účet z nul pustí.
	if (Number(main) === 0) return false;
	if (prefix && !weightedMod11(prefix, [10, 5, 8, 4, 2, 1])) return false;
	return weightedMod11(main, [6, 3, 7, 9, 10, 5, 8, 4, 2, 1]);
}

// Český IBAN je `CZ`, dvě kontrolní číslice, kód banky, předčíslí na šest míst a číslo účtu na deset.
// QR platba dává IBAN přednost před číslem účtu, takže cizí IBAN by platbu poslal jinam.
export function ibanMatchesAccount(iban: string, account: string, bankCode: string): boolean {
	const match = /^(?:(\d{1,6})-)?(\d{2,10})$/.exec(clean(account));
	if (!match) return false;
	const [, prefix = '', main = ''] = match;
	const expected = `${clean(bankCode)}${zeroPadded(Number(prefix), 6)}${zeroPadded(Number(main), 10)}`;
	const written = clean(iban).toUpperCase();
	return written.startsWith('CZ') && written.slice(4) === expected;
}
