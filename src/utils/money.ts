import BigDecimal from 'big.js';

import { MAX_CENTS } from '~/bindings';
import { LOCALE } from '~/constants/locales';

// Model drží peníze v celých haléřích. Množství zůstává desetinné, takže se zaokrouhluje součin, ne
// cena.

/** Zaokrouhlení od nuly — ne k +∞: `Math.round(-0.5)` je v JS `-0`. */
export function roundCents(raw: number): number {
	if (!Number.isFinite(raw)) return 0;
	const rounded = Math.sign(raw) * Math.round(Math.abs(raw));
	const capped = Math.min(MAX_CENTS, Math.max(-MAX_CENTS, rounded));
	// Zlomek haléře pod nulou by dal `-0` a to by přes `MoneyInput` doputovalo do modelu.
	if (capped === 0) return 0;
	return capped;
}

// Počítá i backend (projekce cizího ISDOC); případy drží `money-parity.json`. `big.js` násobí z desetinného
// zápisu čísla, takže `1.005 × 100` dá přesně 100,5 — v plovoucí čárce 100,4999… a haléř by se ztratil.
export function lineCents(quantity: number, unitPriceCents: number): number {
	// `big.js` z `NaN`, nekonečna i `undefined` vymazaného pole hodí.
	if (!Number.isFinite(quantity) || !Number.isFinite(unitPriceCents)) return 0;
	const cents = new BigDecimal(quantity).times(unitPriceCents).round(0, BigDecimal.roundHalfUp).toNumber();
	const capped = Math.min(MAX_CENTS, Math.max(-MAX_CENTS, cents));
	// Nulová cena u záporného množství by vrátila `-0`.
	if (capped === 0) return 0;
	return capped;
}

// `signDisplay: 'negative'`: `czkWhole` zaokrouhlí `-0,4` na `-0` a bez toho by vypsal `-0 Kč`.
const CZK_OPTIONS = {
	style: 'currency',
	currency: 'CZK',
	signDisplay: 'negative',
} as const;

const czk = new Intl.NumberFormat(LOCALE, CZK_OPTIONS);

// Měna má výchozí minimum dvě desetinná místa a starší engine na nižší maximum bez minima hodí RangeError.
const czkWhole = new Intl.NumberFormat(LOCALE, {
	...CZK_OPTIONS,
	minimumFractionDigits: 0,
	maximumFractionDigits: 0,
});

export function czkFromCents(cents: number): string {
	return czk.format(roundCents(cents) / 100);
}

export function czkWholeFromCents(cents: number): string {
	return czkWhole.format(roundCents(cents) / 100);
}
