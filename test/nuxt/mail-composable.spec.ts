import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import { useMail } from '~/composables/useMail';

import { backend } from '../setup/backend';
import { prepareVault } from '../setup/vault';

beforeEach(async () => {
	await prepareVault();
});

describe('useMail', () => {
	it('s přílohou zkusí nejdřív Mail.app a dál nepokračuje', async () => {
		backend.returns('mail_compose_with_attachment', null);

		await useNuxtApp()
			.vueApp.runWithContext(useMail)
			.emailWithAttachment('a@b.cz', 'Faktura', 'Dobrý den', '/vault/f.pdf');

		expect(backend.args('mail_compose_with_attachment')).toEqual([
			{
				vaultPath: '/vault',
				to: 'a@b.cz',
				subject: 'Faktura',
				body: 'Dobrý den',
				attachment: '/vault/f.pdf',
			},
		]);
		expect(backend.open).toEqual([]);
	});

	it('bez datové složky skončí chybou složky, ne Mail.app ani mailto:', async () => {
		useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value = null;

		await expect(
			useNuxtApp()
				.vueApp.runWithContext(useMail)
				.emailWithAttachment('a@b.cz', 'Faktura', 'Dobrý den', '/vault/f.pdf'),
		).rejects.toThrow(new Error('Není zvolena datová složka'));

		expect(backend.args('mail_compose_with_attachment')).toEqual([]);
		expect(backend.open).toEqual([]);
	});

	it('bez přílohy jde rovnou na mailto:', async () => {
		await useNuxtApp().vueApp.runWithContext(useMail).emailWithAttachment('a@b.cz', 'Faktura', 'Dobrý den');

		expect(backend.args('mail_compose_with_attachment')).toEqual([]);
		expect(backend.open).toHaveLength(1);
		expect(backend.open[0]).toContain('mailto:');
	});

	it('když Mail.app selže, padá na mailto: a odhalí přílohu', async () => {
		backend.fails('mail_compose_with_attachment', 'automatizace zakázána');

		await useNuxtApp()
			.vueApp.runWithContext(useMail)
			.emailWithAttachment('a@b.cz', 'Faktura', 'Text', '/vault/f.pdf');

		expect(backend.open).toHaveLength(1);
		expect(backend.exposed).toEqual(['/vault/f.pdf']);

		await nextTick();
		const headings = useNuxtApp()
			.vueApp.runWithContext(useToast)
			.toasts.value.map((t) => t.title);
		expect(headings).toContain('Mail.app nevyšel — zpráva se připraví bez přílohy, PDF přetáhni z Finderu');
	});

	it('mailto: nese předmět i tělo zprávy', async () => {
		await useNuxtApp()
			.vueApp.runWithContext(useMail)
			.emailWithAttachment('a@b.cz', 'Faktura 20260001', 'Dobrý den,\nv příloze faktura.');

		expect(backend.open[0]).toBe(
			'mailto:a@b.cz?subject=Faktura%2020260001&body=Dobr%C3%BD%20den%2C%0Av%20p%C5%99%C3%ADloze%20faktura.',
		);
	});

	it('selhání mailto: nese chybu dál', async () => {
		backend.breaks('open_url', 'žádný výchozí poštovní klient');

		await expect(
			useNuxtApp().vueApp.runWithContext(useMail).emailWithAttachment('a@b.cz', 'Faktura', 'Text'),
		).rejects.toBe('žádný výchozí poštovní klient');
	});

	it('bez přílohy se ve Finderu nic neodhaluje', async () => {
		await useNuxtApp().vueApp.runWithContext(useMail).emailWithAttachment('a@b.cz', 'Faktura', 'Text');

		expect(backend.exposed).toEqual([]);
	});
});
