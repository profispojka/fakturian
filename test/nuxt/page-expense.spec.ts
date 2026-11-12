import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import { useExpensesFile } from '~/composables/useExpenses';
import { canDiscardUnsaved } from '~/composables/useForm';

import { backend } from '../setup/backend';
import { date } from '../setup/dates';
import { mountPage, answerDialog, currentPath, goto, layer, enterDate } from '../setup/mount';
import { savedField, prepareVault } from '../setup/vault';

import type { Expense } from '~/schemas/expenses';

function expense(id: string, over: Partial<Expense> = {}): Expense {
	return {
		id,
		supplier: 'Server s.r.o.',
		description: 'Hosting',
		amountCents: 500_00,
		date: date('2026-03-01'),
		...over,
	};
}

async function vaultWithExpenses(...expenses: Expense[]): Promise<void> {
	await prepareVault({
		'vydaje.json': {
			expenses: expenses,
		},
	});
	backend.returns('received_path', '/vault/prijate/x.pdf');
}

function savedExpenses(): Expense[] {
	return savedField('vydaje.json', 'expenses');
}

beforeEach(async () => {
	await vaultWithExpenses();
});

describe('nový výdaj', () => {
	it('bez id v adrese je to nový výdaj s dnešním datem', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime('2026-03-05T10:00');
		const c = await mountPage('/expense/new');

		expect(c.find('[data-testid="expense-title"]').text()).toContain('Nový výdaj');
		expect(
			['day', 'month', 'year'].map((s) => c.find(`[data-testid="field-date"] [data-segment="${s}"]`).text()),
		).toEqual(['5', '3', '2026']);
	});

	it('uloží vyplněný výdaj a vrátí se na výpis', async () => {
		const c = await mountPage('/expense/new');
		await c.find('[data-testid="field-supplier"]').setValue('Server s.r.o.');
		await c.find('[data-testid="field-amountCzk"]').setValue('500');
		await c.find('[data-testid="field-amountCzk"]').trigger('blur');

		await c.find('[data-testid="expense-save"]').trigger('click');
		await flushPromises();

		const saved = savedExpenses()[0]!;
		expect(saved.supplier).toBe('Server s.r.o.');
		expect(saved.amountCents).toBe(500_00);
		await vi.waitFor(() => expect(currentPath()).toBe('/expense'));
	});

	it('bez dodavatele se neuloží a řekne proč', async () => {
		const c = await mountPage('/expense/new');
		await c.find('[data-testid="field-amountCzk"]').setValue('500');
		await c.find('[data-testid="field-amountCzk"]').trigger('blur');

		await c.find('[data-testid="expense-save"]').trigger('click');
		await flushPromises();

		expect(savedExpenses()).toEqual([]);
		expect(c.find('[data-testid="field-supplier"]').attributes('aria-invalid')).toBe('true');
		expect(c.find('[data-testid="field-amountCzk"]').attributes('aria-invalid')).toBe('false');
	});

	it('bez částky se neuloží a řekne proč', async () => {
		const c = await mountPage('/expense/new');
		await c.find('[data-testid="field-supplier"]').setValue('Server s.r.o.');

		await c.find('[data-testid="expense-save"]').trigger('click');
		await flushPromises();

		expect(savedExpenses()).toEqual([]);
		expect(c.find('[data-testid="field-amountCzk"]').attributes('aria-invalid')).toBe('true');
		expect(c.find('[data-testid="field-supplier"]').attributes('aria-invalid')).toBe('false');
	});

	it('bez data se neuloží a řekne proč', async () => {
		const c = await mountPage('/expense/new');
		await c.find('[data-testid="field-supplier"]').setValue('Server s.r.o.');
		await c.find('[data-testid="field-amountCzk"]').setValue('500');
		await c.find('[data-testid="field-amountCzk"]').trigger('blur');
		await enterDate(c.find('[data-testid="field-date"]'), undefined);

		await c.find('[data-testid="expense-save"]').trigger('click');
		await flushPromises();

		expect(savedExpenses()).toEqual([]);
		expect(c.find('[data-testid="field-date"]').attributes('aria-invalid')).toBe('true');
		expect(c.find('[data-testid="field-amountCzk"]').attributes('aria-invalid')).toBe('false');
	});

	it('chybu při ukládání ukáže a na výpis neodejde', async () => {
		backend.breaks('write_data_file', 'vault je jen ke čtení');
		const c = await mountPage('/expense/new');
		await c.find('[data-testid="field-supplier"]').setValue('Server s.r.o.');
		await c.find('[data-testid="field-amountCzk"]').setValue('500');
		await c.find('[data-testid="field-amountCzk"]').trigger('blur');

		await c.find('[data-testid="expense-save"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Výdaj se nepodařilo uložit',
				description: 'vault je jen ke čtení',
				color: 'error',
			}),
		);
		expect(currentPath()).toBe('/expense/new');
	});
});

