import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useExpenses } from '~/composables/useExpenses';
import { czkFromCents } from '~/utils/money';

import { backend, finderFile } from '../setup/backend';
import { date } from '../setup/dates';
import { mountPage, currentPath, answerDialog, layer } from '../setup/mount';
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

function mount() {
	return mountPage('/expense');
}

async function vaultWithExpenses(...expenses: Expense[]): Promise<void> {
	await prepareVault({
		'vydaje.json': {
			expenses: expenses,
		},
	});
	backend.returns('received_path', '/vault/prijate/x.pdf');
}

/** Co nativní vrstva přečte z PDF — **surový doklad**, ne hotový výdaj. */
function receivedDocument(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		file: 'prijate/x.pdf',
		supplier: 'Server s.r.o.',
		supplierIco: '',
		number: '',
		uuid: '',
		description: 'Hosting',
		amountCents: 500_00,
		date: '2026-03-01',
		recipientIco: '',
		...over,
	};
}

function documentReturns(over: Record<string, unknown> = {}): void {
	backend.keepsReturning('import_received', receivedDocument(over));
}

function savedExpenses(): Expense[] {
	return savedField('vydaje.json', 'expenses');
}

/** Pošle stránce událost přetažení, jak ji Chromium posílá při tažení z Finderu. */
function drag(type: string, transfer: { types: string[]; files: File[] } | null): void {
	const event = new Event(type, {
		bubbles: true,
		cancelable: true,
	});
	Object.defineProperty(event, 'dataTransfer', { value: transfer });
	document.querySelector('[data-testid="expenses-footer"]')!.dispatchEvent(event);
}

function dropFiles(...paths: string[]): void {
	drag('drop', {
		types: ['Files'],
		files: paths.map((path) => finderFile(path)),
	});
}

beforeEach(async () => {
	await vaultWithExpenses();
});

describe('výpis výdajů', () => {
	it('klik na řádek výdaj jen označí', async () => {
		await vaultWithExpenses(
			expense('v1', { date: date('2026-03-01') }),
			expense('v2', { date: date('2026-02-01') }),
		);
		const c = await mount();

		await c.find('[data-testid="expense-entry-v2"]').trigger('click');
		expect(c.find('[data-testid="expense-entry-v2"]').attributes('data-selected')).toBe('true');
		expect(c.find('[data-testid="expense-entry-v1"]').attributes('data-selected')).toBeUndefined();
		await flushPromises();

		expect(currentPath()).toBe('/expense');
	});

	it('dvojklik na řádek otevře výdaj', async () => {
		await vaultWithExpenses(
			expense('v1', { date: date('2026-03-01') }),
			expense('v2', { date: date('2026-02-01') }),
		);
		const c = await mount();

		await c.find('[data-testid="expense-entry-v2"]').trigger('click', { detail: 2 });

		await vi.waitFor(() => expect(currentPath()).toBe('/expense/v2'));
	});

	it('bez výdajů to řekne', async () => {
		const c = await mount();
		expect(c.find('[data-testid="empty-state"]').text()).toContain('Zatím žádné výdaje');
	});

	it('vypíše výdaj i s částkou', async () => {
		await vaultWithExpenses(
			expense('v1', {
				supplier: 'Server s.r.o.',
				amountCents: 1234_00,
			}),
		);
		const c = await mount();

		expect(c.find('[data-testid="expense-edit"]').text()).toContain('Server s.r.o.');
		expect(c.find('[data-testid="expense-table"]').text()).toContain(czkFromCents(1234_00));
	});

	it('výdaj bez dodavatele vyzve k doplnění i v nabídce akcí', async () => {
		await vaultWithExpenses(expense('v1', { supplier: '' }));

		const c = await mount();
		expect(c.find('[data-testid="expense-edit"]').text()).toContain('Doplnit údaje');

		await c.find('[data-testid="expense-actions-v1"]').trigger('click');
		await flushPromises();
		expect(layer().find('[data-testid="expense-actions-heading"]').text()).toBe('Doplnit údaje');
	});

	it('výdaj bez popisu ukáže jen dodavatele', async () => {
		await vaultWithExpenses(expense('v1', { description: '' }));

		const c = await mount();
		expect(c.find('[data-testid="expense-edit"]').text()).toBe('Server s.r.o.');
	});

	it('klik na dodavatele otevře výdaj', async () => {
		await vaultWithExpenses(expense('v1'));
		const c = await mount();

		await c.find('[data-testid="expense-edit"]').trigger('click');
		await vi.waitFor(() => expect(currentPath()).toBe('/expense/v1'));
	});
});

