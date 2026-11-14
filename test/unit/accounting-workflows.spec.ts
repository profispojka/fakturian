import { describe, expect, it } from 'vitest';

import { newContactsFromImport } from '~/utils/import';

describe('kontakty z importu', () => {
	const blank = {
		dic: '',
		address: {
			street: '',
			city: '',
			zip: '',
		},
		email: '',
	};
	const complete = {
		dic: '',
		address: {
			street: 'Dlouhá 1',
			city: 'Praha',
			zip: '11000',
		},
		email: 'beta@example.cz',
	};

	it('duplicitu pozná podle IČO a bez IČO podle normalizovaného názvu', () => {
		const existing = [
			{
				id: 'ico',
				name: 'Starý název',
				ico: '25596641',
				address: {
					street: '',
					city: '',
					zip: '',
				},
			},
			{
				id: 'name',
				name: '  Studio ÁLFA ',
				ico: '27082440',
				address: {
					street: '',
					city: '',
					zip: '',
				},
			},
		];
		const imported = [
			{
				name: 'Nový název',
				ico: '25596641',
				...blank,
			},
			{
				name: ' studio ALFA ',
				ico: '',
				...blank,
			},
			{
				name: 'Beta',
				ico: '28456785',
				...complete,
			},
		];

		const { contacts, refused } = newContactsFromImport(existing, imported);
		expect(refused).toEqual([]);
		expect(contacts).toEqual([
			{
				id: contacts[0]!.id,
				name: 'Beta',
				ico: '28456785',
				dic: undefined,
				address: {
					street: 'Dlouhá 1',
					city: 'Praha',
					zip: '11000',
				},
				email: 'beta@example.cz',
			},
		]);
	});

	it('bez IČO vynechá jen odběratele se stejným názvem, jiný dojde ke kontrole', () => {
		const existing = [
			{
				id: 'name',
				name: 'Studio Alfa',
				ico: '27082440',
				address: {
					street: '',
					city: '',
					zip: '',
				},
			},
		];
		const imported = [
			{
				name: 'studio ALFA',
				ico: '',
				...complete,
			},
			{
				name: 'Gama',
				ico: '',
				...complete,
			},
		];

		const { contacts, refused } = newContactsFromImport(existing, imported);

		expect(contacts).toEqual([]);
		expect(refused.map((customer) => customer.name)).toEqual(['Gama']);
	});

	it('shodné IČO vynechá a jiné IČO zachová', () => {
		const existing = [
			{
				id: 'a',
				name: 'Acme',
				ico: '25596641',
				address: {
					street: '',
					city: '',
					zip: '',
				},
			},
		];
		const base = {
			name: 'Acme',
			...complete,
		};
		expect(
			newContactsFromImport(existing, [
				{
					...base,
					ico: '25596641',
				},
			]),
		).toEqual({
			contacts: [],
			refused: [],
		});
		expect(
			newContactsFromImport(existing, [
				{
					...base,
					ico: '28456785',
				},
			]).contacts,
		).toHaveLength(1);
	});

	it('nový odběratel bez povinného údaje se nezaloží', () => {
		expect(
			newContactsFromImport(
				[],
				[
					{
						name: 'Gama',
						ico: '',
						...complete,
					},
				],
			),
		).toEqual({
			contacts: [],
			refused: [
				{
					name: 'Gama',
					reason: 'ico: Povinné pole.',
				},
			],
		});
	});
});
