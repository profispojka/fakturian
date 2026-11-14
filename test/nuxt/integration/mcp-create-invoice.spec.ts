import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { czkFromCents } from '~/utils/money';

import { backend } from '../setup/backend';
import { summary } from '../setup/fixtures';
import {
	VACATION,
	completeContact,
	connectAgent,
	documentNumber,
	replyTo,
	responsesTo,
	usageInVault,
	vaultWithContent,
	toasts,
	McpHost,
} from '../setup/mcp-client';
import { answerDialog, layer, mountUi } from '../setup/mount';
import { documentInVault } from '../setup/vault';

/** Vystavení čeká na potvrzení v okně — test ho odklepne, jako by to udělal uživatel. */
async function issueConfirmed(args: unknown): Promise<{ result: unknown; error: string | null }> {
	await connectAgent();
	const id = backend.mcp.call('create_invoice', args);
	await answerDialog(true);
	return replyTo(id);
}

async function issue(args: unknown): Promise<{ result: unknown; error: string | null }> {
	await connectAgent();
	return replyTo(backend.mcp.call('create_invoice', args));
}

const CANCELLED = 'Agent volání zrušil, faktura se nevystavila.';
const row = {
	description: 'Práce',
	quantity: 1,
	unit: 'hod',
	unitPriceCents: 120_000,
};
const request = {
	customerName: 'Acme',
	lines: [row],
};
const betaRequest = {
	...request,
	customerName: 'Beta',
};
const BETA_QUESTION =
	`Agent chce vystavit fakturu pro „Beta" (IČO 25596641) na ${czkFromCents(120_000)}:\n` +
	`• Práce — 1 hod × ${czkFromCents(120_000)}\n` +
	'Doklad dostane číslo z řady; zrušit ho jde jen smazáním v appce.';
// 40 hodin z ročního limitu 160, s vazbou na ceník.
const vacationLine = {
	description: VACATION.name,
	quantity: 40,
	unit: 'hod',
	unitPriceCents: 120_000,
	itemId: VACATION.id,
};

