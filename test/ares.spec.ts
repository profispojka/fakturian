import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TRADE_REGISTER_ENTRY } from '~/constants/registration';
import { aresServices, parseAres } from '~/services/ares';

import aresSro from './fixtures/ares-sro.json' with { type: 'json' };
import aresTradesman from './fixtures/ares-zivnostnik.json' with { type: 'json' };

const invoke = vi.fn();
vi.stubGlobal('fakturian', {
	invoke,
});
beforeEach(() => {
	invoke.mockReset();
});

const EMPTY = {
	name: '',
	ico: '',
	address: {
		street: '',
		city: '',
		zip: '',
	},
	registration: '',
};

function registers(vr: string, rzp: string) {
	return {
		seznamRegistraci: {
			stavZdrojeRos: 'AKTIVNI',
			stavZdrojeVr: vr,
			stavZdrojeRzp: rzp,
		},
	};
}

describe('parseAres', () => {
	it('naparsuje běžnou odpověď', () => {
		expect(
			parseAres({
				ico: '27082440',
				obchodniJmeno: 'Alza.cz a.s.',
				dic: 'CZ27082440',
				pravniForma: '121',
				sidlo: {
					kodStatu: 'CZ',
					nazevObce: 'Praha',
					nazevUlice: 'Jankovcova',
					cisloDomovni: 1522,
					cisloOrientacni: 53,
					psc: 17000,
					textovaAdresa: 'Jankovcova 1522/53, Holešovice, 17000 Praha 7',
				},
				...registers('AKTIVNI', 'AKTIVNI'),
			}),
		).toEqual({
			name: 'Alza.cz a.s.',
			ico: '27082440',
			dic: 'CZ27082440',
			address: {
				street: 'Jankovcova 1522/53',
				city: 'Praha',
				zip: '17000',
			},
			registration: '',
		});
	});

	it('bez ulice spadne na textovou adresu', () => {
		expect(
			parseAres({
				ico: '00719331',
				obchodniJmeno: 'Jan Novák',
				sidlo: {
					nazevObce: 'Ostrožská Lhota',
					cisloDomovni: 120,
					psc: 68723,
					textovaAdresa: 'č.p. 120, 68723 Ostrožská Lhota',
				},
				...registers('NEEXISTUJICI', 'AKTIVNI'),
			}),
		).toEqual({
			name: 'Jan Novák',
			ico: '00719331',
			address: {
				street: 'č.p. 120, 68723 Ostrožská Lhota',
				city: 'Ostrožská Lhota',
				zip: '68723',
			},
			registration: 'Zapsáno v živnostenském rejstříku',
		});
	});

	it('ulice bez čísel zůstane holá', () => {
		expect(
			parseAres({
				obchodniJmeno: 'Firma',
				sidlo: {
					nazevUlice: 'Hlavní',
					nazevObce: 'Lhota',
				},
			}).address.street,
		).toBe('Hlavní');
	});

	it('číslo popisné bez orientačního nedostane lomítko', () => {
		expect(
			parseAres({
				obchodniJmeno: 'Firma',
				sidlo: {
					nazevUlice: 'Dlouhá',
					cisloDomovni: 12,
					nazevObce: 'Praha',
					psc: 11000,
				},
			}).address.street,
		).toBe('Dlouhá 12');
	});

	it('připojí písmeno u čísla orientačního', () => {
		expect(
			parseAres({
				obchodniJmeno: 'Firma',
				sidlo: {
					nazevUlice: 'Vinohradská',
					cisloDomovni: 1024,
					cisloOrientacni: 14,
					cisloOrientacniPismeno: 'a',
				},
			}).address.street,
		).toBe('Vinohradská 1024/14a');
	});

	it('firma bez vedlejších údajů dá prázdná pole', () => {
		expect(parseAres({ obchodniJmeno: 'Acme' })).toStrictEqual({
			...EMPTY,
			name: 'Acme',
		});
	});

	it('prázdné DIČ z ARES vynechá', () => {
		expect(
			parseAres({
				obchodniJmeno: 'Acme',
				dic: '',
			}),
		).toStrictEqual({
			...EMPTY,
			name: 'Acme',
		});
	});

	it.each([
		[
			{
				obchodniJmeno: 'Acme',
				ico: ['1'],
			},
			'ico: Neplatný vstup: očekáváno řetězec, obdrženo pole',
		],
		[
			{
				obchodniJmeno: 'Acme',
				sidlo: 'Praha',
			},
			'sidlo: Neplatný vstup: očekáváno object, obdrženo řetězec',
		],
		[
			{
				obchodniJmeno: 'Acme',
				sidlo: {
					psc: '11000',
				},
			},
			'sidlo.psc: Neplatný vstup: očekáváno číslo, obdrženo řetězec',
		],
		[
			{
				obchodniJmeno: 'Acme',
				seznamRegistraci: 'AKTIVNI',
			},
			'seznamRegistraci: Neplatný vstup: očekáváno object, obdrženo řetězec',
		],
		[
			{
				ico: '27082440',
				obchodniJmeno: ['Acme'],
			},
			'obchodniJmeno: Neplatný vstup: očekáváno řetězec, obdrženo pole',
		],
		[null, 'Neplatný vstup: očekáváno object, obdrženo null'],
		[[1, 2, 3], 'Neplatný vstup: očekáváno object, obdrženo pole'],
	])('jiný tvar, než slibuje API ARESu, odmítne celou odpověď %j', (answer, issue) => {
		expect(() => parseAres(answer)).toThrow(new Error(`Odpověď z ARES má neočekávaný tvar (${issue}).`));
	});

	it('odpověď bez názvu firmy odmítne', () => {
		const error = 'ARES k tomuto IČO nevrátil název firmy, údaje doplň ručně.';
		expect(() => parseAres({})).toThrow(error);
		expect(() =>
			parseAres({
				ico: '27082440',
				obchodniJmeno: '',
			}),
		).toThrow(error);
	});
});

