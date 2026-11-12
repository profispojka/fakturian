import { Worker } from 'node:worker_threads';

import { DOMImplementation, DOMParser, type Element } from '@xmldom/xmldom';
import { describe, expect, it, vi } from 'vitest';

import { MAX_CENTS } from '~/bindings';

import {
	child,
	children,
	copySent,
	extensionElement,
	fromCents,
	lineUsageYear,
	parse,
	sentAt,
	text,
	setSent,
	toCents,
	toXml,
} from '../../isdoc/mod.ts';
import { canonical, fixture, schemaReport } from '../isdoc.ts';
import { rejection, thrownBy } from '../support.ts';

const MAX_ISDOC_BYTES = 32 * 1024 * 1024;
const MAX_DEPTH = 128;
const TIMESTAMP = '2026-05-29T10:15:00Z';
const OUR_NAMESPACE = 'xmlns:fakturian="https://fakturian.app/isdoc/extensions/1"';

const SAMPLES = [
	'example1.isdoc',
	'example2.isdoc',
	'foreign-document.isdoc',
	'bez-mnozstvi.isdoc',
	'zaokrouhleni.isdoc',
	'zalohova.isdoc',
	'two-payments.isdoc',
];

async function withNestedExtensions(levels: number, innermost = ''): Promise<string> {
	const xml = await fixture('foreign-document.isdoc');
	const open = '<x:a xmlns:x="http://cizi.example/ext">'.repeat(levels);
	return xml.replace(
		'<AccountingSupplierParty>',
		`<Extensions>${open}${innermost}${'</x:a>'.repeat(levels)}</Extensions><AccountingSupplierParty>`,
	);
}

