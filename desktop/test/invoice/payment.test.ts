import { decode } from 'fast-png';
import jsqr from 'jsqr';
import { describe, expect, it } from 'vitest';

import { buildSpayd, czechIban, paymentSymbol, qrPng, spaydAmount } from '../../invoice/payment.ts';
import { invoice, sampleInvoice } from '../invoices.ts';
import { thrownBy } from '../support.ts';

import type { Invoice } from '../../invoice/model.ts';

// 2 × 500 Kč na účet s předčíslím, bez IBAN.
function payable(): Invoice {
	return {
		...invoice(),
		bankAccount: '19-2000145399',
		iban: '',
		note: '',
		lines: [
			{
				description: 'Práce',
				quantity: 2,
				unit: 'ks',
				unitPriceCents: 50_000,
				itemId: '',
			},
		],
	};
}

function message(number: string): string | undefined {
	return buildSpayd({
		...invoice(),
		number,
	})?.split('*MSG:')[1];
}

// Smyšlený IBAN se sedícím součtem pro každou zemi z registru, v jejím tvaru.
const COUNTRY_IBANS = [
	'AD9030741852A1G3M5S7Y9E1',
	'AE343074185296307418529',
	'AL1930741852A1G3M5S7Y9E1K3Q5',
	'AT343074185296307418',
	'AZ17BGLQA1G3M5S7Y9E1K3Q5W7C9',
	'BA823074185296307418',
	'BE86307418529630',
	'BG13BGLQ307418A1G3M5S7',
	'BH43BGLQA1G3M5S7Y9E1K3',
	'BI1830741852963074185296307',
	'BR1630741852963074185296307B7',
	'BY36A1G33074A1G3M5S7Y9E1K3Q5',
	'CH9730741A1G3M5S7Y9E1',
	'CR08307418529630741852',
	'CY5930741852A1G3M5S7Y9E1K3Q5',
	'CZ1530741852963074185296',
	'DE38307418529630741852',
	'DJ9430741852963074185296307',
	'DK5630741852963074',
	'DO93A1G330741852963074185296',
	'EE433074185296307418',
	'EG063074185296307418529630741',
	'ES1830741852963074185296',
	'FI4430741852963074',
	'FK36BG307418529630',
	'FO2630741852963074',
	'FR493074185296A1G3M5S7Y9E30',
	'GB69BGLQ30741852963074',
	'GE61BG3074185296307418',
	'GI65BGLQA1G3M5S7Y9E1K3Q',
	'GL2630741852963074',
	'GR283074185A1G3M5S7Y9E1K3Q5',
	'GT90A1G3M5S7Y9E1K3Q5W7C9I1O3',
	'HR8330741852963074185',
	'HU89307418529630741852963074',
	'IE42BGLQ30741852963074',
	'IL383074185296307418529',
	'IQ50BGLQ307418529630741',
	'IS143074185296307418529630',
	'IT31B3074185296A1G3M5S7Y9E1',
	'JO76BGLQ3074A1G3M5S7Y9E1K3Q5W7',
	'KW04BGLQA1G3M5S7Y9E1K3Q5W7C9I1',
	'KZ70307A1G3M5S7Y9E1K',
	'LB373074A1G3M5S7Y9E1K3Q5W7C9',
	'LC33BGLQA1G3M5S7Y9E1K3Q5W7C9I1O3',
	'LI1330741A1G3M5S7Y9E1',
	'LT323074185296307418',
	'LU76307A1G3M5S7Y9E1K',
	'LV47BGLQA1G3M5S7Y9E1K',
	'LY56307418529630741852963',
	'MC313074185296A1G3M5S7Y9E30',
	'MD42A1G3M5S7Y9E1K3Q5W7C9',
	'ME54307418529630741852',
	'MK71307A1G3M5S7Y930',
	'MN413074185296307418',
	'MR8630741852963074185296307',
	'MT81BGLQ30741A1G3M5S7Y9E1K3Q5W7',
	'MU85BGLQ3074185296307418529BGL',
	'NI27BGLQ30741852963074185296',
	'NL67BGLQ3074185296',
	'NO5530741852963',
	'OM13307A1G3M5S7Y9E1K3Q5',
	'PL44307418529630741852963074',
	'PS33BGLQA1G3M5S7Y9E1K3Q5W7C9I',
	'PT35307418529630741852963',
	'QA78BGLQA1G3M5S7Y9E1K3Q5W7C9I',
	'RO37BGLQA1G3M5S7Y9E1K3Q5',
	'RS64307418529630741852',
	'RU6430741852963074A1G3M5S7Y9E1K3Q',
	'SA9430A1G3M5S7Y9E1K3Q5W7',
	'SC16BGLQ30741852963074185296BGL',
	'SD3930741852963074',
	'SE3130741852963074185296',
	'SI48307418529630741',
	'SK1330741852963074185296',
	'SM59B3074185296A1G3M5S7Y9E1',
	'SO363074185296307418529',
	'ST08307418529630741852963',
	'SV40BGLQ30741852963074185296',
	'TL363074185296307418529',
	'TN9230741852963074185296',
	'TR61307418A1G3M5S7Y9E1K3Q5',
	'UA49307418A1G3M5S7Y9E1K3Q5W7C',
	'VA82307418529630741852',
	'VG20BGLQ3074185296307418',
	'XK483074185296307418',
	'YE68BGLQ3074A1G3M5S7Y9E1K3Q5W7',
];

