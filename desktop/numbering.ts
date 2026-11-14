// Jen ASCII: `toLowerCase` by srovnal i `Ř` s `ř`. Čísla dokladů se takhle porovnávají všude, protože
// APFS velikost písmen v názvu souboru nerozlišuje.
export function asciiLower(text: string): string {
	let result = '';
	for (let at = 0; at < text.length; at += 1) {
		const code = text.charCodeAt(at);
		result += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : text.charAt(at);
	}
	return result;
}

export const compareNumbers = new Intl.Collator('cs', { numeric: true }).compare;
