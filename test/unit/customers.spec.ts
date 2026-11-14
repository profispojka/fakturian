import { describe, expect, it } from 'vitest';

import { contactSchema, contactStoredSchema, emptyContact } from '~/schemas/customers';

describe('výchozí odběratel', () => {
	it('vytváří samostatné modely s vlastní identitou', () => {
		const first = emptyContact();
		const second = emptyContact();
		expect(first.id).not.toBe(second.id);
		expect(first.id).not.toBe('');
		expect(first).toEqual({
			id: first.id,
			name: '',
			ico: '',
			address: {
				street: '',
				city: '',
				zip: '',
			},
		});
		first.address.city = 'Praha';
		expect(second.address.city).toBe('');
	});
});

describe('uložený odběratel', () => {
	const full = () => ({
		id: 'c',
		name: 'Firma',
		ico: '27082440',
		dic: 'CZ27082440',
		address: {
			street: 'Dlouhá 1',
			city: 'Praha',
			zip: '11000',
			patro: '3.',
		},
		email: 'fakturace@firma.cz',
		note: 'poznámka',
		vlastni: 'klíč uživatele',
	});

	it('úplný záznam načte celý i s klíči, které si uživatel dopsal', () => {
		expect(contactStoredSchema.parse(full())).toEqual(full());
	});
	it.each([
		{ id: undefined },
		{ ico: undefined },
		{ ico: '' },
		{ ico: '12345678' },
		{ email: 'rozepsáno' },
		{
			address: {
				street: '',
				city: 'Praha',
				zip: '11000',
			},
		},
	])('odmítá neúplný nebo poškozený záznam %j', (change) => {
		expect(
			contactStoredSchema.safeParse({
				...full(),
				...change,
			}).success,
		).toBe(false);
	});
});

describe('formulář odběratele', () => {
	const complete = () => ({
		name: 'Firma',
		ico: '27082440',
		address: {
			street: 'Dlouhá 1',
			city: 'Praha',
			zip: '110 00',
		},
	});

	it('úplný odběratel projde i bez DIČ a bez e-mailu', () => {
		expect(contactSchema.safeParse(complete()).success).toBe(true);
		expect(
			contactSchema.safeParse({
				...complete(),
				dic: 'CZ27082440',
				email: 'fakturace@firma.cz',
			}).success,
		).toBe(true);
	});
	it('hlásí každý nevyplněný údaj zvlášť', () => {
		const result = contactSchema.safeParse({
			name: '',
			ico: ' ',
			address: {
				street: '',
				city: '',
				zip: '',
			},
		});
		expect(result.error?.issues.map((issue) => issue.path)).toEqual([
			['name'],
			['ico'],
			['address', 'street'],
			['address', 'city'],
			['address', 'zip'],
		]);
	});
	it.each([
		[{ name: '   ' }, ['name'], 'Povinné pole.'],
		[{ ico: '123' }, ['ico'], 'Neplatné IČO (8 číslic).'],
		[{ dic: 'xx' }, ['dic'], 'DIČ má tvar „CZ12345678".'],
		[
			{
				address: {
					street: 'Dlouhá 1',
					city: 'Praha',
					zip: 'x',
				},
			},
			['address', 'zip'],
			'PSČ má 5 číslic.',
		],
		[
			{
				address: {
					street: ' ',
					city: 'Praha',
					zip: '11000',
				},
			},
			['address', 'street'],
			'Povinné pole.',
		],
		[
			{
				address: {
					street: 'Dlouhá 1',
					city: ' ',
					zip: '11000',
				},
			},
			['address', 'city'],
			'Povinné pole.',
		],
		[{ email: 'x' }, ['email'], 'Neplatný e-mail.'],
		// Formulář i import převádějí prázdné pole na `undefined`, prázdný řetězec je vadná hodnota.
		[{ email: '' }, ['email'], 'Neplatný e-mail.'],
		[{ dic: '' }, ['dic'], 'DIČ má tvar „CZ12345678".'],
	])('hlásí konkrétní pole pro %j', (change, path, message) => {
		const result = contactSchema.safeParse({
			...complete(),
			...change,
		});
		expect(result.success).toBe(false);
		expect(
			result.error?.issues.map((issue) => ({
				path: issue.path,
				message: issue.message,
			})),
		).toEqual([
			{
				path,
				message,
			},
		]);
	});
});