describe('zápis do rejstříku z ARESu', () => {
	it('společnost s aktivní živností zápis nedá, ten si doplní ručně', () => {
		expect(
			parseAres({
				obchodniJmeno: 'Firma',
				...registers('AKTIVNI', 'AKTIVNI'),
			}).registration,
		).toBe('');
	});

	it('OSVČ zapsaná jen v živnostenském rejstříku dostane krátkou větu', () => {
		expect(
			parseAres({
				obchodniJmeno: 'Firma',
				...registers('NEEXISTUJICI', 'AKTIVNI'),
			}).registration,
		).toBe('Zapsáno v živnostenském rejstříku');
	});

	it('zaniklá živnost zápis nedá', () => {
		expect(
			parseAres({
				obchodniJmeno: 'Firma',
				...registers('NEEXISTUJICI', 'HISTORICKY'),
			}).registration,
		).toBe('');
	});

	it('subjekt mimo oba rejstříky zápis nedá', () => {
		expect(
			parseAres({
				obchodniJmeno: 'Firma',
				...registers('NEEXISTUJICI', 'NEEXISTUJICI'),
			}).registration,
		).toBe('');
	});
});

describe('aresServices', () => {
	it('zeptá se hlavního procesu a převede odpověď na firmu', async () => {
		invoke.mockResolvedValue({
			obchodniJmeno: 'Firma',
			ico: '25596641',
			dic: 'CZ25596641',
			sidlo: {
				nazevObce: 'Praha',
				nazevUlice: 'Dlouhá',
				cisloDomovni: 1,
				psc: 11000,
			},
			...registers('NEEXISTUJICI', 'AKTIVNI'),
		});
		expect(await aresServices.query('25596641')).toEqual({
			name: 'Firma',
			ico: '25596641',
			dic: 'CZ25596641',
			address: {
				street: 'Dlouhá 1',
				city: 'Praha',
				zip: '11000',
			},
			registration: 'Zapsáno v živnostenském rejstříku',
		});
		expect(invoke).toHaveBeenCalledExactlyOnceWith('ares_subject', { ico: '25596641' });
	});

	it('odmítnutí hlavního procesu nese dál beze změny', async () => {
		invoke.mockRejectedValue('Nepodařilo se spojit s ARES (jste offline?).');
		await expect(aresServices.query('25596641')).rejects.toBe('Nepodařilo se spojit s ARES (jste offline?).');
	});

	it('odpověď v neznámém tvaru odmítne', async () => {
		invoke.mockResolvedValue('<html>');
		await expect(aresServices.query('25596641')).rejects.toThrow(/^Odpověď z ARES má neočekávaný tvar \(/);
	});
});

describe('celá odpověď ARES ve skutečném tvaru se smyšlenými hodnotami', () => {
	it('obchodní společnost předvyplní odběratele bez věty o zápisu', () => {
		expect(parseAres(aresSro)).toEqual({
			name: 'Testovací studio s.r.o.',
			ico: '12345679',
			dic: 'CZ12345679',
			address: {
				street: 'Krátká 2/4',
				city: 'Brno',
				zip: '60200',
			},
			registration: '',
		});
	});

	it('živnostník dostane větu o živnostenském rejstříku a DIČ nemá', () => {
		expect(parseAres(aresTradesman)).toEqual({
			name: 'Jan Zkušební',
			ico: '25596641',
			address: {
				street: 'Dlouhá 1/7',
				city: 'Praha',
				zip: '11000',
			},
			registration: TRADE_REGISTER_ENTRY,
		});
	});
});
