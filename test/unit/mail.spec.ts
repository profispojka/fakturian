import { describe, expect, it } from 'vitest';

import { defaultInvoiceMail, mailtoUrl } from '~/utils/mail';

describe('mailtoUrl', () => {
	it('kóduje předmět a tělo s %20', () => {
		expect(mailtoUrl('a@b.cz', 'Faktura 1', 'Dobrý den')).toBe(
			'mailto:a@b.cz?subject=Faktura%201&body=Dobr%C3%BD%20den',
		);
	});

	it('bez předmětu/těla jen adresa', () => {
		expect(mailtoUrl('a@b.cz', '', '')).toBe('mailto:a@b.cz');
	});

	it('zachová víceřádkové tělo', () => {
		const url = mailtoUrl('x@y.cz', 'Předmět', 'řádek1\nřádek2');
		expect(url).toContain('body=');
		expect(url).toContain('%0A'); // newline
		expect(url.startsWith('mailto:x@y.cz?')).toBe(true);
	});
});

describe('defaultInvoiceMail', () => {
	it('vrací předmět s číslem faktury a tělo se zformátovanou částkou', () => {
		const { subject, body } = defaultInvoiceMail('2026-0001', 123_400);
		expect(subject).toBe('Faktura 2026-0001');
		expect(body).toContain('2026-0001');
		expect(body).toContain('na částku 1 234,00 Kč.');
		expect(body).toContain('Dobrý den');
		expect(body).toContain('S pozdravem');
	});

	it('tělo je víceřádkové (mailto kódování pak vloží %0A)', () => {
		const { body } = defaultInvoiceMail('1', 0);
		expect(body.split('\n')).toEqual([
			'Dobrý den,',
			'',
			'v příloze zasílám fakturu 1 na částku 0,00\u00a0Kč.',
			'',
			'S pozdravem',
		]);
	});
});

describe('mailtoUrl — injekce hlaviček', () => {
	it('adresa nevyrobí další hlavičku', () => {
		const url = mailtoUrl('klient@firma.cz?bcc=utocnik@evil.example&', 'P', 'B');
		expect(url).not.toContain('?bcc=');
		expect(url.split('?').length).toBe(2);
	});

	it('zalomení řádku v adrese se zakóduje', () => {
		expect(mailtoUrl('a@b.cz%0Abcc:evil@x.com', '', '')).not.toContain('%0Abcc');
	});

	it('běžná adresa zůstane čitelná', () => {
		expect(mailtoUrl('jan.novak@firma.cz', '', '')).toBe('mailto:jan.novak@firma.cz');
	});
});
