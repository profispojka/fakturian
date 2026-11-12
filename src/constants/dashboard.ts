export const DUE_SOON_DAYS = 7;
export const RECENT_INVOICES = 5;

// Kolik období ukazuje graf tržeb v každém rozsahu.
export const SERIES_MONTHS = 12;
export const SERIES_QUARTERS = 8;
export const SERIES_YEARS = 10;

const VAT_LIMIT = 2_000_000;
const VAT_LIMIT_IMMEDIATE = 2_536_500;
export const VAT_LIMIT_CENTS = VAT_LIMIT * 100;
export const VAT_LIMIT_IMMEDIATE_CENTS = VAT_LIMIT_IMMEDIATE * 100;

// Podíl obratu na limitu, od kterého Přehled limit DPH zbarví.
export const VAT_WARN_RATIO = 0.7;
export const VAT_DANGER_RATIO = 0.9;
