import { decode } from 'fast-png';
import jsqr from 'jsqr';
import { describe, expect, it } from 'vitest';

import { buildSpayd, czechIban, paymentSymbol, qrPng, spaydAmount } from '../../invoice/payment.ts';
import { invoice, sampleInvoice } from '../invoices.ts';
import { thrownBy } from '../support.ts';

import type { Invoice } from '../../invoice/model.ts';

// 2 × 500 Kč na účet s předčíslím.
function payable(): Invoice {
	return {
		...invoice(),
		bankAccount: '19-2000145399',
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

describe('IBAN generovaný pro QR platbu', () => {
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

	it('nesmyslný účet nebo kód nepřevede', () => {
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

	it('bez platného českého účtu kód nevznikne', () => {
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
