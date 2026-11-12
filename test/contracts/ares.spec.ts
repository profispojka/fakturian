import { readFileSync } from 'node:fs';

import { expect, it } from 'vitest';

import { TRADE_REGISTER_ENTRY } from '~/constants/registration';
import { aresServices } from '~/services/ares';

import { backend } from '../setup/backend';

function answer(name: string): unknown {
	return JSON.parse(readFileSync(`test/contracts/fixtures/${name}`, 'utf8'));
}

it('obchodní společnost z odpovědi ARES předvyplní odběratele bez věty o zápisu', async () => {
	backend.ares.writeLiteral('12345679', answer('ares-sro.json'));

	await expect(aresServices.query('12345679')).resolves.toEqual({
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

it('živnostník z odpovědi ARES dostane větu o živnostenském rejstříku a DIČ nemá', async () => {
	backend.ares.writeLiteral('25596641', answer('ares-zivnostnik.json'));

	await expect(aresServices.query('25596641')).resolves.toEqual({
		name: 'Jan Zkušební',
		ico: '25596641',
		address: {
			street: 'Dlouhá 1/7',
			city: 'Praha',
			zip: '11000',
		},
		registration: TRADE_REGISTER_ENTRY,
	});
	expect(backend.args('ares_subject')).toEqual([{ ico: '25596641' }]);
});
