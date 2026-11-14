import { z } from 'zod';

import { parseDate, parseIsdocDate } from '~/utils/date';
import { isAsciiAlphaNumeric, withoutWhitespace } from '~/utils/strings';
import { isValidBankAccount, isValidBankCode, isValidIco, isValidZip } from '~/utils/validators';

export function asciiAlphaNumeric(message: string) {
	return z.string().refine((value) => value.length > 0 && isAsciiAlphaNumeric(value), {
		error: message,
		abort: true,
	});
}

export function dateString() {
	return z.string('Povinné pole.').transform((text, ctx) => {
		const date = parseDate(text);
		if (date) return date;
		ctx.addIssue({
			code: 'custom',
			message: 'Datum musí být ve tvaru RRRR-MM-DD.',
			input: text,
		});
		return z.NEVER;
	});
}

export function isdocDate() {
	return z.string('Povinné pole.').transform((text, ctx) => {
		const date = parseIsdocDate(text);
		if (date) return date;
		ctx.addIssue({
			code: 'custom',
			message: 'Datum musí být ve tvaru RRRR-MM-DD.',
			input: text,
		});
		return z.NEVER;
	});
}

export function isdocDateOrBlank() {
	return z
		.string()
		.transform((text) => text.trim() || undefined)
		.pipe(isdocDate().optional());
}

// `abort`: prázdné pole je jen povinné, ne k tomu ještě vadný formát.
export function ico() {
	return z
		.string()
		.refine((value) => value.trim() !== '', {
			error: 'Povinné pole.',
			abort: true,
		})
		.refine(isValidIco, 'Neplatné IČO (8 číslic).');
}

export function zip() {
	return z
		.string()
		.transform(withoutWhitespace)
		.refine((value) => value.trim() !== '', {
			error: 'Povinné pole.',
			abort: true,
		})
		.refine(isValidZip, 'PSČ má 5 číslic.');
}

export function bankAccount() {
	return z
		.string()
		.transform(withoutWhitespace)
		.refine((value) => value.trim() !== '', {
			error: 'Povinné pole.',
			abort: true,
		})
		.refine(isValidBankAccount, 'Neplatné číslo účtu, např. 19-2000145399.');
}

export function bankCode() {
	return z
		.string()
		.transform(withoutWhitespace)
		.refine((value) => value.trim() !== '', {
			error: 'Povinné pole.',
			abort: true,
		})
		.refine(isValidBankCode, 'Kód banky má 4 číslice.');
}