// Kontrolní číslice IBAN (ISO 13616) k řetězci s libovolnými znaky na jejich místě.
function withCheckDigits(iban: string): string {
	let rest = 0;
	for (const character of `${iban.slice(4)}${iban.slice(0, 2)}00`) {
		const value = Number.parseInt(character, 36);
		rest = (rest * (value < 10 ? 10 : 100) + value) % 97;
	}
	return `${iban.slice(0, 2)}${String(98 - rest).padStart(2, '0')}${iban.slice(4)}`;
}

function account(iban: string): string | undefined {
	return buildSpayd({
		...sampleInvoice(),
		iban,
	})?.split('*')[2];
}

describe('IBAN z českého účtu', () => {
	it('dopočítá kontrolní číslice k účtu s předčíslím i bez něj', () => {
		expect(czechIban('19-2000145399', '0800')).toBe('CZ6508000000192000145399');
		expect(czechIban('2000145399', '0800')).toBe('CZ7908000000002000145399');
		expect(czechIban('100001-2000145399', '0800')).toBe('CZ6308001000012000145399');
	});

	it('krátké číslo účtu doplní nulami a jednocifernou kontrolu taky', () => {
		expect(czechIban('19', '0800')).toBe('CZ3308000000000000000019');
		expect(czechIban('0000000019', '0800')).toBe('CZ3308000000000000000019');
		expect(czechIban('1000000080', '0800')).toBe('CZ8708000000001000000080');
		expect(czechIban('1062', '0800')).toBe('CZ0208000000000000001062');
	});

	it('mezery a prázdné předčíslí přeskočí', () => {
		expect(czechIban('19 - 2000 145 399', ' 08 00 ')).toBe('CZ6508000000192000145399');
		expect(czechIban('-2000145399', '0800')).toBe('CZ7908000000002000145399');
	});

	it('nesmyslný účet nebo kód banky IBAN nedostane', () => {
		expect(czechIban('2000145399', '80')).toBe(undefined);
		expect(czechIban('', '0800')).toBe(undefined);
		expect(czechIban('1234567-2000145399', '0800')).toBe(undefined);
		expect(czechIban('0000000-2000145399', '0800')).toBe(undefined);
		expect(czechIban('20001453990', '0800')).toBe(undefined);
		expect(czechIban('123456789012345', '0800')).toBe(undefined);
		expect(czechIban('7', '0800')).toBe(undefined);
		expect(czechIban('0000000000', '0800')).toBe(undefined);
		expect(czechIban('19-00', '0800')).toBe(undefined);
	});

	it('překlep v čísle účtu nebo předčíslí neprojde váženým součtem', () => {
		expect(czechIban('2000145398', '0800')).toBe(undefined);
		expect(czechIban('18-2000145399', '0800')).toBe(undefined);
	});
});

describe('variabilní symbol', () => {
	it('platný vyplněný symbol zůstane', () => {
		expect(
			paymentSymbol({
				...invoice(),
				variableSymbol: ' 0042 ',
			}),
		).toBe('0042');
	});

	it('jinak ho složí z číslic čísla dokladu, nejvýš posledních deset', () => {
		expect(
			paymentSymbol({
				...invoice(),
				number: 'F2026-041',
				variableSymbol: '',
			}),
		).toBe('2026041');
		expect(
			paymentSymbol({
				...invoice(),
				number: 'F2026-123456789',
				variableSymbol: '12345678901',
			}),
		).toBe('6123456789');
	});
});

describe('částka v SPAYD', () => {
	it('nikdy nepřesáhne deset znaků', () => {
		expect(spaydAmount(5)).toBe('0.05');
		expect(spaydAmount(999_999_999)).toBe('9999999.99');
		expect(spaydAmount(1_000_000_000)).toBe('10000000');
		expect(spaydAmount(999_999_999_900)).toBe('9999999999');
		expect(spaydAmount(1_000_000_001)).toBe(undefined);
		expect(spaydAmount(1_000_000_000_000)).toBe(undefined);
	});
});

