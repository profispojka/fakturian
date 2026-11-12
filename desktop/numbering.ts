import { compareText } from './util.ts';

const RUNS = /\d+|\D+/g;
// Běh je celý z číslic, nebo bez nich, takže stačí jedna.
const DIGITS = /\d/;

// Jen ASCII: `toLowerCase` by srovnal i `Ř` s `ř`. Čísla dokladů se takhle porovnávají všude, protože
// APFS velikost písmen v názvu souboru nerozlišuje.
export function asciiLower(text: string): string {
	return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

// Běh číslic se porovná jako číslo, takže `F2026-9` je před `F2026-10`. Stejně řadí výpis faktur přes
// `localeCompare(…, { numeric: true })`.
export function compareNumbers(a: string, b: string): number {
	const left = a.match(RUNS) ?? [];
	const right = b.match(RUNS) ?? [];
	for (const [i, x] of left.entries()) {
		const y = right[i];
		if (y === undefined) return 1;
		let run = compareText(asciiLower(x), asciiLower(y));
		if (DIGITS.test(x) && DIGITS.test(y)) {
			const p = x.replace(/^0+/, '');
			const q = y.replace(/^0+/, '');
			run = Math.sign(p.length - q.length) || compareText(p, q);
		}
		if (run !== 0) return run;
	}
	if (left.length < right.length) return -1;
	return compareText(a, b);
}
