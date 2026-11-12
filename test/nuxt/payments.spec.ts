import { beforeEach, describe, expect, it } from 'vitest';

import { usePayments } from '~/composables/usePayments';

import { backend } from '../setup/backend';
import { date } from '../setup/dates';
import { prepareVault, saved, writes } from '../setup/vault';

beforeEach(async () => {
	await prepareVault();
});

describe('usePayments', () => {
	it('zapíše platbu i s datem tak, aby přežila restart', async () => {
		const { payments, record } = useNuxtApp().vueApp.runWithContext(usePayments);

		await record([
			{
				number: '20260001',
				payment: {
					id: 'p1',
					date: date('2026-03-01'),
					amountCents: 40_000,
				},
			},
		]);

		expect(payments.value['20260001']).toEqual([
			{
				id: 'p1',
				date: '2026-03-01',
				amountCents: 40_000,
			},
		]);
		expect(saved('platby.json').payments).toEqual({
			'20260001': [
				{
					id: 'p1',
					date: '2026-03-01',
					amountCents: 40_000,
				},
			],
		});
	});

	it('další platba se k dokladu přidá, předchozí nepřepíše', async () => {
		const { payments, record } = useNuxtApp().vueApp.runWithContext(usePayments);
		await record([
			{
				number: '20260001',
				payment: {
					id: 'p1',
					date: date('2026-03-01'),
					amountCents: 40_000,
				},
			},
		]);

		await record([
			{
				number: '20260001',
				payment: {
					id: 'p2',
					date: date('2026-03-05'),
					amountCents: 60_000,
					fioId: 'm2',
				},
			},
		]);

		expect(payments.value['20260001']).toEqual([
			{
				id: 'p1',
				date: '2026-03-01',
				amountCents: 40_000,
			},
			{
				id: 'p2',
				date: '2026-03-05',
				amountCents: 60_000,
				fioId: 'm2',
			},
		]);
	});

	it('dávku zapíše jedním zápisem', async () => {
		const { payments, record } = useNuxtApp().vueApp.runWithContext(usePayments);

		await record([
			{
				number: '20260001',
				payment: {
					id: 'p1',
					date: date('2026-03-01'),
					amountCents: 100,
				},
			},
			{
				number: '20260002',
				payment: {
					id: 'p2',
					date: date('2026-03-02'),
					amountCents: 200,
				},
			},
			{
				number: '20260001',
				payment: {
					id: 'p3',
					date: date('2026-03-03'),
					amountCents: 300,
				},
			},
		]);

		expect(payments.value['20260001']?.map((p) => p.amountCents)).toEqual([100, 300]);
		expect(payments.value['20260002']?.map((p) => p.amountCents)).toEqual([200]);
		expect(writes('platby.json')).toBe(1);
	});

	it('prázdná dávka vault nezapisuje', async () => {
		await useNuxtApp().vueApp.runWithContext(usePayments).record([]);

		expect(writes('platby.json')).toBe(0);
	});

	it('smaže vybranou platbu a ostatní nechá', async () => {
		const { payments, record, remove } = useNuxtApp().vueApp.runWithContext(usePayments);
		await record([
			{
				number: '20260001',
				payment: {
					id: 'p1',
					date: date('2026-03-01'),
					amountCents: 100,
				},
			},
			{
				number: '20260001',
				payment: {
					id: 'p2',
					date: date('2026-03-02'),
					amountCents: 200,
				},
			},
		]);

		await remove('20260001', 'p1');

		expect(payments.value['20260001']).toEqual([
			{
				id: 'p2',
				date: '2026-03-02',
				amountCents: 200,
			},
		]);
		expect(saved('platby.json').payments).toEqual({
			'20260001': [
				{
					id: 'p2',
					date: '2026-03-02',
					amountCents: 200,
				},
			],
		});
	});

	it('s poslední smazanou platbou zmizí z evidence i doklad', async () => {
		const { payments, record, remove } = useNuxtApp().vueApp.runWithContext(usePayments);
		await record([
			{
				number: '20260001',
				payment: {
					id: 'p1',
					date: date('2026-03-01'),
					amountCents: 100,
				},
			},
			{
				number: '20260002',
				payment: {
					id: 'p2',
					date: date('2026-03-01'),
					amountCents: 200,
				},
			},
		]);

		await remove('20260001', 'p1');

		expect(payments.value).toEqual({
			'20260002': [
				{
					id: 'p2',
					date: '2026-03-01',
					amountCents: 200,
				},
			],
		});
	});

	it('ze dvou shodných ručních plateb smaže jen tu vybranou', async () => {
		const { payments, record, remove } = useNuxtApp().vueApp.runWithContext(usePayments);
		await record([
			{
				number: '20260001',
				payment: {
					id: 'p1',
					date: date('2026-03-02'),
					amountCents: 200,
				},
			},
			{
				number: '20260001',
				payment: {
					id: 'p2',
					date: date('2026-03-02'),
					amountCents: 200,
				},
			},
		]);

		await remove('20260001', 'p2');

		expect(payments.value['20260001']).toEqual([
			{
				id: 'p1',
				date: '2026-03-02',
				amountCents: 200,
			},
		]);
	});

	it('smazání u dokladu bez plateb ostatní doklady nechá', async () => {
		const { payments, record, remove } = useNuxtApp().vueApp.runWithContext(usePayments);
		await record([
			{
				number: '20260002',
				payment: {
					id: 'p1',
					date: date('2026-03-01'),
					amountCents: 200,
				},
			},
		]);

		await remove('20260001', 'p1');

		expect(payments.value).toEqual({
			'20260002': [
				{
					id: 'p1',
					date: '2026-03-01',
					amountCents: 200,
				},
			],
		});
	});

	it('zapomene platby znovu vydaného čísla a ostatní nechá', async () => {
		const { payments, record, forget } = useNuxtApp().vueApp.runWithContext(usePayments);
		await record([
			{
				number: '20260001',
				payment: {
					id: 'p1',
					date: date('2026-03-01'),
					amountCents: 100,
				},
			},
			{
				number: '20260002',
				payment: {
					id: 'p2',
					date: date('2026-03-01'),
					amountCents: 200,
				},
			},
		]);

		await forget(['20260001', '20269999']);

		expect(payments.value).toEqual({
			'20260002': [
				{
					id: 'p2',
					date: '2026-03-01',
					amountCents: 200,
				},
			],
		});
		expect(saved('platby.json').payments).toEqual(payments.value);
		expect(writes('platby.json')).toBe(2);
	});

	it('bez plateb k zapomenutí vault nezapisuje', async () => {
		await useNuxtApp().vueApp.runWithContext(usePayments).forget(['20260001']);

		expect(writes('platby.json')).toBe(0);
	});

	it('neúspěšný zápis propaguje chybu a paměť vrátí k obsahu souboru', async () => {
		const { payments, record, remove, forget } = useNuxtApp().vueApp.runWithContext(usePayments);
		await record([
			{
				number: '20260001',
				payment: {
					id: 'p1',
					date: date('2026-03-01'),
					amountCents: 100,
				},
			},
		]);
		backend.breaks('write_data_file', 'Disk je plný');

		await expect(
			record([
				{
					number: '20260002',
					payment: {
						id: 'p2',
						date: date('2026-03-01'),
						amountCents: 200,
					},
				},
			]),
		).rejects.toBe('Disk je plný');
		await expect(remove('20260001', 'p1')).rejects.toBe('Disk je plný');
		await expect(forget(['20260001'])).rejects.toBe('Disk je plný');

		expect(payments.value).toEqual({
			'20260001': [
				{
					id: 'p1',
					date: '2026-03-01',
					amountCents: 100,
				},
			],
		});
		expect(saved('platby.json').payments).toEqual({
			'20260001': [
				{
					id: 'p1',
					date: '2026-03-01',
					amountCents: 100,
				},
			],
		});
	});

	it('načte platby, které ve složce už ležely', async () => {
		await prepareVault({
			'platby.json': {
				payments: {
					'20250099': [
						{
							id: 'p1',
							date: '2025-12-01',
							amountCents: 5_000,
							fioId: '77',
						},
					],
				},
			},
		});

		expect(useNuxtApp().vueApp.runWithContext(usePayments).payments.value['20250099']).toEqual([
			{
				id: 'p1',
				date: '2025-12-01',
				amountCents: 5_000,
				fioId: '77',
			},
		]);
	});
});
