// Jen ASCII: `toLowerCase` by srovnal i `Ř` s `ř`. Čísla dokladů se takhle porovnávají všude, protože
// APFS velikost písmen v názvu souboru nerozlišuje.
export function asciiLower(text: string): string {
	return text.replace(/[A-Z]+/g, (upper) => upper.toLowerCase());
}

export const compareNumbers = new Intl.Collator('cs', { numeric: true }).compare;
