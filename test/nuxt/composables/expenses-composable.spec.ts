import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import { useExpenses } from '~/composables/useExpenses';
import { useVault } from '~/composables/useVault';
import { useVaultData } from '~/composables/useVaultData';
import { emptySupplier } from '~/schemas/suppliers';

import { backend } from '../setup/backend';
import { date } from '../setup/dates';
import { savedField, prepareVault, writes } from '../setup/vault';

import type { Expense } from '~/schemas/expenses';

function expense(id: string, over: Partial<Expense> = {}): Expense {
	return {
		id,
		supplier: 'Dodavatel',
		description: 'Hosting',
		amountCents: 100_00,
		date: date('2026-03-01'),
		...over,
	};
}

function document(over: Record<string, unknown> = {}) {
	return {
		file: 'prijate/2026-03-01-hosting.pdf',
		supplier: 'Server s.r.o.',
		supplierIco: '25596641',
		number: '',
		uuid: '',
		description: 'Hosting 03/2026',
		amountCents: 500_00,
		date: '2026-03-01',
		recipientIco: '12345679',
		...over,
	};
}

function savedExpenses(): Expense[] {
	return savedField('vydaje.json', 'expenses');
}

beforeEach(async () => {
	await prepareVault({
		'nastaveni.json': {
			supplier: {
				...emptySupplier(),
				ico: '12345679',
			},
			contacts: [],
			pricelist: [],
		},
	});
});

describe('evidence výdajů', () => {
	it('přidá výdaj a přepíše ho podle id', async () => {
		const { expenses, upsert } = useNuxtApp().vueApp.runWithContext(useExpenses);
		await upsert(expense('v1'));
		await upsert(expense('v1', { description: 'Hosting ročně' }));

		expect(expenses.value).toHaveLength(1);
		expect(expenses.value[0]!.description).toBe('Hosting ročně');
	});

	it('smaže výdaj podle id', async () => {
		const { expenses, upsert, remove } = useNuxtApp().vueApp.runWithContext(useExpenses);
		await upsert(expense('v1'));
		await upsert(expense('v2'));

		await remove('v1');
		expect(expenses.value.map((e) => e.id)).toEqual(['v2']);
	});

	it('smazání neznámého id nic nerozbije', async () => {
		const { expenses, upsert, remove } = useNuxtApp().vueApp.runWithContext(useExpenses);
		await upsert(expense('v1'));

		await remove('neexistuje');
		expect(expenses.value).toHaveLength(1);
	});

	it('hromadné vložení zapisuje jen jednou', async () => {
		const { expenses, upsertMany } = useNuxtApp().vueApp.runWithContext(useExpenses);
		await upsertMany([expense('v1'), expense('v2'), expense('v3')]);

		expect(expenses.value).toHaveLength(3);
		expect(savedExpenses()).toHaveLength(3);
		expect(writes('vydaje.json')).toBe(1);
	});

	it('prázdné hromadné vložení nezapisuje', async () => {
		await useNuxtApp().vueApp.runWithContext(useExpenses).upsertMany([]);
		expect(writes('vydaje.json')).toBe(0);
	});

	it('zápis nahradí seznam, předchozí snímek zůstane beze změny', async () => {
		const { expenses, upsert, upsertMany } = useNuxtApp().vueApp.runWithContext(useExpenses);
		await upsert(expense('v1'));
		const beforeUpsert = expenses.value;
		await upsert(expense('v1', { supplier: 'Nový' }));
		expect(beforeUpsert).toEqual([expense('v1')]);
		const beforeBatch = expenses.value;
		await upsertMany([expense('v2')]);
		expect(beforeBatch).toEqual([expense('v1', { supplier: 'Nový' })]);
		expect(expenses.value).toEqual([expense('v1', { supplier: 'Nový' }), expense('v2')]);
	});

	it('neúspěšný zápis propaguje chybu a vrátí paměť k obsahu souboru', async () => {
		const { expenses, upsert, upsertMany, remove } = useNuxtApp().vueApp.runWithContext(useExpenses);
		await upsert(expense('v1'));
		backend.breaks('write_data_file', 'Disk je plný');

		await expect(upsert(expense('v2'))).rejects.toBe('Disk je plný');
		await expect(upsertMany([expense('v2')])).rejects.toBe('Disk je plný');
		await expect(remove('v1')).rejects.toBe('Disk je plný');
		expect(expenses.value).toEqual([expense('v1')]);
		expect(savedExpenses()).toEqual([expense('v1')]);
	});
});