describe('čtení ISDOC', () => {
	it('doklad přesně na stropu velikosti dostane parser', async () => {
		await expect(parse('x'.repeat(MAX_ISDOC_BYTES))).rejects.toEqual(
			new Error('ISDOC nejde přečíst: řádek 1: soubor není čitelné XML'),
		);
	});

	it('větší doklad odmítne dřív, než ho čte, a velikost počítá v bajtech', async () => {
		await expect(parse('x'.repeat(MAX_ISDOC_BYTES + 1))).rejects.toEqual(
			new Error('ISDOC je nepřiměřeně velký (32 MB) — takhle doklad nevypadá.'),
		);
		await expect(parse('č'.repeat(MAX_ISDOC_BYTES / 2 + 1))).rejects.toEqual(
			new Error('ISDOC je nepřiměřeně velký (32 MB) — takhle doklad nevypadá.'),
		);
	});

	it('hluboké vnoření odmítne před validací', async () => {
		const xml = await withNestedExtensions(100_000);

		await expect(parse(xml)).rejects.toEqual(
			new Error('ISDOC je vnořený hlouběji než 128 úrovní — takhle doklad nevypadá.'),
		);
	});

	it('vnoření na hranici hloubky přečte, o úroveň víc ne', async () => {
		// Kořen `Invoice` a `Extensions` jsou první dvě úrovně.
		const document = await parse(await withNestedExtensions(MAX_DEPTH - 2));
		const extensions = child(document.documentElement, 'Extensions');

		expect(extensions?.childNodes.length).toBe(1);
		await expect(parse(await withNestedExtensions(MAX_DEPTH - 1))).rejects.toEqual(
			new Error('ISDOC je vnořený hlouběji než 128 úrovní — takhle doklad nevypadá.'),
		);
	});

	it('hloubku měří otevřené prvky, ne zavírací značky', async () => {
		const xml = await fixture('foreign-document.isdoc');
		const tag = 'x:a xmlns:x="http://cizi.example/ext"';
		const deep = xml.replace(
			'<AccountingSupplierParty>',
			`<Extensions>${`<${tag}>`.repeat(MAX_DEPTH - 1)}${`</x:a><${tag}/>`.repeat(MAX_DEPTH - 1)}</Extensions><AccountingSupplierParty>`,
		);

		await expect(parse(deep)).rejects.toEqual(
			new Error('ISDOC je vnořený hlouběji než 128 úrovní — takhle doklad nevypadá.'),
		);
	});

	it('hloubku změří i za atributem v apostrofech a za mezerou před prvním prvkem', async () => {
		const nested = await withNestedExtensions(MAX_DEPTH);
		const quoted = nested.replaceAll('"http://cizi.example/ext"', "'http://cizi.example/ext'");

		for (const xml of [quoted, `\n${nested}`]) {
			await expect(parse(xml)).rejects.toEqual(
				new Error('ISDOC je vnořený hlouběji než 128 úrovní — takhle doklad nevypadá.'),
			);
		}
	});

	it('značka uvnitř komentáře hloubku nepřidá', async () => {
		const source = await fixture('foreign-document.isdoc');
		const xml = source.replace(
			'<AccountingSupplierParty>',
			`${'<!-- <y -->'.repeat(MAX_DEPTH + 1)}<AccountingSupplierParty>`,
		);

		const document = await parse(xml);

		expect(text(document.documentElement, 'ID')).toBe('2026-0042');
	});

	it('prázdný prvek hloubku nepřidá', async () => {
		const xml = await withNestedExtensions(MAX_DEPTH - 2, '<x:b xmlns:x="http://cizi.example/ext"/>');

		const document = await parse(xml);

		expect(children(document.documentElement, 'Extensions').length).toBe(1);
	});

	it('neukončenou značku při měření hloubky přeskočí a vadu nahlásí validace', async () => {
		const xml = await fixture('foreign-document.isdoc');

		await expect(parse(xml.replace('<DocumentType>', '<DocumentType a="1'))).rejects.toEqual(
			new Error('ISDOC nejde přečíst: řádek 3: soubor není čitelné XML'),
		);
	});

	it('neukončený komentář, CDATA ani instrukci neprochází znovu od každého `<`', async () => {
		const started = performance.now();
		for (const [open, reason] of [
			['<!--x>', 'řádek 1: soubor není čitelné XML'],
			['<![CDATA[x>', 'řádek 1: soubor není čitelné XML'],
			['<?x>', 'řádek 1: soubor není čitelné XML'],
		] as const) {
			const xml = open.repeat(Math.floor(MAX_ISDOC_BYTES / open.length));

			await expect(parse(xml)).rejects.toEqual(new Error(`ISDOC nejde přečíst: ${reason}`));
		}

		expect(performance.now() - started < 10_000).toBe(true);
	});

	it('doklad bez povinného prvku odmítne i s řádkem a důvodem', async () => {
		const xml = await fixture('bez-castky.isdoc');

		await expect(parse(xml)).rejects.toEqual(
			new Error(
				'ISDOC nejde přečíst: řádek 43: prvek LineExtensionAmountTaxInclusive neodpovídá standardu ISDOC',
			),
		);
	});

	it('částku s desetinnou čárkou nebo mezerou odmítne už čtení, protože nesplní xs:decimal', async () => {
		const xml = await fixture('foreign-document.isdoc');

		await expect(parse(xml.replace('1875.00', '1 875,00'))).rejects.toEqual(
			new Error('ISDOC nejde přečíst: řádek 43: prvek LineExtensionAmount neodpovídá standardu ISDOC'),
		);
		await expect(parse(xml.replace('<CurrRate>1</CurrRate>', '<CurrRate>1e3</CurrRate>'))).rejects.toEqual(
			new Error('ISDOC nejde přečíst: řádek 10: prvek CurrRate neodpovídá standardu ISDOC'),
		);
	});

	it('prázdnou měnu odmítne fazeta délky', async () => {
		const source = await fixture('foreign-document.isdoc');
		const xml = source.replace(
			'<LocalCurrencyCode>CZK</LocalCurrencyCode>',
			'<LocalCurrencyCode></LocalCurrencyCode>',
		);

		await expect(parse(xml)).rejects.toEqual(
			new Error('ISDOC nejde přečíst: řádek 9: prvek LocalCurrencyCode neodpovídá standardu ISDOC'),
		);
	});

	it('přijme jen kořen Invoice ve jmenném prostoru ISDOC', async () => {
		await expect(parse('<?xml version="1.0"?><Invoice><ID>1</ID></Invoice>')).rejects.toEqual(
			new Error('ISDOC nejde přečíst: řádek 1: prvek Invoice neodpovídá standardu ISDOC'),
		);
		await expect(
			parse('<Objednavka xmlns="http://example.com/obj" xmlns:i="http://isdoc.cz/namespace/2013"/>'),
		).rejects.toEqual(
			new Error(
				'ISDOC nejde přečíst: řádek 1: prvek {http://example.com/obj}Objednavka neodpovídá standardu ISDOC',
			),
		);
		await expect(
			parse('<o:Objednavka xmlns:i="http://isdoc.cz/namespace/2013" xmlns:o="http://example.com/obj"/>'),
		).rejects.toEqual(
			new Error(
				'ISDOC nejde přečíst: řádek 1: prvek {http://example.com/obj}Objednavka neodpovídá standardu ISDOC',
			),
		);
	});

	it('kořen s prefixem ve jmenném prostoru ISDOC přečte', async () => {
		const source = await fixture('foreign-document.isdoc');
		const xml = source.replace(/<(\/?)([A-Z])/g, '<$1i:$2').replace('xmlns=', 'xmlns:i=');

		const document = await parse(xml);

		expect(child(document.documentElement, 'ID')?.textContent).toBe('2026-0042');
	});

	it('prázdný nebo nedokončený text XML odmítne s důvodem od parseru', async () => {
		await expect(parse('')).rejects.toEqual(new Error('ISDOC nejde přečíst: řádek 1: soubor není čitelné XML'));
		await expect(parse('<Invoice xmlns="http://isdoc.cz/namespace/2013"><ID>1</ID>')).rejects.toEqual(
			new Error('ISDOC nejde přečíst: řádek 1: soubor není čitelné XML'),
		);
	});

	it('doklad, který vyčerpá paměť validátoru, odmítne jako nečitelný', async () => {
		const source = await fixture('foreign-document.isdoc');
		const xml = source.replace(
			'<AccountingSupplierParty>',
			`<Extensions><x:a xmlns:x="http://cizi.example/ext" b="${'a'.repeat(11 * 1024 * 1024)}"/></Extensions><AccountingSupplierParty>`,
		);

		await expect(parse(xml)).rejects.toEqual(new Error('ISDOC nejde přečíst: řádek 12: soubor není čitelné XML'));
	});

	it('entitu z vnitřní DTD odmítne, protože by se po přeuložení ztratila', async () => {
		const source = await fixture('foreign-document.isdoc');
		const xml = source
			.replace(
				'<?xml version="1.0" encoding="UTF-8"?>',
				'<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE Invoice [<!ENTITY e "2026-0042">]>',
			)
			.replace('<ID>2026-0042</ID>', '<ID>&e;</ID>');

		await expect(parse(xml)).rejects.toEqual(
			new Error('ISDOC nejde přečíst: doklad používá vlastní entity, které appka neumí zachovat', {
				cause: expect.objectContaining({
					message: 'Reporting error "entity not found:&e;" caused onWarningStopParsing',
				}),
			}),
		);
	});

	it('osamělý návrat vozíku i CRLF v textu přečte jako konec řádku', async () => {
		const source = await fixture('example1.isdoc');
		const xml = source.replace(/<Note>[^<]*<\/Note>/, '<Note>a\rb\r\nc</Note>');

		const document = await parse(xml);

		expect(text(document.documentElement, 'Note')).toBe('a\nb\nc');
	});
});

