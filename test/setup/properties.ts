import { configureGlobal } from 'fast-check';

// Pevný seed: Stryker i opakovaný běh vidí stejné vstupy. Hlubší běh pustí `FAKTURIAN_PROPTEST_CASES`.
const cases = process.env.FAKTURIAN_PROPTEST_CASES;
const numRuns = cases === undefined ? 256 : Number(cases);
if (!Number.isInteger(numRuns) || numRuns <= 0) throw new Error('FAKTURIAN_PROPTEST_CASES musí být kladné celé číslo.');

configureGlobal({
	seed: 202_609,
	numRuns,
});
