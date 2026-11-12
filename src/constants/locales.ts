export const LOCALE = 'cs';

export interface CzechPluralForms {
	one: string;
	few: string;
	many: string;
	other: string;
}

type CzechGender = 'inanimate' | 'animate' | 'feminine';

interface CzechCountForms extends CzechPluralForms {
	gender: CzechGender;
	outOfOne: string;
	outOfOther: string;
}

// Od pěti výš (a u nuly) stojí sloveso ve středním rodě jednotného čísla: „bylo převzato 5 dokladů".
export const PARTICIPLE_ENDINGS: Record<CzechGender, CzechPluralForms> = {
	inanimate: {
		one: '',
		few: 'y',
		many: 'o',
		other: 'o',
	},
	animate: {
		one: '',
		few: 'i',
		many: 'o',
		other: 'o',
	},
	feminine: {
		one: 'a',
		few: 'y',
		many: 'o',
		other: 'o',
	},
};

export const FURTHER_FORMS: CzechPluralForms = {
	one: 'další',
	few: 'další',
	many: 'dalších',
	other: 'dalších',
};

export const WEEK_FORMS: CzechPluralForms = {
	one: 'týden',
	few: 'týdny',
	many: 'týdne',
	other: 'týdnů',
};

export const LOOKS_LIKE_FORMS: CzechPluralForms = {
	one: 'který vypadá',
	few: 'které vypadají',
	many: 'které vypadají',
	other: 'které vypadají',
};

export const COUNT_FORMS = {
	document: {
		gender: 'inanimate',
		one: 'doklad',
		few: 'doklady',
		many: 'dokladu',
		other: 'dokladů',
		outOfOne: 'dokladu',
		outOfOther: 'dokladů',
	},
	customer: {
		gender: 'animate',
		one: 'odběratel',
		few: 'odběratelé',
		many: 'odběratele',
		other: 'odběratelů',
		outOfOne: 'odběratele',
		outOfOther: 'odběratelů',
	},
	expense: {
		gender: 'inanimate',
		one: 'výdaj',
		few: 'výdaje',
		many: 'výdaje',
		other: 'výdajů',
		outOfOne: 'výdaje',
		outOfOther: 'výdajů',
	},
	file: {
		gender: 'inanimate',
		one: 'soubor',
		few: 'soubory',
		many: 'souboru',
		other: 'souborů',
		outOfOne: 'souboru',
		outOfOther: 'souborů',
	},
	item: {
		gender: 'feminine',
		one: 'položka',
		few: 'položky',
		many: 'položky',
		other: 'položek',
		outOfOne: 'položky',
		outOfOther: 'položek',
	},
	invoice: {
		gender: 'feminine',
		one: 'faktura',
		few: 'faktury',
		many: 'faktury',
		other: 'faktur',
		outOfOne: 'faktury',
		outOfOther: 'faktur',
	},
} satisfies Record<string, CzechCountForms>;