describe('import přetaženého dokladu', () => {
	it('z dokladu s ISDOC předvyplní výdaj', async () => {
		backend.returns('import_received', document());

		const v = await useNuxtApp().vueApp.runWithContext(useExpenses).importDocument('/Users/jan/invoice.pdf');
		expect(v.warning).toBeUndefined();
		expect(v.expense.supplier).toBe('Server s.r.o.');
		expect(v.expense.amountCents).toBe(500_00);
		expect(v.expense.documentFile).toBe('prijate/2026-03-01-hosting.pdf');
	});

	it('doklad, který backend odmítne, nepřevezme a nic nemaže', async () => {
		backend.fails('import_received', 'sken.pdf nemá čitelný vložený ISDOC');

		await expect(useNuxtApp().vueApp.runWithContext(useExpenses).importDocument('/sken.pdf')).rejects.toBe(
			'sken.pdf nemá čitelný vložený ISDOC',
		);
		expect(useNuxtApp().vueApp.runWithContext(useExpenses).expenses.value).toEqual([]);
		expect(backend.args('remove_received')).toEqual([]);
	});

	it('odpověď bez data vystavení se odmítne a kopie zahodí', async () => {
		backend.returns('import_received', document({ date: '' }));
		backend.returns('remove_received', null);

		await expect(useNuxtApp().vueApp.runWithContext(useExpenses).importDocument('/x.pdf')).rejects.toThrow(
			new Error('Přijatý doklad se nepodařilo přečíst: date: Datum musí být ve tvaru RRRR-MM-DD.'),
		);
		expect(backend.args('remove_received')).toEqual([
			{
				vaultPath: '/vault',
				file: 'prijate/2026-03-01-hosting.pdf',
			},
		]);
	});

	it('datum z dokladu se přebírá beze změny', async () => {
		backend.returns('import_received', document({ date: '2026-01-31' }));

		const v = await useNuxtApp().vueApp.runWithContext(useExpenses).importDocument('/x.pdf');
		expect(String(v.expense.date)).toBe('2026-01-31');
	});

	it('prázdné IČO dodavatele se neuloží jako prázdný řetězec', async () => {
		backend.returns('import_received', document({ supplierIco: '' }));

		const v = await useNuxtApp().vueApp.runWithContext(useExpenses).importDocument('/x.pdf');
		expect(v.expense.supplierIco).toBeUndefined();
	});

	it('doklad vystavený na někoho jiného odmítne a uklidí po sobě', async () => {
		backend.returns('import_received', document({ recipientIco: '99999999' }));

		await expect(useNuxtApp().vueApp.runWithContext(useExpenses).importDocument('/x.pdf')).rejects.toThrow(
			new Error('Doklad je vystavený na IČO 99999999, ne na tvoje 12345679.'),
		);
		expect(backend.args('remove_received')).toEqual([
			{
				vaultPath: '/vault',
				file: 'prijate/2026-03-01-hosting.pdf',
			},
		]);
	});

	it('selhání úklidu ohlásí toastem a nepřebije důvod odmítnutí', async () => {
		backend.returns('import_received', document({ recipientIco: '99999999' }));
		backend.breaks('remove_received', 'soubor je zamčený');

		// Kladně, ne přes `rejects.not.toThrow` — ten projde i tehdy, když `importDocument` nevyhodí
		// vůbec nic.
		await expect(useNuxtApp().vueApp.runWithContext(useExpenses).importDocument('/x.pdf')).rejects.toThrow(
			new Error('Doklad je vystavený na IČO 99999999, ne na tvoje 12345679.'),
		);

		await nextTick();
		const headings = useNuxtApp()
			.vueApp.runWithContext(useToast)
			.toasts.value.map((t) => t.title);
		expect(headings).toContain('Odmítnutý doklad se nepodařilo smazat z prijate/');
	});

	it('doklad bez IČO příjemce projde s upozorněním', async () => {
		backend.returns('import_received', document({ recipientIco: '' }));

		const v = await useNuxtApp().vueApp.runWithContext(useExpenses).importDocument('/x.pdf');
		expect(v.warning).toBe('Doklad neuvádí IČO odběratele — ověř, že je opravdu vystavený na tebe.');
		expect(v.expense.amountCents).toBe(500_00);
	});

	it('bez datové složky se import ani nezkusí', async () => {
		useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value = null;

		await expect(useNuxtApp().vueApp.runWithContext(useExpenses).importDocument('/x.pdf')).rejects.toThrow(
			new Error('Není zvolena datová složka'),
		);
		expect(backend.args('import_received')).toEqual([]);
	});

	it('neočekávaný tvar odpovědi se odmítne a kopie se uklidí', async () => {
		backend.returns('import_received', { file: 'prijate/x.pdf' });

		await expect(useNuxtApp().vueApp.runWithContext(useExpenses).importDocument('/x.pdf')).rejects.toThrow(
			new Error(
				'Přijatý doklad se nepodařilo přečíst: supplier: Neplatný vstup: očekáváno řetězec, obdrženo undefined, supplierIco: Neplatný vstup: očekáváno řetězec, obdrženo undefined a number: Neplatný vstup: očekáváno řetězec, obdrženo undefined',
			),
		);
		expect(backend.args('remove_received')).toEqual([
			{
				vaultPath: '/vault',
				file: 'prijate/x.pdf',
			},
		]);
	});

	it('bajt po bajtu tentýž soubor odmítne backend a nic se po něm neuklízí', async () => {
		const refused = 'x.pdf už v prijate/ leží jako sken.pdf — tentýž soubor podruhé.';
		backend.breaks('import_received', refused);

		await expect(useNuxtApp().vueApp.runWithContext(useExpenses).importDocument('/x.pdf')).rejects.toBe(refused);
		expect(backend.args('remove_received')).toEqual([]);
	});

	it('číslo a UUID dokladu se uloží k výdaji', async () => {
		backend.returns(
			'import_received',
			document({
				number: 'F2026-7',
				uuid: 'ABC-1',
			}),
		);

		const v = await useNuxtApp().vueApp.runWithContext(useExpenses).importDocument('/x.pdf');
		expect([v.expense.documentNumber, v.expense.documentUuid]).toEqual(['F2026-7', 'ABC-1']);
	});

	it('týž doklad podle UUID odmítne a novou kopii uklidí', async () => {
		await useNuxtApp()
			.vueApp.runWithContext(useExpenses)
			.upsert(
				expense('v1', {
					documentUuid: 'abc-1',
					documentNumber: 'X1',
				}),
			);
		backend.returns(
			'import_received',
			document({
				number: 'F2026-7',
				uuid: 'ABC-1',
				file: 'prijate/kopie.pdf',
			}),
		);

		await expect(useNuxtApp().vueApp.runWithContext(useExpenses).importDocument('/x.pdf')).rejects.toThrow(
			new Error('Doklad F2026-7 už ve výdajích je (Dodavatel).'),
		);
		expect(backend.args('remove_received')).toEqual([
			{
				vaultPath: '/vault',
				file: 'prijate/kopie.pdf',
			},
		]);
	});

	it('týž doklad podle dodavatele a čísla odmítne i v rámci jedné dávky', async () => {
		backend.returns(
			'import_received',
			document({
				number: 'F2026-7',
				supplierIco: '025596641',
			}),
		);
		const pending = [
			expense('v9', {
				supplier: '',
				supplierIco: '25596641',
				documentNumber: 'F2026-7',
			}),
		];

		await expect(useNuxtApp().vueApp.runWithContext(useExpenses).importDocument('/x.pdf', pending)).rejects.toThrow(
			new Error('Doklad F2026-7 už ve výdajích je (bez dodavatele).'),
		);
	});

	it('stejné číslo od jiného dodavatele nebo bez IČO duplicitou není', async () => {
		await useNuxtApp()
			.vueApp.runWithContext(useExpenses)
			.upsertMany([
				expense('v1', {
					supplierIco: '11111111',
					documentNumber: 'F2026-7',
				}),
				expense('v2', { documentNumber: 'F2026-7' }),
			]);
		backend.returns(
			'import_received',
			document({ number: 'F2026-7' }),
			document({
				number: 'F2026-7',
				supplierIco: '',
			}),
			document({
				number: '',
				supplierIco: '11111111',
			}),
		);

		for (let i = 0; i < 3; i++) {
			const v = await useNuxtApp().vueApp.runWithContext(useExpenses).importDocument('/x.pdf');
			expect(v.expense.supplier).toBe('Server s.r.o.');
		}
	});

	it('odpověď bez jména souboru se odmítne a nic nemaže', async () => {
		backend.returns('import_received', null);

		await expect(useNuxtApp().vueApp.runWithContext(useExpenses).importDocument('/x.pdf')).rejects.toThrow(
			new Error('Přijatý doklad se nepodařilo přečíst: Neplatný vstup: očekáváno object, obdrženo null'),
		);
		expect(backend.args('remove_received')).toEqual([]);
	});
});