describe('obsah a kontroly vystavené faktury', () => {
	beforeEach(async () => {
		await vaultWithContent({ contacts: [completeContact('k1', 'Acme')] });
	});

	it('vystaví fakturu a vazbu na ceník zapíše do dokladu', async () => {
		// Řádek z ceníku, ne ručně psaný — jinak není co vykazovat.
		const reply = await issueConfirmed({
			customerName: 'Acme',
			lines: [
				{
					description: VACATION.name,
					quantity: 8,
					unit: 'hod',
					unitPriceCents: 120_000,
				},
			],
		});

		expect(reply.error).toBeNull();
		// Vykázání nese doklad ve složce, ne druhá evidence — a je uložený, ne jen ohlášený.
		expect(backend.folder('/vault').invoices.get('20260001')?.lines).toEqual([
			expect.objectContaining({
				itemId: VACATION.id,
				quantity: 8,
			}),
		]);
		expect(reply.result).toEqual({
			number: '20260001',
			year: 2026,
			path: '/vault/faktury/20260001.pdf',
		});
	});

	it('odběratele najde bez ohledu na velikost písmen, mezery a diakritiku', async () => {
		const reply = await issueConfirmed({
			customerName: '  ácme  ',
			lines: [row],
		});

		expect(reply.error).toBeNull();
		expect(backend.args('save_invoice').map((a) => a.invoice)).toEqual([
			expect.objectContaining({ customer: expect.objectContaining({ name: 'Acme' }) }),
		]);
	});

	it('víceřádkovou poznámku ukáže v otázce na jednom řádku, aby nepodvrhla řádek dokladu', async () => {
		await connectAgent();
		backend.mcp.call('create_invoice', {
			...request,
			note: 'Za únor\n• Bonus — 1 ks × 0,00 Kč',
		});
		await vi.waitFor(() => expect(layer().find('[data-testid="dialog-message"]').exists()).toBe(true));

		expect(layer().find('[data-testid="dialog-message"]').text()).toBe(
			`Agent chce vystavit fakturu pro „Acme" (IČO 25596641) na ${czkFromCents(120_000)}:\n` +
				`• Práce — 1 hod × ${czkFromCents(120_000)}\n` +
				'Poznámka: Za únor ⏎ • Bonus — 1 ks × 0,00 Kč\n' +
				'Doklad dostane číslo z řady; zrušit ho jde jen smazáním v appce.',
		);
		await answerDialog(false);
	});

	it('před vystavením se zeptá v okně a ukáže komu, kolik, řádky i poznámku', async () => {
		await connectAgent();
		const id = backend.mcp.call('create_invoice', {
			customerName: 'Acme',
			note: 'Za únor',
			lines: [
				{
					...row,
					quantity: 1.5,
				},
			],
		});
		await vi.waitFor(() => expect(layer().find('[data-testid="dialog-heading"]').exists()).toBe(true));

		expect(layer().find('[data-testid="dialog-heading"]').text()).toBe('Vystavit fakturu od agenta?');
		expect(layer().find('[data-testid="dialog-message"]').text()).toBe(
			`Agent chce vystavit fakturu pro „Acme" (IČO 25596641) na ${czkFromCents(180_000)}:\n` +
				`• Práce — 1,5 hod × ${czkFromCents(120_000)}\n` +
				'Poznámka: Za únor\n' +
				'Doklad dostane číslo z řady; zrušit ho jde jen smazáním v appce.',
		);
		expect(backend.args('save_invoice')).toEqual([]);
		await answerDialog(true);
		await replyTo(id);
		expect(backend.args('save_invoice').map((a) => documentNumber(a.invoice))).toEqual(['20260001']);
	});

	it('odmítnuté potvrzení fakturu nevystaví a agentovi to řekne', async () => {
		await connectAgent();
		const id = backend.mcp.call('create_invoice', request);

		await answerDialog(false);
		const reply = await replyTo(id);

		expect(reply.error).toBe('Vystavení faktury uživatel v appce odmítl.');
		expect(backend.args('save_invoice')).toEqual([]);
		// Odmítnutí je odpověď uživatele, ne zrušení — hláška o zrušení by lhala.
		expect(toasts(CANCELLED)).toEqual([]);
	});

	it('číslo z řady přidělí až po potvrzení, ne před otázkou', async () => {
		await connectAgent();
		const id = backend.mcp.call('create_invoice', {
			customerName: 'Acme',
			lines: [row],
		});
		await vi.waitFor(() => expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(true));
		// Mezitím člověk ve formuláři vystavil doklad s číslem, které by agent jinak dostal.
		documentInVault(summary('20260001'));
		await answerDialog(true);
		await replyTo(id);

		expect(backend.args('save_invoice').map((a) => documentNumber(a.invoice))).toEqual(['20260002']);
	});

	it('neznámého odběratele odmítne', async () => {
		const reply = await issue({
			customerName: 'Nikdo',
			lines: [row],
		});

		expect(reply.error).toBe('Odběratel „Nikdo" není v seznamu.');
		expect(backend.args('save_invoice')).toEqual([]);
	});

	it('fakturu bez položek odmítne', async () => {
		const reply = await issue({
			customerName: 'Acme',
			lines: [],
		});

		expect(reply.error).toBe('Doklad nejde uložit (Přidej aspoň jednu položku.).');
	});

	it('slevu jako záporný řádek vystaví', async () => {
		const reply = await issueConfirmed({
			customerName: 'Acme',
			lines: [
				row,
				{
					description: 'Sleva',
					quantity: 1,
					unit: 'ks',
					unitPriceCents: -20_000,
				},
			],
		});

		expect(reply.error).toBeNull();
		expect(backend.folder('/vault').invoices.get('20260001')?.lines).toEqual([
			expect.objectContaining({ unitPriceCents: 120_000 }),
			expect.objectContaining({
				description: 'Sleva',
				unitPriceCents: -20_000,
			}),
		]);
	});

	it('fakturu se záporným součtem odmítne', async () => {
		const reply = await issue({
			customerName: 'Acme',
			lines: [
				row,
				{
					description: 'Sleva',
					quantity: 1,
					unit: 'ks',
					unitPriceCents: -120_001,
				},
			],
		});

		expect(reply.error).toBe('Doklad nejde uložit (Součet faktury nesmí být záporný.).');
		expect(backend.args('save_invoice')).toEqual([]);
	});

	it('nečíselné množství neprojde do ISDOC', async () => {
		const reply = await issue({
			customerName: 'Acme',
			lines: [
				{
					...row,
					quantity: 'hodně',
				},
			],
		});

		expect(reply.error).toBe('Neplatné argumenty (lines.0.quantity: Zadej číslo.).');
		expect(backend.args('save_invoice')).toEqual([]);
	});

	it('překročení ročního limitu zastaví i agenta', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime('2026-08-31T10:00');
		// Ze 160 hodin je 136 vykázaných **na jiném dokladu**, zbývá 24 — a nový by chtěl dalších 40.
		usageInVault('20260099', 136);

		const reply = await issue({
			customerName: 'Acme',
			lines: [vacationLine],
		});

		expect(reply.error).toBe(
			'Doklad nejde uložit (Položka „dovolená" překračuje roční limit pro rok 2026 — zbývá 24 hod.).',
		);
		expect(backend.args('save_invoice')).toEqual([]);
	});

	it('doklad předaný k uložení nese odběratele, položky i poznámku', async () => {
		await issueConfirmed({
			...request,
			note: 'Za únor',
		});

		const [calls] = backend.args('save_invoice');
		expect(calls?.invoice).toEqual(
			expect.objectContaining({
				number: '20260001',
				note: 'Za únor',
				lines: [
					{
						...row,
						usageYear: null,
					},
				],
				customer: expect.objectContaining({
					name: 'Acme',
					ico: '25596641',
				}),
			}),
		);
		expect(calls?.isNew).toBe(true);
	});

	it('odběratele, jehož jméno po normalizaci sedí na víc kontaktů, nevybírá', async () => {
		await vaultWithContent({ contacts: [completeContact('k1', 'Novák'), completeContact('k2', 'Novak')] });

		const reply = await issue({
			...request,
			customerName: 'novak',
		});

		expect(reply.error).toBe(
			// Za spojkou je nezlomitelná mezera, jak ji dává český `Intl.ListFormat`.
			'Jménu „novak" odpovídá víc odběratelů („Novák" a\u00A0„Novak"); rozliš je v appce jménem.',
		);
		expect(backend.args('save_invoice')).toEqual([]);
	});

	it('neexistující položku ceníku odmítne, místo aby ji tiše zahodil', async () => {
		const reply = await issue({
			customerName: 'Acme',
			lines: [
				{
					...row,
					itemId: 'p-neni',
				},
			],
		});

		expect(reply.error).toBe('Položka ceníku p-neni neexistuje.');
		expect(backend.args('save_invoice')).toEqual([]);
	});

	it('konec řádku v popisu položky odmítne, aby nepodvrhl řádek v otázce', async () => {
		const reply = await issue({
			customerName: 'Acme',
			lines: [
				{
					...row,
					description: 'Práce\n• Bonus — 1 ks × 0,00 Kč',
				},
			],
		});

		expect(reply.error).toBe('Neplatné argumenty (lines.0.description: Bez konců řádků a řídicích znaků.).');
	});

	it('řídicí znak v jednotce odmítne', async () => {
		const reply = await issue({
			customerName: 'Acme',
			lines: [
				{
					...row,
					unit: 'hod\u202E',
				},
			],
		});

		expect(reply.error).toBe('Neplatné argumenty (lines.0.unit: Bez konců řádků a řídicích znaků.).');
	});

	it('množství z nepřesného součtu v plovoucí čárce odmítne', async () => {
		const reply = await issue({
			customerName: 'Acme',
			lines: [
				{
					...row,
					quantity: 0.1 + 0.2,
				},
			],
		});

		expect(reply.error).toBe('Neplatné argumenty (lines.0.quantity: Zadej nejvýš dvě desetinná místa.).');
	});

	it('množství přesnější než na setiny odmítne jako formulář', async () => {
		const reply = await issue({
			customerName: 'Acme',
			lines: [
				{
					...row,
					quantity: 0.004,
				},
			],
		});

		expect(reply.error).toBe('Neplatné argumenty (lines.0.quantity: Zadej nejvýš dvě desetinná místa.).');
	});
});