describe('QR platba', () => {
	it('nese účet, částku, splatnost, variabilní symbol a zprávu', () => {
		expect(buildSpayd(payable())).toBe(
			'SPD*1.0*ACC:CZ6508000000192000145399*AM:1000.00*CC:CZK*DT:20260612*X-VS:20260001*MSG:Faktura 20260001',
		);
		expect(buildSpayd(sampleInvoice())).toBe(
			'SPD*1.0*ACC:CZ7908000000002000145399*AM:3659.97*CC:CZK*DT:20260611*X-VS:20260007*MSG:Faktura 20260007',
		);
	});

	it('bez platného data splatnosti vynechá DT', () => {
		expect(
			buildSpayd({
				...payable(),
				dueDate: '',
			}),
		).toBe('SPD*1.0*ACC:CZ6508000000192000145399*AM:1000.00*CC:CZK*X-VS:20260001*MSG:Faktura 20260001');
	});

	it('vyplněný IBAN má přednost a mezery z něj vypadnou', () => {
		expect(
			buildSpayd({
				...sampleInvoice(),
				iban: 'cz65 0800 0000 1920 0014 5399',
			}),
		).toBe('SPD*1.0*ACC:CZ6508000000192000145399*AM:3659.97*CC:CZK*DT:20260611*X-VS:20260007*MSG:Faktura 20260007');
	});

	it('bez účtu, s překlepem v účtu nebo v IBAN kód nevznikne', () => {
		expect(
			buildSpayd({
				...payable(),
				bankAccount: '',
				bankCode: '',
			}),
		).toBe(undefined);
		expect(
			buildSpayd({
				...sampleInvoice(),
				bankAccount: '2000145398',
			}),
		).toBe(undefined);
		expect(
			buildSpayd({
				...sampleInvoice(),
				iban: 'CZ6608000000192000145399',
			}),
		).toBe(undefined);
		expect(
			buildSpayd({
				...sampleInvoice(),
				iban: 'CZ65 0800',
			}),
		).toBe(undefined);
		expect(
			buildSpayd({
				...sampleInvoice(),
				iban: `CZ65${'0'.repeat(31)}`,
			}),
		).toBe(undefined);
	});

	it('IBAN z mezer se nepočítá, QR jde na číslo účtu', () => {
		expect(
			buildSpayd({
				...payable(),
				iban: '   ',
			})?.split('*')[2],
		).toBe('ACC:CZ6508000000192000145399');
	});

	it('IBAN se sedícím součtem projde jen ve tvaru, který jeho země zná', () => {
		const accounts = [
			'DE89370400440532013000',
			'SK3112000000198742637541',
			'CZ11080000000019200014539',
			'US8412345678901234',
		];

		expect(
			accounts.map(
				(iban) =>
					buildSpayd({
						...sampleInvoice(),
						iban,
					})?.split('*')[2],
			),
		).toEqual(['ACC:DE89370400440532013000', 'ACC:SK3112000000198742637541', undefined, undefined]);
	});

	it('IBAN každé země projde jen celý, bez znaku navíc i bez cizího začátku', () => {
		for (const iban of COUNTRY_IBANS) {
			const country = iban.slice(0, 2);
			const longer = withCheckDigits(`${iban}0`);
			const prefixed = withCheckDigits(`${country}00${iban}`);

			expect([iban, account(iban), account(longer), account(prefixed)]).toEqual([
				iban,
				`ACC:${iban}`,
				undefined,
				undefined,
			]);
		}
	});

	it('doklad nad deset milionů dostane částku v celých korunách, nebo žádný kód', () => {
		const line = {
			description: 'Dílo',
			quantity: 1,
			unit: 'ks',
			unitPriceCents: 1_250_000_000,
			itemId: '',
		};
		expect(
			buildSpayd({
				...sampleInvoice(),
				lines: [line],
			}),
		).toBe(
			'SPD*1.0*ACC:CZ7908000000002000145399*AM:12500000*CC:CZK*DT:20260611*X-VS:20260007*MSG:Faktura 20260007',
		);
		expect(
			buildSpayd({
				...sampleInvoice(),
				lines: [
					{
						...line,
						unitPriceCents: 1_250_000_050,
					},
				],
			}),
		).toBe(undefined);
	});

	it('dobropis ani nulový doklad kód nemají — záporná částka se QR kódem neplatí', () => {
		const credit = sampleInvoice();
		expect(
			buildSpayd({
				...credit,
				lines: credit.lines.map((line) => ({
					...line,
					unitPriceCents: -line.unitPriceCents,
				})),
			}),
		).toBe(undefined);
		expect(
			buildSpayd({
				...credit,
				lines: [],
			}),
		).toBe(undefined);
	});

	it('neplatný vyplněný symbol nahradí číslice čísla dokladu', () => {
		for (const variableSymbol of ['12A', '12345678901']) {
			expect(
				buildSpayd({
					...sampleInvoice(),
					variableSymbol,
				}),
			).toBe(
				'SPD*1.0*ACC:CZ7908000000002000145399*AM:3659.97*CC:CZK*DT:20260611*X-VS:20260007*MSG:Faktura 20260007',
			);
		}
	});

	it('číslo dokladu bez číslic dá kód bez variabilního symbolu', () => {
		expect(
			buildSpayd({
				...payable(),
				number: 'FAKTURA',
				variableSymbol: '',
			}),
		).toBe('SPD*1.0*ACC:CZ6508000000192000145399*AM:1000.00*CC:CZK*DT:20260612*MSG:Faktura FAKTURA');
	});

	it('cizí hodnota nepřidá do kódu další pole', () => {
		// Vytahovat číslice by nestačilo: z `20260007*ACC:CZ00…9999999999` by filtr složil VS z podstrčeného účtu.
		expect(
			buildSpayd({
				...payable(),
				variableSymbol: '20260007*ACC:CZ0000000000009999999999',
			}),
		).toBe('SPD*1.0*ACC:CZ6508000000192000145399*AM:1000.00*CC:CZK*DT:20260612*X-VS:20260001*MSG:Faktura 20260001');
		expect(
			buildSpayd({
				...payable(),
				iban: 'CZ6508000000192000145399*ACC:CZ0000000000009999999999',
			}),
		).toBe(undefined);
		expect(
			buildSpayd({
				...payable(),
				number: '2026*ACC:CZ0000000000000000000000',
				variableSymbol: '20260001',
			}),
		).toBe(
			'SPD*1.0*ACC:CZ6508000000192000145399*AM:1000.00*CC:CZK*DT:20260612*X-VS:20260001*MSG:Faktura 2026ACC:CZ0000000000000000000000',
		);
	});
});