describe('kontrola proti XSD ve workeru', () => {
	it('zaseknutou kontrolu po třiceti sekundách ukončí a další kontrola založí nový worker', async () => {
		const xml = await fixture('foreign-document.isdoc');
		const silent = vi.spyOn(Worker.prototype, 'postMessage').mockImplementation(() => undefined);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		let outcome: Promise<unknown>;
		try {
			outcome = rejection(parse(xml));
			await vi.advanceTimersByTimeAsync(29_999);
			expect(silent.mock.calls.length).toBe(1);
			await vi.advanceTimersByTimeAsync(1);
		} finally {
			vi.useRealTimers();
			silent.mockRestore();
		}
		expect(await outcome).toEqual(
			new Error('ISDOC nejde přečíst: kontrola dokladu nedoběhla', {
				cause: new Error('kontrola proti XSD nedoběhla'),
			}),
		);
		const document = await parse(xml);

		expect(text(document.documentElement, 'ID')).toBe('2026-0042');
	});

	it('pád workeru ohlásí jako chybu té kontroly a další kontrola projde', async () => {
		const xml = await fixture('foreign-document.isdoc');
		const crash = vi.spyOn(Worker.prototype, 'postMessage').mockImplementation(function (this: Worker) {
			setImmediate(() => this.emit('error', new Error('Worker spadl.')));
		});
		try {
			await expect(parse(xml)).rejects.toEqual(
				new Error('ISDOC nejde přečíst: kontrola dokladu nedoběhla', { cause: new Error('Worker spadl.') }),
			);
		} finally {
			crash.mockRestore();
		}
		const document = await parse(xml);

		expect(text(document.documentElement, 'ID')).toBe('2026-0042');
	});

	it('kontrola, která selže ještě před odesláním dokladu, frontu nezablokuje', async () => {
		const xml = await fixture('foreign-document.isdoc');
		const broken = vi.spyOn(Worker.prototype, 'postMessage').mockImplementation(() => {
			throw new Error('Zprávu nejde odeslat.');
		});
		try {
			await expect(parse(xml)).rejects.toEqual(
				new Error('ISDOC nejde přečíst: kontrola dokladu nedoběhla', {
					cause: new Error('Zprávu nejde odeslat.'),
				}),
			);
		} finally {
			broken.mockRestore();
		}
		const document = await parse(xml);

		expect(text(document.documentElement, 'ID')).toBe('2026-0042');
	});

	it('hotová kontrola po sobě nenechá časovač', async () => {
		const xml = await fixture('foreign-document.isdoc');
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		try {
			await parse(xml);

			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('opakované kontroly nenechávají na workeru posluchače', async () => {
		const xml = await fixture('foreign-document.isdoc');
		const warning = vi.spyOn(process, 'emitWarning');

		for (let i = 0; i < 12; i++) await parse(xml);

		expect(warning).not.toHaveBeenCalled();
	});

	it('souběžné kontroly se nepomíchají', async () => {
		const valid = await fixture('foreign-document.isdoc');
		const broken = await fixture('bez-castky.isdoc');

		const results = await Promise.allSettled([parse(valid), parse(broken), parse(valid)]);

		expect(
			results.map((result) =>
				result.status === 'fulfilled' ? text(result.value.documentElement, 'ID') : result.reason,
			),
		).toEqual([
			'2026-0042',
			new Error(
				'ISDOC nejde přečíst: řádek 43: prvek LineExtensionAmountTaxInclusive neodpovídá standardu ISDOC',
			),
			'2026-0042',
		]);
	});
});

describe('prvky dokladu', () => {
	it('dítě se hledá jen ve jmenném prostoru ISDOC', () => {
		const document = new DOMParser().parseFromString(
			'<Invoice xmlns="http://isdoc.cz/namespace/2013"><x:ID xmlns:x="urn:cizi">cizí</x:ID>text<ID>náš</ID></Invoice>',
			'text/xml',
		);

		expect(children(document.documentElement, 'ID').map((element) => element.textContent)).toEqual(['náš']);
	});
});

describe('zápis ISDOC', () => {
	it('instrukci kromě hlavičky XML zachová', async () => {
		const source = await fixture('foreign-document.isdoc');
		const original = source.replace('<Invoice', '<?xml-stylesheet href="faktura.xsl" type="text/xsl"?>\n<Invoice');

		const xml = toXml(await parse(original));

		expect(xml.split('\n').slice(0, 2)).toEqual([
			'<?xml version="1.0" encoding="UTF-8"?>',
			'<?xml-stylesheet href="faktura.xsl" type="text/xsl"?>',
		]);
	});

	it('přeuložení neztratí prvek, atribut, text, komentář ani instrukci a projde XSD', async () => {
		for (const name of SAMPLES) {
			const original = await fixture(name);
			const document = await parse(original);
			const xml = toXml(document);

			expect([name, await canonical(xml)]).toEqual([name, await canonical(original)]);
			expect([name, await schemaReport(xml)]).toEqual([name, '- validates\n']);
		}
	});

	it('přeuložení zachová text dokladu beze změny, jen hlavičku napíše vlastní v UTF-8', async () => {
		const original = await fixture('example1.isdoc');
		const document = await parse(original);

		expect(toXml(document)).toBe(`${original.replace('encoding="utf-8"', 'encoding="UTF-8"')}\n`);
	});

	it('řídicí znaky z poznámky vypustí a text kolem nich nechá', async () => {
		const document = await parse(await fixture('example1.isdoc'));
		child(document.documentElement, 'Note')!.textContent = 'Dodáno\u000Bv pondělí\u000Cráno\uFFFE.';

		const xml = toXml(document);
		const back = await parse(xml);

		expect(child(back.documentElement, 'Note')?.textContent).toBe('Dodánov pondělíráno.');
	});

	it('osamělou polovinu páru UTF-16 vypustí a celý znak mimo BMP nechá', async () => {
		const document = await parse(await fixture('example1.isdoc'));
		child(document.documentElement, 'Note')!.textContent = 'a\uD800b\uDC00c\u{1F600}';

		const back = await parse(toXml(document));

		expect(child(back.documentElement, 'Note')?.textContent).toBe('abc\u{1F600}');
	});

	it('konec řádku a tabulátor v poznámce přežijí', async () => {
		const document = await parse(await fixture('example1.isdoc'));
		child(document.documentElement, 'Note')!.textContent = 'První řádek\nDruhý\tsloupec\u2028konec';

		const back = await parse(toXml(document));

		expect(child(back.documentElement, 'Note')?.textContent).toBe('První řádek\nDruhý\tsloupec\u2028konec');
	});
});

describe('údaje Fakturianu o odeslání', () => {
	it('dokument bez kořene označit nejde', () => {
		const empty = new DOMImplementation().createDocument(null, '', null);

		expect(thrownBy(() => setSent(empty, TIMESTAMP, 'test@example.cz'))).toEqual(
			new Error('Dokument ISDOC nemá kořenový prvek.'),
		);
	});

	it('označí doklad jako odeslaný a druhé označení nic nezmění', async () => {
		const document = await parse(await fixture('foreign-document.isdoc'));

		setSent(document, TIMESTAMP, 'test@example.cz');
		const once = toXml(document);
		setSent(document, '2026-06-01T08:00:00+02:00', 'jiný@example.cz');

		expect(sentAt(document)).toBe(TIMESTAMP);
		expect(toXml(document)).toBe(once);
	});

	it('hlavičkové Extensions založí před dodavatelem a zbytek dokladu nechá beze změny', async () => {
		const document = await parse(await fixture('foreign-document.isdoc'));
		const before = toXml(document);

		setSent(document, TIMESTAMP, 'Petr & syn');
		const xml = toXml(document);

		expect(xml).toBe(
			before.replace(
				'<AccountingSupplierParty>',
				`<Extensions><fakturian:SentAt ${OUR_NAMESPACE}>${TIMESTAMP}</fakturian:SentAt><fakturian:SentBy ${OUR_NAMESPACE}><![CDATA[Petr & syn]]></fakturian:SentBy></Extensions><AccountingSupplierParty>`,
			),
		);
		expect(await schemaReport(xml)).toBe('- validates\n');
	});

	it('do existujících Extensions připíše na konec a cizí rozšíření zachová', async () => {
		const document = await parse(await fixture('example1.isdoc'));
		const before = toXml(document);

		setSent(document, TIMESTAMP, 'test@example.cz');

		expect(toXml(document)).toBe(
			before.replace(
				'</Extensions>',
				`<fakturian:SentAt ${OUR_NAMESPACE}>${TIMESTAMP}</fakturian:SentAt><fakturian:SentBy ${OUR_NAMESPACE}>test@example.cz</fakturian:SentBy></Extensions>`,
			),
		);
	});

	it('druhý údaj o odeslání je poškozený doklad', async () => {
		const document = await parse(await fixture('foreign-document.isdoc'));
		setSent(document, TIMESTAMP, 'test@example.cz');
		child(document.documentElement, 'Extensions')!.appendChild(extensionElement(document, 'SentAt', TIMESTAMP));

		expect(thrownBy(() => sentAt(document))).toEqual(new Error('ISDOC obsahuje více údajů Fakturianu o odeslání.'));
	});

	it('čas v CDATA přečte stejně jako prostý text', async () => {
		const source = await fixture('foreign-document.isdoc');
		const xml = source.replace(
			'<AccountingSupplierParty>',
			`<Extensions><fakturian:SentAt ${OUR_NAMESPACE}><![CDATA[ ${TIMESTAMP} ]]></fakturian:SentAt></Extensions><AccountingSupplierParty>`,
		);

		const document = await parse(xml);

		expect(sentAt(document)).toBe(TIMESTAMP);
	});

	it('komentář v údaji přeskočí, vnořený prvek odmítne', async () => {
		const xml = await fixture('foreign-document.isdoc');
		const marker = (content: string) =>
			xml.replace(
				'<AccountingSupplierParty>',
				`<Extensions><fakturian:SentAt ${OUR_NAMESPACE}>${content}</fakturian:SentAt></Extensions><AccountingSupplierParty>`,
			);

		const commented = await parse(marker(`<!--poznámka-->${TIMESTAMP}<?pi x?>`));
		const nested = await parse(marker('<fakturian:child/>'));

		expect(sentAt(commented)).toBe(TIMESTAMP);
		expect(thrownBy(() => sentAt(nested))).toEqual(new Error('Údaj Fakturianu v ISDOC nemá textovou hodnotu.'));
	});

	it('prvek s naším jménem v cizím jmenném prostoru údajem Fakturianu není', async () => {
		const source = await fixture('foreign-document.isdoc');
		const xml = source.replace(
			'<AccountingSupplierParty>',
			'<Extensions><x:SentAt xmlns:x="http://cizi.example/ext">včera</x:SentAt></Extensions><AccountingSupplierParty>',
		);

		const document = await parse(xml);

		expect(sentAt(document)).toBe(undefined);
	});

	it('jmenný prostor pozná i z deklarace na předkovi', async () => {
		const source = await fixture('foreign-document.isdoc');
		const xml = source.replace(
			'<AccountingSupplierParty>',
			`<Extensions ${OUR_NAMESPACE}><fakturian:SentAt>${TIMESTAMP}</fakturian:SentAt></Extensions><AccountingSupplierParty>`,
		);

		const document = await parse(xml);

		expect(sentAt(document)).toBe(TIMESTAMP);
	});

	it('neplatný čas v dokladu je poškozený doklad', async () => {
		const xml = await fixture('foreign-document.isdoc');
		const marker = (value: string) =>
			xml.replace(
				'<AccountingSupplierParty>',
				`<Extensions><fakturian:SentAt ${OUR_NAMESPACE}>${value}</fakturian:SentAt></Extensions><AccountingSupplierParty>`,
			);

		const words = await parse(marker('včera večer'));
		const month = await parse(marker('2026-13-29T10:15:00Z'));

		expect(thrownBy(() => sentAt(words))).toEqual(
			new Error('ISDOC obsahuje neplatný čas odeslání: „včera večer“ není čas ve tvaru RFC 3339'),
		);
		expect(thrownBy(() => sentAt(month))).toEqual(
			new Error('ISDOC obsahuje neplatný čas odeslání: „2026-13-29T10:15:00Z“ není platný čas'),
		);
	});

	it('čas musí být celý ve tvaru RFC 3339 a posun nejvýš 23 hodin', async () => {
		const document = await parse(await fixture('foreign-document.isdoc'));

		for (const at of [`x${TIMESTAMP}`, `${TIMESTAMP}x`, '2026-05-29T10:15:00+24:00']) {
			expect(thrownBy(() => setSent(document, at, 'test@example.cz'))).toEqual(
				new Error(`Čas odeslání nejde zapsat: „${at}“ není čas ve tvaru RFC 3339`),
			);
		}
		setSent(document, '2026-05-29T10:15:00+23:00', 'test@example.cz');
		expect(sentAt(document)).toBe('2026-05-29T10:15:00+23:00');
	});

	it('neplatný čas odmítne dřív, než doklad změní', async () => {
		const document = await parse(await fixture('foreign-document.isdoc'));
		const before = toXml(document);

		expect(thrownBy(() => setSent(document, 'zítra ráno', 'test@example.cz'))).toEqual(
			new Error('Čas odeslání nejde zapsat: „zítra ráno“ není čas ve tvaru RFC 3339'),
		);
		expect(thrownBy(() => setSent(document, '2026-02-30T10:15:00Z', 'test@example.cz'))).toEqual(
			new Error('Čas odeslání nejde zapsat: „2026-02-30T10:15:00Z“ není platný čas'),
		);
		expect(toXml(document)).toBe(before);
	});

	it('hodnotu, která by ukončila CDATA, zapíše jako escapovaný text', async () => {
		const document = await parse(await fixture('foreign-document.isdoc'));
		const before = toXml(document);

		setSent(document, TIMESTAMP, 'Petr & syn ]]>');

		expect(toXml(document)).toBe(
			before.replace(
				'<AccountingSupplierParty>',
				`<Extensions><fakturian:SentAt ${OUR_NAMESPACE}>${TIMESTAMP}</fakturian:SentAt><fakturian:SentBy ${OUR_NAMESPACE}>Petr &amp; syn ]]&gt;</fakturian:SentBy></Extensions><AccountingSupplierParty>`,
			),
		);
	});

	it('z dokladu bez údajů o odeslání nic nepřenese ani nezaloží Extensions', async () => {
		const bare = new DOMParser().parseFromString('<Invoice xmlns="http://isdoc.cz/namespace/2013"/>', 'text/xml');
		const target = await parse(await fixture('foreign-document.isdoc'));
		const before = toXml(target);

		const foreign = new DOMParser().parseFromString(
			'<Invoice xmlns="http://isdoc.cz/namespace/2013"><Extensions><x:a xmlns:x="urn:cizi"/></Extensions></Invoice>',
			'text/xml',
		);

		copySent(bare, target);
		copySent(foreign, target);

		expect(toXml(target)).toBe(before);
	});

	it('údaje o odeslání přenese beze změny a bez nich nic nepřidá', async () => {
		const original = await fixture('foreign-document.isdoc');
		const sent = await parse(original);
		setSent(sent, TIMESTAMP, 'Petr & syn');
		const stored = await parse(
			toXml(sent).replace(
				'</Extensions>',
				'<x:cizi xmlns:x="http://cizi.example/ext">nepřenáší se</x:cizi></Extensions>',
			),
		);
		const edited = await parse(original);

		const before = toXml(edited);
		copySent(stored, edited);
		const xml = toXml(edited);
		const untouched = await parse(original);
		copySent(await parse(original), untouched);

		expect(xml).toBe(
			before.replace(
				'<AccountingSupplierParty>',
				`<Extensions><fakturian:SentAt ${OUR_NAMESPACE}>${TIMESTAMP}</fakturian:SentAt><fakturian:SentBy ${OUR_NAMESPACE}><![CDATA[Petr & syn]]></fakturian:SentBy></Extensions><AccountingSupplierParty>`,
			),
		);
		expect(sentAt(await parse(xml))).toBe(TIMESTAMP);
		expect(toXml(untouched)).toBe(before);
	});
});

describe('rok čerpání limitu na řádku', () => {
	async function lineWith(extensions: string): Promise<Element> {
		const source = await fixture('foreign-document.isdoc');
		const xml = source.replace('</InvoiceLine>', `<Extensions>${extensions}</Extensions></InvoiceLine>`);
		const document = await parse(xml);
		return child(child(document.documentElement, 'InvoiceLines'), 'InvoiceLine')!;
	}

	const year = (value: string) => `<fakturian:UsageYear ${OUR_NAMESPACE}>${value}</fakturian:UsageYear>`;

	it('řádek bez roku rok nemá', async () => {
		const document = await parse(await fixture('foreign-document.isdoc'));
		const plain = child(child(document.documentElement, 'InvoiceLines'), 'InvoiceLine')!;
		const other = await lineWith(`<fakturian:SentAt ${OUR_NAMESPACE}>${TIMESTAMP}</fakturian:SentAt>`);

		expect(lineUsageYear(plain)).toBe(undefined);
		expect(lineUsageYear(other)).toBe(undefined);
	});

	it('krajní roky rozsahu přečte', async () => {
		expect(lineUsageYear(await lineWith(year('1000')))).toBe(1000);
		expect(lineUsageYear(await lineWith(year('9999')))).toBe(9999);
	});

	it('rok přečte i se znaménkem a nulami navíc', async () => {
		expect(lineUsageYear(await lineWith(year('2025')))).toBe(2025);
		expect(lineUsageYear(await lineWith(year('+02025')))).toBe(2025);
	});

	it('dva roky na řádku jsou rozpor', async () => {
		const line = await lineWith(`${year('2025')}${year('2026')}`);

		expect(thrownBy(() => lineUsageYear(line))).toEqual(
			new Error('řádek 1: ISDOC obsahuje více roků čerpání limitu.'),
		);
	});

	it('rok mimo rozsah formuláře nebo nečíselný odmítne', async () => {
		for (const value of ['25', '999', '10000', 'rok', '2025.0', '']) {
			const line = await lineWith(year(value));

			expect(thrownBy(() => lineUsageYear(line))).toEqual(
				new Error(`řádek 1: neplatný rok čerpání limitu „${value}“.`),
			);
		}
	});
});

describe('částky v ISDOC', () => {
	it('haléře píše v účetním tvaru', () => {
		expect(fromCents(120_000)).toBe('1200.00');
		expect(fromCents(0)).toBe('0.00');
		expect(fromCents(-5_000)).toBe('-50.00');
		expect(fromCents(37)).toBe('0.37');
	});

	it('xs:decimal převede na haléře přesně a půlku zaokrouhlí od nuly', () => {
		expect(toCents('1250.00')).toBe(125_000);
		expect(toCents(' 12.50 ')).toBe(1_250);
		expect(toCents('-50.00')).toBe(-5_000);
		expect(toCents('+7.')).toBe(700);
		expect(toCents('.21837')).toBe(22);
		expect(toCents('1.235')).toBe(124);
		expect(toCents('-1.235')).toBe(-124);
		expect(toCents('1.234')).toBe(123);
	});

	it('částku nad strop odmítne a strop sedí s frontendem', () => {
		expect(toCents(fromCents(MAX_CENTS))).toBe(MAX_CENTS);
		expect(toCents('90000000000.00')).toBe(9_000_000_000_000);
		expect(thrownBy(() => toCents('90000000000.01'))).toEqual(
			new Error('částka „90000000000.01“ přesahuje strop 90 miliard Kč'),
		);
		expect(thrownBy(() => toCents(' -90000000000.01 '))).toEqual(
			new Error('částka „-90000000000.01“ přesahuje strop 90 miliard Kč'),
		);
	});
});
