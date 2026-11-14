import { describe, expect, it } from 'vitest';

import { useAres } from '~/composables/useAres';

import { backend } from '../setup/backend';

const COMPANY = {
	name: 'Jan Novák',
	ico: '25596641',
	dic: 'CZ25596641',
	address: {
		street: 'Dlouhá 1',
		city: 'Praha',
		zip: '11000',
	},
	tradeLicensed: true,
};

const FOUND = {
	name: 'Jan Novák',
	ico: '25596641',
	dic: 'CZ25596641',
	address: {
		street: 'Dlouhá 1',
		city: 'Praha',
		zip: '11000',
	},
	registration: 'Zapsáno v živnostenském rejstříku',
};

describe('useAres', () => {
	it('dotáhne firmu podle IČO', async () => {
		backend.ares.write(COMPANY);
		const { lookup, error, loading } = useAres();

		expect(await lookup('25596641')).toEqual(FOUND);
		expect(error.value).toBe('');
		expect(loading.value).toBe(false);
	});

	it('IČO zbaví mezer a zeptá se hlavního procesu', async () => {
		backend.ares.write(COMPANY);

		expect(await useAres().lookup('  255 96 641  ')).toEqual(FOUND);
		expect(backend.args('ares_subject')).toEqual([{ ico: '25596641' }]);
	});

	it('prázdné IČO se ptát nejde a řekne proč', async () => {
		const { lookup, error } = useAres();

		expect(await lookup('   ')).toBeNull();
		expect(error.value).toBe('Zadej nejdřív IČO.');
		expect(backend.args('ares_subject')).toEqual([]);
	});

	it.each(['1234567', '25596642', '2559664a'])('neplatné IČO %s na síť nejde', async (ico) => {
		const { lookup, error } = useAres();

		expect(await lookup(ico)).toBeNull();
		expect(error.value).toBe('Neplatné IČO (8 číslic).');
		expect(backend.args('ares_subject')).toEqual([]);
	});

	it('neznámé IČO skončí hláškou, ne výjimkou', async () => {
		const { lookup, error } = useAres();

		expect(await lookup('25596641')).toBeNull();
		expect(error.value).toBe('Firma s tímto IČO nebyla v ARES nalezena.');
	});

	it('chybu rejstříku předá beze změny', async () => {
		backend.fails('ares_subject', 'ARES vrátil chybu 503.');
		const { lookup, error } = useAres();

		expect(await lookup('25596641')).toBeNull();
		expect(error.value).toBe('ARES vrátil chybu 503.');
	});

	it('nedostupný ARES skončí v `error`, ne výjimkou', async () => {
		backend.ares.write(COMPANY);
		backend.ares.unavailable = true;
		const { lookup, error, loading } = useAres();

		expect(await lookup('25596641')).toBeNull();
		expect(error.value).toBe('Nepodařilo se spojit s ARES (jste offline?).');
		expect(loading.value).toBe(false);
	});

	it('odpověď v neznámém tvaru odmítne celou', async () => {
		backend.ares.writeLiteral('25596641', 'Service Unavailable');
		const { lookup, error } = useAres();

		expect(await lookup('25596641')).toBeNull();
		expect(error.value).toMatch(/^Odpověď z ARES má neočekávaný tvar \(/);
	});

	it('odpověď bez názvu firmy skončí hláškou, ne prázdnou firmou', async () => {
		backend.ares.writeLiteral('25596641', { name: 'Acme' });
		const { lookup, error } = useAres();

		expect(await lookup('25596641')).toBeNull();
		expect(error.value).toBe('ARES k tomuto IČO nevrátil název firmy, údaje doplň ručně.');
	});

	it('předchozí chyba se novým dotazem smaže', async () => {
		backend.ares.write(COMPANY);
		backend.ares.unavailable = true;
		const { lookup, error } = useAres();

		await lookup('25596641');
		expect(error.value).not.toBe('');

		backend.ares.unavailable = false;
		expect(await lookup('25596641')).toEqual(FOUND);
		expect(error.value).toBe('');
	});
});

describe('prázdné IČO', () => {
	it('bez IČO se na ARES neptá', async () => {
		const { lookup, error } = useAres();

		expect(await lookup(' ')).toBeNull();
		expect(error.value).toBe('Zadej nejdřív IČO.');
	});
});