describe('úprava existujícího výdaje', () => {
	it('podle id z adresy vyplní formulář', async () => {
		await vaultWithExpenses(
			expense('v1', {
				supplier: 'Acme',
				amountCents: 1234_00,
			}),
		);
		const c = await mountPage('/expense/v1');

		expect(c.find('[data-testid="expense-title"]').text()).toContain('Výdaj');
		expect(c.find<HTMLInputElement>('[data-testid="field-supplier"]').element.value).toBe('Acme');
		expect(c.find<HTMLInputElement>('[data-testid="field-amountCzk"]').element.value).toBe('1\u00A0234');
	});

	it('neznámé id ohlásí jako smazaný výdaj', async () => {
		const c = await mountPage('/expense/neexistuje');

		expect(c.find('[data-testid="empty-state"]').text()).toContain('v evidenci není');
	});

	it('před načtením dat o ztraceném výdaji mlčí', async () => {
		useNuxtApp().vueApp.runWithContext(useExpensesFile).loaded.value = false;
		const c = await mountPage('/expense/v1');

		expect(c.find('[data-testid="empty-state"]').exists()).toBe(false);
	});

	it('dočtení souboru rozepsanou úpravu nepřepíše', async () => {
		await vaultWithExpenses(expense('v1', { supplier: 'Acme' }));
		const c = await mountPage('/expense/v1');
		await c.find('[data-testid="field-supplier"]').setValue('Acme — opraveno');

		await vaultWithExpenses(expense('v1', { supplier: 'Acme' }), expense('v2'));
		await nextTick();

		expect(c.find<HTMLInputElement>('[data-testid="field-supplier"]').element.value).toBe('Acme — opraveno');
	});

	it('po dopočtení dat se výdaj doplní', async () => {
		useNuxtApp().vueApp.runWithContext(useExpensesFile).loaded.value = false;
		const c = await mountPage('/expense/v1');

		await vaultWithExpenses(expense('v1', { supplier: 'Doplněno' }));
		useNuxtApp().vueApp.runWithContext(useExpensesFile).loaded.value = true;
		await nextTick();

		expect(c.find<HTMLInputElement>('[data-testid="field-supplier"]').element.value).toBe('Doplněno');
	});

	it('přepnutí na nový výdaj smaže přílohu', async () => {
		await vaultWithExpenses(expense('v1', { documentFile: 'prijate/x.pdf' }));
		const c = await mountPage('/expense/v1');
		expect(c.find('[data-testid="expense-document"]').exists()).toBe(true);

		await goto('/expense/new');
		await nextTick();

		expect(c.find('[data-testid="expense-document"]').exists()).toBe(false);
	});

	it('uloží popis i datum', async () => {
		const c = await mountPage('/expense/new');
		await c.find('[data-testid="field-supplier"]').setValue('Doména');
		await c.find('[data-testid="field-description"]').setValue('registrace fakturian.cz');
		await c.find('[data-testid="field-amountCzk"]').setValue('320');
		await c.find('[data-testid="field-amountCzk"]').trigger('blur');
		await enterDate(c.find('[data-testid="field-date"]'), date('2026-02-14'));

		await c.find('[data-testid="expense-save"]').trigger('click');
		await flushPromises();

		expect(savedExpenses()[0]).toEqual({
			id: expect.any(String),
			supplier: 'Doména',
			description: 'registrace fakturian.cz',
			amountCents: 320_00,
			date: '2026-02-14',
		});
	});
});

