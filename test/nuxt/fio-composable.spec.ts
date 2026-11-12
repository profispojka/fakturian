import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFio } from '~/composables/useFio';

import { backend } from '../setup/backend';
import { date } from '../setup/dates';

const TOKEN = 'a'.repeat(64);

const PAYMENT = {
	id: '1000000001',
	amountCents: 121_000,
	vs: '20260012',
	date: '2026-03-01',
	message: 'Faktura 20260012',
};

describe('useFio — token', () => {
	it('zjistí, že token v Keychainu je', async () => {
		backend.fio.token = TOKEN;
		const { hasToken, refreshHasToken } = useFio();

		await refreshHasToken();
		expect(hasToken.value).toBe(true);
	});

	it('chyba klíčenky se neschová za „token není"', async () => {
		backend.fio.keychainFails = true;
		const { hasToken, tokenError, refreshHasToken } = useFio();

		await refreshHasToken();
		expect(hasToken.value).toBe(false);
		expect(tokenError.value).toContain('Klíčenka je nedostupná');
	});

	it('po úspěšném zjištění důvod zmizí', async () => {
		backend.fio.keychainFails = true;
		const { tokenError, refreshHasToken } = useFio();
		await refreshHasToken();
		expect(tokenError.value).not.toBe('');

		backend.fio.keychainFails = false;
		await refreshHasToken();
		expect(tokenError.value).toBe('');
	});

	it('neuložený token nese chybu dál a stav nezvedne', async () => {
		backend.fio.keychainFails = true;
		const { hasToken, setToken } = useFio();

		await expect(setToken(TOKEN)).rejects.toBe('Klíčenka je nedostupná.');
		expect(hasToken.value).toBe(false);
		// Ověřovat stav nemá smysl, když se zápis nepovedl — a klíčenku by to obtěžovalo podruhé.
		expect(backend.args('fio_has_token')).toEqual([]);
	});

	it('nesmazaný token nese chybu dál', async () => {
		backend.fio.token = TOKEN;
		backend.fio.keychainFails = true;

		await expect(useFio().clearToken()).rejects.toBe('Klíčenka je nedostupná.');
	});

	it('uložení tokenu si stav rovnou ověří', async () => {
		const { hasToken, setToken } = useFio();

		await setToken(TOKEN);
		expect(backend.fio.token).toBe(TOKEN);
		expect(hasToken.value).toBe(true);
	});

	it('smazání tokenu stav shodí', async () => {
		backend.fio.token = TOKEN;
		const { hasToken, clearToken } = useFio();

		await clearToken();
		expect(backend.fio.token).toBeNull();
		expect(hasToken.value).toBe(false);
	});
});

describe('useFio — stažení plateb', () => {
	it('bez tokenu vysvětlí, kde ho vložit, a na banku se neptá', async () => {
		await expect(useFio().fetchPayments(date('2026-03-01'), date('2026-03-31'))).rejects.toThrow(
			new Error('Fio token není uložený — vlož ho v Integracích.'),
		);
		expect(backend.args('fio_fetch')).toEqual([]);
	});

	it('chybu čerstvého ověření klíčenky nezamění za chybějící token', async () => {
		backend.fio.keychainFails = true;

		await expect(useFio().fetchPayments(date('2026-03-01'), date('2026-03-31'))).rejects.toThrow(
			new Error('Klíčenka je nedostupná.'),
		);
		expect(backend.args('fio_fetch')).toEqual([]);
	});

	it('vrátí platby v očekávaném tvaru', async () => {
		backend.fio.token = TOKEN;
		backend.fio.movements = [PAYMENT];

		const payments = await useFio().fetchPayments(date('2026-03-01'), date('2026-03-31'));
		expect(
			payments.map((p) => ({
				...p,
				date: String(p.date),
			})),
		).toEqual([PAYMENT]);
		expect(backend.args('fio_fetch')).toEqual([
			{
				from: '2026-03-01',
				to: '2026-03-31',
			},
		]);
	});

	it('prázdný výpis je platná odpověď', async () => {
		backend.fio.token = TOKEN;

		expect(await useFio().fetchPayments(date('2026-03-01'), date('2026-03-31'))).toEqual([]);
	});

	it('platba bez částky nebo VS se odmítne nahlas', async () => {
		backend.fio.token = TOKEN;
		// Rozejití backendu a frontendu — jinak než podstrčenou odpovědí ho nevyrobíš.
		backend.returns('fio_fetch', [
			{
				vs: '20260012',
				date: '2026-03-01',
				message: '',
			},
		]);

		await expect(useFio().fetchPayments(date('2026-03-01'), date('2026-03-31'))).rejects.toThrow(
			new Error(
				'Výpis z Fia má poškozený obsah (0.id: Neplatný vstup: očekáváno řetězec, obdrženo undefined a 0.amountCents: Neplatný vstup: očekáváno číslo, obdrženo undefined).',
			),
		);
	});
});

describe('useFio — limit dotazů banky', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['performance'] });
		backend.fio.token = TOKEN;
	});

	it('druhý dotaz do 30 s na banku nepustí a řekne, kolik zbývá', async () => {
		const { fetchPayments } = useFio();
		await fetchPayments(date('2026-03-01'), date('2026-03-31'));
		vi.advanceTimersByTime(10_000);

		await expect(fetchPayments(date('2026-03-01'), date('2026-03-31'))).rejects.toThrow(
			new Error('Fio dovolí další dotaz až za 20 s.'),
		);
		expect(backend.args('fio_fetch')).toHaveLength(1);
	});

	it('po 30 s se na banku ptá znovu', async () => {
		const { fetchPayments } = useFio();
		await fetchPayments(date('2026-03-01'), date('2026-03-31'));
		vi.advanceTimersByTime(30_000);

		await fetchPayments(date('2026-03-01'), date('2026-03-31'));
		expect(backend.args('fio_fetch')).toHaveLength(2);
	});

	it('nepovedený dotaz další pokus neblokuje', async () => {
		const { fetchPayments } = useFio();
		backend.breaks('fio_fetch', 'Nepodařilo se spojit s Fio (jste offline?).');
		await expect(fetchPayments(date('2026-03-01'), date('2026-03-31'))).rejects.toBe(
			'Nepodařilo se spojit s Fio (jste offline?).',
		);
		backend.repairs('fio_fetch');
		vi.advanceTimersByTime(5_000);

		expect(await fetchPayments(date('2026-03-01'), date('2026-03-31'))).toEqual([]);
		expect(backend.args('fio_fetch')).toHaveLength(2);
	});

	it('nový token čeká od nuly', async () => {
		const { fetchPayments, setToken } = useFio();
		await fetchPayments(date('2026-03-01'), date('2026-03-31'));

		await setToken('b'.repeat(64));
		await fetchPayments(date('2026-03-01'), date('2026-03-31'));
		expect(backend.args('fio_fetch')).toHaveLength(2);
	});
});