describe('hledání', () => {
	it('hledání zúží výpis', async () => {
		await vaultWithExpenses(expense('v1', { supplier: 'Server' }), expense('v2', { supplier: 'Grafik' }));
		const c = await mount();

		await c.find('[data-testid="expense-search"]').setValue('grafik');

		await vi.waitFor(() => expect(c.findAll('[data-testid^="expense-entry-"]')).toHaveLength(1));
		expect(c.find('[data-testid="expense-entry-v2"]').exists()).toBe(true);
	});

	it('bez shody to řekne', async () => {
		await vaultWithExpenses(expense('v1'));
		const c = await mount();

		await c.find('[data-testid="expense-search"]').setValue('nic');

		await vi.waitFor(() =>
			expect(c.find('[data-testid="empty-state-filtered"]').text()).toBe('Žádné položky nenalezeny.'),
		);
	});
});

describe('mazání', () => {
	it('po potvrzení smaže', async () => {
		await vaultWithExpenses(expense('v1'));
		const c = await mount();

		await c.find('[data-testid="expense-actions-v1"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="expense-delete"]').trigger('click');
		await answerDialog(true);
		await flushPromises();

		expect(savedExpenses()).toEqual([]);
	});

	it('u výdaje s dokladem hláška zmíní, že soubor zůstane', async () => {
		await vaultWithExpenses(expense('v1', { documentFile: 'prijate/x.pdf' }));
		const c = await mount();

		await c.find('[data-testid="expense-actions-v1"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="expense-delete"]').trigger('click');
		await flushPromises();

		expect(layer().find('[data-testid="dialog-message"]').text()).toContain('prijate/');
		await answerDialog(false);
	});

	it('selhání mazání se ohlásí', async () => {
		await vaultWithExpenses(expense('v1'));
		backend.breaks('write_data_file', 'vydaje.json je zamčený');
		const c = await mount();

		await c.find('[data-testid="expense-actions-v1"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="expense-delete"]').trigger('click');
		await answerDialog(true);
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Výdaj se nepodařilo smazat',
				description: 'vydaje.json je zamčený',
				color: 'error',
			}),
		);
	});

	it('odmítnuté potvrzení nemaže', async () => {
		await vaultWithExpenses(expense('v1'));
		const c = await mount();

		await c.find('[data-testid="expense-actions-v1"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="expense-delete"]').trigger('click');
		await answerDialog(false);
		await flushPromises();

		expect(savedExpenses()).toHaveLength(1);
	});

	it('doklad jde ukázat ve Finderu', async () => {
		await vaultWithExpenses(expense('v1', { documentFile: 'prijate/x.pdf' }));
		const c = await mount();

		await c.find('[data-testid="expense-actions-v1"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="expense-document"]').trigger('click');
		await flushPromises();

		expect(backend.exposed).toEqual(['/vault/prijate/x.pdf']);
	});

	it('klik na zmizelý doklad Finder neotevře', async () => {
		await vaultWithExpenses(expense('v1', { documentFile: 'prijate/x.pdf' }));
		const c = await mount();
		await c.find('[data-testid="expense-actions-v1"]').trigger('click');
		await flushPromises();
		const icon = layer().find('[data-testid="expense-document"]');

		useNuxtApp().vueApp.runWithContext(useExpenses).expenses.value[0]!.documentFile = undefined;
		await icon.trigger('click');
		await flushPromises();

		expect(backend.exposed).toEqual([]);
	});

	it('doklad, který Finder neukáže, se ohlásí', async () => {
		await vaultWithExpenses(expense('v1', { documentFile: 'prijate/x.pdf' }));
		backend.breaks('reveal_path', 'Soubor neexistuje');
		const c = await mount();

		await c.find('[data-testid="expense-actions-v1"]').trigger('click');
		await flushPromises();
		await layer().find('[data-testid="expense-document"]').trigger('click');
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

describe('načtení dokladu z dialogu', () => {
	it('selhání dialogu se ohlásí', async () => {
		backend.breaks('pick_files', 'Dialog nejde otevřít');
		const c = await mount();

		await c.find('[data-testid="expense-import"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Výběr dokladu se nepodařilo otevřít',
				description: 'Dialog nejde otevřít',
				color: 'error',
			}),
		);
		expect(backend.args('import_received')).toEqual([]);
	});

	it('vybrané PDF naimportuje a ohlásí', async () => {
		backend.dialog.push(['/a.pdf']);
		documentReturns({ supplier: 'Nový' });
		const c = await mount();

		await c.find('[data-testid="expense-import"]').trigger('click');
		await flushPromises();

		expect(savedExpenses()).toHaveLength(1);
		expect(c.find('[data-testid="expenses-footer"]').text()).toContain('Naimportováno: Nový');
	});

	it('zrušený dialog nic neimportuje a nehlásí falešný úspěch ani chybu', async () => {
		backend.dialog.push([]);
		const c = await mount();

		await c.find('[data-testid="expense-import"]').trigger('click');
		await flushPromises();

		expect(backend.args('import_received')).toEqual([]);
		expect(c.find('[data-testid="status-message"]').exists()).toBe(false);
	});
});