describe('kontrola složky prijate/', () => {
	it('převezme doklady, které backend nepřečte', async () => {
		backend.folder('/vault').brokenReceived = [
			{
				file: 'sken.pdf',
				reason: 'sken.pdf nemá čitelný vložený ISDOC',
			},
		];
		const { brokenReceived, checkReceived } = useNuxtApp().vueApp.runWithContext(useExpenses);

		await checkReceived();

		expect(brokenReceived.value).toEqual([
			{
				file: 'sken.pdf',
				reason: 'sken.pdf nemá čitelný vložený ISDOC',
			},
		]);
		expect(backend.args('list_broken_received')).toEqual([{ vaultPath: '/vault' }]);
	});

	it('bez datové složky nic nekontroluje a starý nález zahodí', async () => {
		const { brokenReceived, checkReceived } = useNuxtApp().vueApp.runWithContext(useExpenses);
		brokenReceived.value = [
			{
				file: 'stary.pdf',
				reason: 'x',
			},
		];
		useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value = null;

		await checkReceived();

		expect(brokenReceived.value).toEqual([]);
		expect(backend.args('list_broken_received')).toEqual([]);
	});

	it('selhání kontroly nese chybu dál a nenechá starý nález', async () => {
		const { brokenReceived, checkReceived } = useNuxtApp().vueApp.runWithContext(useExpenses);
		brokenReceived.value = [
			{
				file: 'stary.pdf',
				reason: 'x',
			},
		];
		backend.fails('list_broken_received', 'Složku prijate/ nejde přečíst: zamčeno');

		await expect(checkReceived()).rejects.toBe('Složku prijate/ nejde přečíst: zamčeno');
		expect(brokenReceived.value).toEqual([]);
	});

	it('nečitelnou odpověď kontroly odmítne', async () => {
		backend.returns('list_broken_received', [{ file: 'sken.pdf' }]);

		await expect(useNuxtApp().vueApp.runWithContext(useExpenses).checkReceived()).rejects.toThrow(
			new Error(
				'Kontrola složky prijate/ vrátila nečitelnou odpověď (0.reason: Neplatný vstup: očekáváno řetězec, obdrženo undefined).',
			),
		);
	});
});

