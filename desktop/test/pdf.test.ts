import { NodeCompiler, NodeTypstCompileResult } from '@myriaddreamin/typst-ts-node-compiler';
import { describe, expect, it, vi } from 'vitest';

import { thrownBy } from './support.ts';
import { imageCount, printedText } from './typst.ts';

import { qrPng } from '../invoice/payment.ts';
import { compileTypst, pdfModDate, renderTypstPdf, renderTypstSvg } from '../pdf.ts';

const INSTANT = '2026-09-30T12:34:56.789Z';

const QR_SOURCE = `#set page(paper: "a4")
Faktura s QR platbou:
#image("qr.png", width: 4cm, alt: "QR kód pro platbu faktury")
`;

describe('překlad typstu', () => {
	it('vysází zdroj se soubory, které dostane', () => {
		const document = compileTypst('#let data = json("data.json")\n#data.text', {
			'data.json': new TextEncoder().encode('{"text": "Ahoj z JSON"}'),
		});

		expect(printedText(document)).toEqual(['Ahoj z JSON']);
	});

	it('soubor předchozího překladu v dalším není', () => {
		compileTypst(QR_SOURCE, { 'qr.png': qrPng('první') });

		expect(thrownBy(() => compileTypst(QR_SOURCE, {}))).toEqual(
			new Error('Doklad se nepodařilo vysázet.', {
				cause: new Error(
					'[{"message":"file not found (searched at /fakturian/qr.png)","package":"","path":"/fakturian/main.typ","range":{"end":{"character":15,"line":2},"start":{"character":7,"line":2}},"severity":1}]',
				),
			}),
		);
	});

	it('překlad bez dokumentu i bez chyby ohlásí', () => {
		const silent = vi.spyOn(NodeTypstCompileResult.prototype, 'takeError').mockImplementation(() => null);
		try {
			expect(thrownBy(() => compileTypst('#invalid-syntax(', {}))).toEqual(
				new Error('Doklad se nepodařilo vysázet.'),
			);
		} finally {
			silent.mockRestore();
		}
	});

	it('nevalidní zdroj vrátí chybu překladu, ne pád', () => {
		expect(thrownBy(() => compileTypst('#invalid-syntax(', {}))).toEqual(
			new Error('Doklad se nepodařilo vysázet.', {
				cause: new Error(
					'[{"message":"unclosed delimiter","package":"","path":"/fakturian/main.typ","range":{"end":{"character":16,"line":0},"start":{"character":15,"line":0}},"severity":1}]',
				),
			}),
		);
	});
});

describe('PDF z typstu', () => {
	it('vysází PDF s obrázkem QR kódu a razítkem vzniku v UTC', () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(INSTANT);
		let pdf: Uint8Array;
		try {
			pdf = renderTypstPdf(QR_SOURCE, {
				'qr.png': qrPng('SPD*1.0*ACC:CZ6508000000192000145399*AM:1000.00*CC:CZK'),
			});
		} finally {
			vi.useRealTimers();
		}
		const text = new TextDecoder('latin1').decode(pdf);

		expect(text.slice(0, 5)).toBe('%PDF-');
		expect(imageCount(pdf)).toBe(1);
		expect(/\/CreationDate\((D:\d{14}Z)\)/.exec(text)?.[1]).toBe('D:20260930123456Z');
		expect(/<pdfaid:part>(\d)<\/pdfaid:part>/.exec(text)?.[1]).toBe('3');
		expect(/<pdfaid:conformance>(\w)<\/pdfaid:conformance>/.exec(text)?.[1]).toBe('A');
	});

	it('příloha bez popisu neprojde PDF/A-3a a chyba to řekne', () => {
		const source = 'Doklad\n#pdf.attach("invoice.isdoc", relationship: "source", mime-type: "text/xml")';
		const files = { 'invoice.isdoc': new TextEncoder().encode('<Invoice/>') };

		expect(thrownBy(() => renderTypstPdf(source, files))).toEqual(
			new Error('Doklad se nepodařilo uložit jako PDF.', {
				cause: expect.objectContaining({
					message: expect.stringContaining('PDF/A-3a error: the file description is missing'),
				}),
			}),
		);
	});
});

describe('SVG z typstu', () => {
	it('každou stranu vydá jako samostatné SVG', () => {
		const pages = renderTypstSvg('#set page(width: 100pt, height: 50pt)\nPrvní\n#pagebreak()\nDruhá', {});

		expect(pages.map((page) => page.slice(0, page.indexOf(' xmlns=')))).toEqual([
			'<svg viewBox="0 0 100 50" width="100pt" height="50pt"',
			'<svg viewBox="0 50 100 50" width="100pt" height="50pt"',
		]);
	});

	it('SVG bez čekané hlavičky odmítne, místo aby každá strana nesla celý dokument', () => {
		const svg = vi
			.spyOn(NodeCompiler.prototype, 'plainSvg')
			.mockImplementation(() => '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
		try {
			expect(thrownBy(() => renderTypstSvg('Strana', {}))).toEqual(
				new Error('Náhled dokladu se nepodařilo připravit.'),
			);
		} finally {
			svg.mockRestore();
		}
	});

	it('jednostránkový doklad je jedno SVG', () => {
		const [page, ...rest] = renderTypstSvg('Jediná strana', {});

		expect([page?.slice(0, 4), rest]).toEqual(['<svg', []]);
	});
});

describe('datum změny přílohy', () => {
	function modDateAt(time: number | string): string {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(time);
		try {
			return pdfModDate();
		} finally {
			vi.useRealTimers();
		}
	}

	it('píše UTC ve tvaru PDF', () => {
		expect([modDateAt(0), modDateAt(INSTANT)]).toEqual(['D:19700101000000Z', 'D:20260930123456Z']);
	});

	it('čas před rokem 1970 zaokrouhlí dolů, ne k epoše', () => {
		expect(modDateAt(-500)).toBe('D:19691231235959Z');
	});
});