describe('přetažení dokladů', () => {
	it('přetažené PDF se naimportuje', async () => {
		documentReturns({ supplier: 'Z dropu' });
		const c = await mount();

		dropFiles('/a.pdf');
		await flushPromises();

		expect(backend.args('import_received')).toEqual([
			{
				vaultPath: '/vault',
				sourcePath: '/a.pdf',
			},
		]);
		expect(c.find('[data-testid="expenses-footer"]').text()).toContain('Z dropu');
	});

	it('přetažení jiného souboru vyzve k PDF', async () => {
		await mount();

		dropFiles('/uctenka.jpg');
		await flushPromises();

		expect(backend.args('import_received')).toEqual([]);
		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Přetáhni PDF s přijatou fakturou.',
				color: 'error',
			}),
		);
	});

	it('soubor, který na disku neleží, se neimportuje', async () => {
		await mount();

		drag('drop', {
			types: ['Files'],
			files: [new File([''], 'obrazek.pdf')],
		});
		await flushPromises();

		expect(backend.args('import_received')).toEqual([]);
	});

	it('přetažení během importu se odmítne a import po doběhnutí jde znovu', async () => {
		documentReturns({ supplier: 'První' });
		const first = backend.postpone('import_received');
		const c = await mount();

		dropFiles('/a.pdf');
		await flushPromises();
		expect(c.find('[data-testid="expense-import"]').attributes('disabled')).toBe('');

		dropFiles('/b.pdf');
		await flushPromises();
		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Předchozí import ještě běží. Doklady přetáhni znovu, až doběhne.',
				color: 'error',
			}),
		);

		first.finish();
		await flushPromises();
		expect(backend.args('import_received')).toEqual([
			{
				vaultPath: '/vault',
				sourcePath: '/a.pdf',
			},
		]);
		expect(c.find('[data-testid="expense-import"]').attributes('disabled')).toBeUndefined();

		documentReturns({ supplier: 'Druhý' });
		dropFiles('/b.pdf');
		await flushPromises();
		expect(backend.args('import_received')).toEqual([
			{
				vaultPath: '/vault',
				sourcePath: '/a.pdf',
			},
			{
				vaultPath: '/vault',
				sourcePath: '/b.pdf',
			},
		]);
	});

	it('tažený text plochu nerozsvítí ani nic neimportuje', async () => {
		const c = await mount();

		drag('dragenter', {
			types: ['text/plain'],
			files: [],
		});
		await flushPromises();
		expect(c.find('[data-testid="expense-dropzone"]').exists()).toBe(false);

		drag('drop', {
			types: ['text/plain'],
			files: [],
		});
		await flushPromises();
		expect(c.find('[data-testid="status-message"]').exists()).toBe(false);
	});

	it('událost bez přenášených dat nic nezmění', async () => {
		const c = await mount();

		drag('dragenter', null);
		drag('drop', null);
		await flushPromises();

		expect(c.find('[data-testid="expense-dropzone"]').exists()).toBe(false);
		expect(c.find('[data-testid="status-message"]').exists()).toBe(false);
	});

	it('nájezd nad stránku zvýrazní plochu a odjezd ji zhasne', async () => {
		const c = await mount();

		drag('dragenter', {
			types: ['Files'],
			files: [],
		});
		await flushPromises();
		expect(c.find('[data-testid="expense-dropzone"]').exists()).toBe(true);

		drag('dragleave', {
			types: ['Files'],
			files: [],
		});
		await flushPromises();
		expect(c.find('[data-testid="expense-dropzone"]').exists()).toBe(false);
	});

	it('přechod mezi prvky stránky plochu nezhasne', async () => {
		const c = await mount();

		drag('dragenter', {
			types: ['Files'],
			files: [],
		});
		drag('dragenter', {
			types: ['Files'],
			files: [],
		});
		drag('dragleave', {
			types: ['Files'],
			files: [],
		});
		await flushPromises();

		expect(c.find('[data-testid="expense-dropzone"]').exists()).toBe(true);
	});

	it('odjezd textu nad stránkou plochu nezhasne', async () => {
		const c = await mount();

		drag('dragenter', {
			types: ['Files'],
			files: [],
		});
		drag('dragleave', {
			types: ['text/plain'],
			files: [],
		});
		await flushPromises();

		expect(c.find('[data-testid="expense-dropzone"]').exists()).toBe(true);
	});

	it('puštění plochu zhasne', async () => {
		documentReturns();
		const c = await mount();

		drag('dragenter', {
			types: ['Files'],
			files: [],
		});
		dropFiles('/a.pdf');
		await flushPromises();

		expect(c.find('[data-testid="expense-dropzone"]').exists()).toBe(false);
	});

	it('nad stránkou dovolí soubor pustit', async () => {
		await mount();
		const event = new Event('dragover', {
			bubbles: true,
			cancelable: true,
		});

		document.querySelector('[data-testid="expenses-footer"]')!.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(true);
	});
});