describe('přiložený doklad', () => {
	it('u výdaje s dokladem nabídne otevření ve Finderu', async () => {
		await vaultWithExpenses(expense('v1', { documentFile: 'prijate/invoice.pdf' }));
		const c = await mountPage('/expense/v1');

		expect(c.find('[data-testid="expense-document"]').text()).toContain('prijate/invoice.pdf');
		await c.find('[data-testid="expense-document"] button').trigger('click');
		await flushPromises();

		expect(backend.exposed).toEqual(['/vault/prijate/x.pdf']);
	});

	it('bez dokladu se nic neodhaluje', async () => {
		const c = await mountPage('/expense/new');

		expect(c.find('[data-testid="expense-document"]').exists()).toBe(false);
	});

	it('doklad, který Finder neukáže, se ohlásí', async () => {
		await vaultWithExpenses(expense('v1', { documentFile: 'prijate/invoice.pdf' }));
		backend.breaks('reveal_path', 'Soubor neexistuje');
		const c = await mountPage('/expense/v1');

		await c.find('[data-testid="expense-document-reveal"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Doklad se nepodařilo ukázat ve Finderu',
				description: 'Soubor neexistuje',
				color: 'error',
			}),
		);
	});
});

describe('rozepsaný výdaj', () => {
	it('odchod s rozepsaným výdajem se ptá', async () => {
		const c = await mountPage('/expense/new');
		await c.find('[data-testid="field-supplier"]').setValue('Rozepsaný');
		await c.find('[data-testid="field-amountCzk"]').setValue('500');
		await c.find('[data-testid="field-amountCzk"]').trigger('blur');

		const leaving = goto('/expense');
		await answerDialog(true);
		await leaving;

		expect(currentPath()).toBe('/expense');
	});

	it('odmítnutím se na stránce zůstane', async () => {
		const c = await mountPage('/expense/new');
		await c.find('[data-testid="field-supplier"]').setValue('Rozepsaný');
		await c.find('[data-testid="field-amountCzk"]').setValue('500');
		await c.find('[data-testid="field-amountCzk"]').trigger('blur');

		const leaving = goto('/expense');
		await answerDialog(false);
		await leaving;

		expect(currentPath()).toBe('/expense/new');
	});

	it('bez změn se odchod neptá', async () => {
		await mountPage('/expense/new');

		await goto('/expense');

		expect(currentPath()).toBe('/expense');
		expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(false);
	});

	it('zavření okna s rozepsaným výdajem se ptá', async () => {
		const c = await mountPage('/expense/new');
		await c.find('[data-testid="field-supplier"]').setValue('Rozepsaný');
		await c.find('[data-testid="field-amountCzk"]').setValue('500');
		await c.find('[data-testid="field-amountCzk"]').trigger('blur');

		const closing = canDiscardUnsaved();
		await flushPromises();
		expect(layer().find('[data-testid="dialog-heading"]').text()).toBe('Zahodit neuložené změny?');

		await answerDialog(false);

		expect(await closing).toBe(false);
	});

	it('po uložení se odchod už neptá', async () => {
		const c = await mountPage('/expense/new');
		await c.find('[data-testid="field-supplier"]').setValue('Server s.r.o.');
		await c.find('[data-testid="field-amountCzk"]').setValue('500');
		await c.find('[data-testid="field-amountCzk"]').trigger('blur');
		await c.find('[data-testid="expense-save"]').trigger('click');
		await flushPromises();

		await goto('/expense');

		expect(currentPath()).toBe('/expense');
		expect(layer().find('[data-testid="dialog-confirm"]').exists()).toBe(false);
	});

	it('výměna výdaje na téže stránce se ptá taky', async () => {
		const c = await mountPage('/expense/new');
		await c.find('[data-testid="field-supplier"]').setValue('Rozepsaný');
		await c.find('[data-testid="field-amountCzk"]').setValue('500');
		await c.find('[data-testid="field-amountCzk"]').trigger('blur');

		const swapping = goto('/expense/v1');
		await answerDialog(true);
		await swapping;

		expect(currentPath()).toBe('/expense/v1');
	});
});

describe('klávesová zkratka ⌘S', () => {
	it('Uložit je tlačítko, které mačká ⌘S', async () => {
		const c = await mountPage('/expense/new');

		expect(c.find('[data-testid="expense-save"]').attributes('data-save')).toBe('');
	});

	it('u smazaného výdaje je Uložit zamčené', async () => {
		const c = await mountPage('/expense/neexistuje');

		expect(c.find('[data-testid="expense-save"]').attributes('disabled')).toBe('');
	});
});
