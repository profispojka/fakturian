import { COUNT_FORMS, LOCALE, PARTICIPLE_ENDINGS, type CzechPluralForms } from '~/constants/locales';

const CZECH_PLURAL = new Intl.PluralRules(LOCALE);

export const czechList = new Intl.ListFormat(LOCALE);

export const czechPercent = new Intl.NumberFormat(LOCALE, {
	// Stryker disable next-line StringLiteral: Neplatný `style` hodí RangeError už při importu, takže se nespustí žádný test a runner nemá co započítat; hodnotu hlídá aserce v `test/plural.spec.ts`.
	style: 'percent',
	maximumFractionDigits: 0,
});

const COUNT = new Intl.NumberFormat(LOCALE);

export function zeroPadded(value: number, width: number): string {
	const formatter = new Intl.NumberFormat(LOCALE, {
		minimumIntegerDigits: width,
		useGrouping: false,
	});
	return formatter.format(value);
}

export function czechPlural(value: number, forms: CzechPluralForms): string {
	// `select()` je typovaný na všechny kategorie CLDR, čeština ale `zero` ani `two` nemá.
	const byCategory: Record<Intl.LDMLPluralRule, string> = {
		zero: forms.other,
		two: forms.other,
		...forms,
	};
	return byCategory[CZECH_PLURAL.select(value)];
}

export function formatCount(count: number, noun: keyof typeof COUNT_FORMS): string {
	return `${COUNT.format(count)} ${czechPlural(count, COUNT_FORMS[noun])}`;
}

// `participle` je kmen příčestí bez koncovky („převzat", „přidán"); koncovku dostane i „byl".
export function formatPassiveCount(count: number, noun: keyof typeof COUNT_FORMS, participle: string): string {
	const ending = czechPlural(count, PARTICIPLE_ENDINGS[COUNT_FORMS[noun].gender]);
	return `byl${ending} ${participle}${ending} ${formatCount(count, noun)}`;
}

export function czechSentence(clauses: string[]): string {
	const text = czechList.format(clauses);
	return `${text.charAt(0).toLocaleUpperCase(LOCALE)}${text.slice(1)}.`;
}

export function formatCountOutOf(count: number, total: number, noun: keyof typeof COUNT_FORMS): string {
	const forms = COUNT_FORMS[noun];
	let form = forms.outOfOther;
	if (total === 1) form = forms.outOfOne;
	return `${COUNT.format(count)} z ${COUNT.format(total)} ${form}`;
}