describe('zpráva v QR platbě', () => {
	it('česká diakritika se srovná na ASCII', () => {
		expect(message('áàâäčćďéěèêëíìîïňóòôöřšśťúůùûüýÿžźż')).toBe('Faktura aaaaccdeeeeeiiiinoooorsstuuuuuyyzzz');
		expect(message('ÁÀÂÄČĆĎÉĚÈÊËÍÌÎÏŇÓÒÔÖŘŠŚŤÚŮÙÛÜÝŽŹŻ')).toBe('Faktura AAAACCDEEEEEIIIINOOOORSSTUUUUUYZZZ');
		expect(message('Fš2026-001')).toBe('Faktura Fs2026-001');
	});

	it('znaménko odpadne i u písmen jiných jazyků a nepřevoditelný znak vypadne', () => {
		expect(message('çãõñåĺēĝ')).toBe('Faktura caonaleg');
		expect(message('2026-Ω-01')).toBe('Faktura 2026--01');
		expect(message('2026-😀-01')).toBe('Faktura 2026--01');
	});

	it('má nejvýš šedesát znaků', () => {
		expect(message('X'.repeat(64))).toBe(`Faktura ${'X'.repeat(52)}`);
	});
});

describe('obrázek QR kódu', () => {
	it('přečte se zpátky na tentýž řetězec', () => {
		const spayd =
			'SPD*1.0*ACC:CZ6508000000192000145399*AM:1000.00*CC:CZK*DT:20260612*X-VS:20260001*MSG:Faktura 20260001';
		const image = decode(qrPng(spayd));
		const rgba = new Uint8ClampedArray(image.width * image.height * 4);
		for (const [i, value] of image.data.entries())
			rgba.fill(value, i * 4, i * 4 + 3).fill(255, i * 4 + 3, i * 4 + 4);

		expect([image.width, image.height, image.channels, image.depth]).toEqual([360, 360, 1, 8]);
		expect(jsqr.default(rgba, image.width, image.height)?.data).toBe(spayd);
	});

	it('kód leží v tiché zóně čtyř modulů a ta zůstane bílá', () => {
		const image = decode(qrPng('SPD*1.0*ACC:CZ6508000000192000145399*AM:1000.00'));
		const side = image.width;
		const inside = (pixel: number) => pixel >= 32 && pixel < side - 32;
		const quiet = image.data.filter((_, i) => !inside(i % side) || !inside(Math.floor(i / side)));

		expect(new Set(quiet)).toEqual(new Set([255]));
		expect(image.data[32 * side + 32]).toBe(0);
	});

	it('data nad kapacitu QR kódu ohlásí česky', () => {
		expect(thrownBy(() => qrPng('x'.repeat(10_000)))).toEqual(
			new Error('QR platbu nejde vytvořit: údaje se do QR kódu nevejdou.', { cause: expect.any(Error) }),
		);
	});
});