describe('cesta k dokladu', () => {
	it('vrátí cestu k uloženému dokladu', async () => {
		backend.returns('received_path', '/vault/prijate/x.pdf');

		expect(await useNuxtApp().vueApp.runWithContext(useExpenses).documentPath('x.pdf')).toBe(
			'/vault/prijate/x.pdf',
		);
	});

	it('bez datové složky cestu nesestaví', async () => {
		useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value = null;

		await expect(useNuxtApp().vueApp.runWithContext(useExpenses).documentPath('x.pdf')).rejects.toThrow(
			new Error('Není zvolena datová složka'),
		);
	});

	it('nenalezený doklad nese chybu dál', async () => {
		backend.breaks('received_path', 'prijate/x.pdf neexistuje');

		await expect(useNuxtApp().vueApp.runWithContext(useExpenses).documentPath('x.pdf')).rejects.toBe(
			'prijate/x.pdf neexistuje',
		);
	});
});

describe('import, když ještě nemáme vlastní IČO', () => {
	it('bez vyplněného dodavatele projde s upozorněním', async () => {
		useNuxtApp().vueApp.runWithContext(useVaultData).data.value.supplier = null;
		backend.returns('import_received', document());

		const v = await useNuxtApp().vueApp.runWithContext(useExpenses).importDocument('/x.pdf');
		expect(v.warning).toContain('IČO');
		expect(v.expense.supplier).toBe('Server s.r.o.');
	});
});