describe('fronta, zrušení a selhání', () => {
	beforeEach(async () => {
		await vaultWithContent({ contacts: [completeContact('k1', 'Acme'), completeContact('k2', 'Beta')] });
	});

	it('když se faktura neuloží, ve složce nic nepřibude', async () => {
		backend.breaks('save_invoice', 'Faktura 20260001 už existuje.');

		const reply = await issueConfirmed(request);

		expect(reply.error).toBe('Faktura 20260001 už existuje.');
		expect(backend.folder('/vault').invoices.has('20260001')).toBe(false);
	});

	it('nedoručenou odpověď ohlásí varováním a fakturu nevystaví podruhé', async () => {
		backend.fails('mcp_send', 'Agent se od mostu odpojil.');
		await connectAgent();
		backend.mcp.call('create_invoice', request);

		await answerDialog(true);

		await vi.waitFor(() =>
			expect(toasts('Odpověď agentovi se nepodařilo doručit')).toEqual([
				{
					description: 'Agent se od mostu odpojil.',
					color: 'warning',
				},
			]),
		);
		expect(backend.args('save_invoice').map((a) => documentNumber(a.invoice))).toEqual(['20260001']);
	});

	it('druhé vystavení počká, až doběhne první, a dostane další číslo', async () => {
		await connectAgent();
		const first = backend.mcp.call('create_invoice', request);
		await vi.waitFor(() => expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(true));
		const second = backend.mcp.call('create_invoice', betaRequest);

		// Dialog se po odpovědi hned otevře znovu pro druhou fakturu, `answerDialog` by čekal na zavření.
		await layer().find('[data-testid="dialog-confirm"]').trigger('click');
		const issued = await replyTo(first);
		// Druhá otázka přijde až po uložení první faktury, ne vedle ní.
		await vi.waitFor(() => expect(layer().find('[data-testid="dialog-message"]').text()).toBe(BETA_QUESTION));
		await answerDialog(true);
		const queued = await replyTo(second);

		expect(issued.error).toBeNull();
		expect(queued.error).toBeNull();
		expect(backend.args('save_invoice').map((a) => documentNumber(a.invoice))).toEqual(['20260001', '20260002']);
	});

	it('odmítnuté vystavení frontu uvolní pro další', async () => {
		await connectAgent();
		const first = backend.mcp.call('create_invoice', request);
		await vi.waitFor(() => expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(true));
		const second = backend.mcp.call('create_invoice', betaRequest);

		// Dialog se po odpovědi hned otevře znovu pro druhou fakturu, `answerDialog` by čekal na zavření.
		await layer().find('[data-testid="dialog-cancel"]').trigger('click');
		const refused = await replyTo(first);
		await vi.waitFor(() => expect(layer().find('[data-testid="dialog-message"]').text()).toBe(BETA_QUESTION));
		await answerDialog(true);
		const issued = await replyTo(second);

		expect(refused.error).toBe('Vystavení faktury uživatel v appce odmítl.');
		expect(issued.error).toBeNull();
		expect(backend.args('save_invoice').map((a) => documentNumber(a.invoice))).toEqual(['20260001']);
	});

	it('vystavení, které agent zrušil ve frontě, se na nic neptá', async () => {
		await connectAgent();
		const first = backend.mcp.call('create_invoice', request);
		await vi.waitFor(() => expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(true));
		const second = backend.mcp.call('create_invoice', betaRequest);
		backend.mcp.cancel(second);

		await answerDialog(true);
		await replyTo(first);
		await flushPromises();

		expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(false);
		expect(responsesTo(second)).toEqual([]);
		// Na nic se neptal, takže uživateli není co vysvětlovat.
		expect(toasts(CANCELLED)).toEqual([]);
		expect(backend.args('save_invoice').map((a) => documentNumber(a.invoice))).toEqual(['20260001']);
	});

	it('po dokončeném vystavení pustí další', async () => {
		await issueConfirmed(request);

		const id = backend.mcp.call('create_invoice', betaRequest);
		await answerDialog(true);

		const reply = await replyTo(id);
		expect(reply.error).toBeNull();
		expect(backend.args('save_invoice').map((a) => documentNumber(a.invoice))).toEqual(['20260001', '20260002']);
	});

	it('zrušení během otázky ji zavře, uživateli to řekne a agentovi neodpoví', async () => {
		await connectAgent();
		const id = backend.mcp.call('create_invoice', request);
		await vi.waitFor(() => expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(true));

		backend.mcp.cancel(id);

		await vi.waitFor(() => expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(false));
		expect(toasts(CANCELLED)).toEqual([
			{
				description: undefined,
				color: 'warning',
			},
		]);
		expect(backend.args('save_invoice')).toEqual([]);
		expect(responsesTo(id)).toEqual([]);
	});

	it('odpojený agent zavře otázku stejně jako zrušení', async () => {
		await connectAgent();
		backend.mcp.call('create_invoice', request);
		await vi.waitFor(() => expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(true));

		backend.mcp.deliver({ session: 1 });

		await vi.waitFor(() => expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(false));
		expect(toasts(CANCELLED)).toEqual([
			{
				description: undefined,
				color: 'warning',
			},
		]);
		expect(backend.args('save_invoice')).toEqual([]);
	});

	it('zavřené okno otázku zruší a fakturu nevystaví', async () => {
		const host = mountUi(McpHost);
		await flushPromises();
		const id = backend.mcp.call('create_invoice', request);
		await vi.waitFor(() => expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(true));

		host.unmount();

		await vi.waitFor(() =>
			expect(toasts(CANCELLED)).toEqual([
				{
					description: undefined,
					color: 'warning',
				},
			]),
		);
		expect(backend.args('save_invoice')).toEqual([]);
		expect(responsesTo(id)).toEqual([]);
	});

	it('zrušení před otázkou ji vůbec neotevře', async () => {
		const reading = backend.postpone('list_invoices');
		await connectAgent();
		const id = backend.mcp.call('create_invoice', request);
		await vi.waitFor(() => expect(backend.args('list_invoices')).toHaveLength(1));

		backend.mcp.cancel(id);
		reading.finish();

		await vi.waitFor(() =>
			expect(toasts(CANCELLED)).toEqual([
				{
					description: undefined,
					color: 'warning',
				},
			]),
		);
		expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(false);
		expect(backend.args('save_invoice')).toEqual([]);
	});

	it('limit vyčerpaný jiným dokladem během otázky zastaví i potvrzenou fakturu', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime('2026-08-31T10:00');
		await connectAgent();
		const id = backend.mcp.call('create_invoice', {
			customerName: 'Acme',
			lines: [vacationLine],
		});
		await vi.waitFor(() => expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(true));
		// Mezitím člověk ve formuláři vykázal 136 ze 160 hodin.
		usageInVault('20260099', 136);

		await answerDialog(true);
		const reply = await replyTo(id);

		expect(reply.error).toBe(
			'Doklad nejde uložit (Položka „dovolená" překračuje roční limit pro rok 2026 — zbývá 24 hod.).',
		);
		expect(backend.args('save_invoice')).toEqual([]);
	});

	it('selhání po potvrzení zrušeného požadavku uživateli ohlásí', async () => {
		await connectAgent();
		const id = backend.mcp.call('create_invoice', request);
		const saving = backend.postpone('save_invoice');
		await answerDialog(true);

		backend.mcp.cancel(id);
		backend.breaks('save_invoice', 'Disk je plný.');
		saving.finish();

		await vi.waitFor(() =>
			expect(toasts('Fakturu od agenta se nepodařilo vystavit')).toEqual([
				{
					description: 'Disk je plný.',
					color: 'error',
				},
			]),
		);
		expect(responsesTo(id)).toEqual([]);
	});

	it('zrušení během ukládání fakturu nezastaví, ale uživateli řekne, že agent o ní neví', async () => {
		const uncaught = vi.fn();
		window.addEventListener('error', uncaught);
		const saving = backend.postpone('save_invoice');
		await connectAgent();
		const id = backend.mcp.call('create_invoice', request);
		await answerDialog(true);

		backend.mcp.cancel(id);
		saving.finish();

		await vi.waitFor(() =>
			expect(toasts('Faktura 20260001 je vystavená, ale agent na odpověď už nečekal.')).toEqual([
				{
					description: undefined,
					color: 'warning',
				},
			]),
		);
		expect(backend.folder('/vault').invoices.has('20260001')).toBe(true);
		expect(responsesTo(id)).toEqual([]);
		// Pozdní zrušení nesmí sahat na dialog, který už `useOverlay` zahodil.
		window.removeEventListener('error', uncaught);
		expect(uncaught).not.toHaveBeenCalled();
	});
});