describe('hlášky importu', () => {
	it('doklad bez jména dodavatele se ohlásí jako „doklad"', async () => {
		backend.dialog.push(['/a.pdf']);
		documentReturns({ supplier: '' });
		const c = await mount();

		await c.find('[data-testid="expense-import"]').trigger('click');
		await flushPromises();

		expect(c.find('[data-testid="expenses-footer"]').text()).toContain('Naimportováno: doklad.');
	});

	it('doklad odmítnutý backendem se neuloží a jeho důvod je vidět', async () => {
		backend.dialog.push(['/a.pdf', '/sken.pdf']);
		backend.returns('import_received', receivedDocument());
		backend.fails('import_received', 'sken.pdf nemá čitelný vložený ISDOC');
		const c = await mount();

		await c.find('[data-testid="expense-import"]').trigger('click');
		await flushPromises();

		expect(savedExpenses()).toEqual([expect.objectContaining({ supplier: 'Server s.r.o.' })]);
		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Naimportováno: Server s.r.o.. Doklad neuvádí IČO odběratele — ověř, že je opravdu vystavený na tebe. sken.pdf nemá čitelný vložený ISDOC',
				color: 'error',
			}),
		);
	});

	it('týž doklad dvakrát v jedné dávce se uloží jen jednou', async () => {
		backend.dialog.push(['/a.pdf', '/a-kopie.pdf']);
		const doc = {
			number: 'F2026-7',
			supplierIco: '25596641',
		};
		backend.returns(
			'import_received',
			receivedDocument(doc),
			receivedDocument({
				...doc,
				file: 'prijate/x-2.pdf',
			}),
		);
		backend.returns('remove_received', null);
		const c = await mount();

		await c.find('[data-testid="expense-import"]').trigger('click');
		await flushPromises();

		expect(savedExpenses()).toEqual([
			expect.objectContaining({
				documentFile: 'prijate/x.pdf',
				documentNumber: 'F2026-7',
			}),
		]);
		expect(backend.args('remove_received')).toEqual([
			{
				vaultPath: '/vault',
				file: 'prijate/x-2.pdf',
			},
		]);
		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Naimportováno: Server s.r.o.. Doklad neuvádí IČO odběratele — ověř, že je opravdu vystavený na tebe. Doklad F2026-7 už ve výdajích je (Server s.r.o.).',
				color: 'error',
			}),
		);
	});

	it('chyby z dávky se ukážou všechny', async () => {
		backend.dialog.push(['/a.pdf', '/b.pdf']);
		backend.fails('import_received', 'cizí doklad');
		backend.fails('import_received', 'nečitelné PDF');
		const c = await mount();

		await c.find('[data-testid="expense-import"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'cizí doklad nečitelné PDF',
				color: 'error',
			}),
		);
	});

	it('varování se neopakuje dvakrát', async () => {
		backend.dialog.push(['/a.pdf', '/b.pdf']);
		documentReturns({ supplierIco: '' });
		const c = await mount();

		await c.find('[data-testid="expense-import"]').trigger('click');
		await flushPromises();

		expect(
			c
				.find('[data-testid="expenses-footer"]')
				.text()
				.match(/neuvádí IČO/g),
		).toHaveLength(1);
	});

	it('selhání uložení výdajů se ohlásí', async () => {
		backend.dialog.push(['/a.pdf']);
		documentReturns();
		backend.keepsReturning('remove_received', null);
		backend.breaks('write_data_file', 'vydaje.json není načtený');
		const c = await mount();

		await c.find('[data-testid="expense-import"]').trigger('click');
		await flushPromises();

		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Výdaje se nepodařilo uložit',
				description: 'vydaje.json není načtený',
				color: 'error',
			}),
		);
	});

	it('po selhání uložení uklidí kopie, které už v prijate/ leží', async () => {
		backend.dialog.push(['/a.pdf', '/b.pdf']);
		backend.returns(
			'import_received',
			receivedDocument({
				number: 'F2026-7',
				supplierIco: '25596641',
			}),
			receivedDocument({
				number: 'F2026-8',
				supplierIco: '25596641',
				file: 'prijate/x-2.pdf',
			}),
		);
		backend.keepsReturning('remove_received', null);
		backend.breaks('write_data_file', 'Disk je plný');
		const c = await mount();

		await c.find('[data-testid="expense-import"]').trigger('click');
		await flushPromises();

		// Kopie bez záznamu ve výdajích by příští import odmítl jako „tentýž soubor podruhé".
		expect(backend.args('remove_received')).toEqual([
			{
				vaultPath: '/vault',
				file: 'prijate/x.pdf',
			},
			{
				vaultPath: '/vault',
				file: 'prijate/x-2.pdf',
			},
		]);
	});
});

describe('nepovedené načtení', () => {
	it('poškozená data ohlásí místo tvrzení, že výdaje nejsou', async () => {
		await expect(
			prepareVault({
				'vydaje.json': {
					expenses: 'rozbito',
				},
			}),
		).rejects.toThrow(
			new Error(
				'Soubor vydaje.json má poškozený obsah (expenses: Neplatný vstup: očekáváno pole, obdrženo řetězec).',
			),
		);
		const c = await mount();

		expect(c.find('[data-testid="empty-state-error"]').text()).toContain(
			'Došlo k chybě: Soubor vydaje.json má poškozený obsah',
		);
	});
});
