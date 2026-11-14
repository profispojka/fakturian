import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from 'vue';

import { useVault } from '~/composables/useVault';
import { useVaultFile } from '~/composables/useVaultFile';
import { z } from '~/utils/zod';

import { backend } from '../setup/backend';
import { answerDialog, layer, mountUi } from '../setup/mount';

/** Doména vymyšlená schválně pro tenhle test. */
interface Data {
	items: string[];
	name: string;
}

const schema = z.object({
	items: z.array(z.string()).default([]),
	name: z.string().default(''),
});
const empty = (): Data => ({
	items: [],
	name: '',
});

function file() {
	return useNuxtApp().vueApp.runWithContext(() => useVaultFile<Data>('cenik.json', empty, schema));
}

function vaultHas(content: unknown) {
	backend.writeFile('/vault', 'cenik.json', content);
}

beforeEach(async () => {
	backend.create('/vault');
	await useNuxtApp().vueApp.runWithContext(useVault).setVault('/vault');
});

describe('načtení souboru domény', () => {
	it('načte obsah a označí soubor za načtený', async () => {
		vaultHas({
			items: ['a'],
			name: 'Ceník',
		});
		const f = file();

		await f.load();
		expect(f.data.value).toEqual({
			items: ['a'],
			name: 'Ceník',
		});
		expect(f.loaded.value).toBe(true);
	});

	it('nový vault se načte jako prázdná doména', async () => {
		const f = file();

		await f.load();
		expect(f.data.value).toEqual(empty());
		expect(f.loaded.value).toBe(true);
	});

	it('chybějící pole doplní výchozí hodnoty', async () => {
		vaultHas({ items: ['a'] });
		const f = file();

		await f.load();
		expect(f.data.value.name).toBe('');
		expect(f.loaded.value).toBe(true);
	});

	it('poškozený obsah se ohlásí a soubor zůstane nenačtený', async () => {
		vaultHas({ items: 'tohle není pole' });
		const f = file();

		await expect(f.load()).rejects.toThrow(
			new Error(
				'Soubor cenik.json má poškozený obsah (items: Neplatný vstup: očekáváno pole, obdrženo řetězec).',
			),
		);
		expect(f.loaded.value).toBe(false);
	});

	it('obsah, který není objekt, se ohlásí', async () => {
		backend.writeText('/vault', 'cenik.json', JSON.stringify(['a', 'b']));
		const f = file();

		await expect(f.load()).rejects.toBe('Soubor cenik.json musí být JSON objekt, ne pole nebo hodnota.');
		expect(f.loaded.value).toBe(false);
	});

	it('hláška o poškození pojmenuje konkrétní pole', async () => {
		vaultHas({ items: 'tohle není pole' });

		await expect(file().load()).rejects.toThrow(
			new Error(
				'Soubor cenik.json má poškozený obsah (items: Neplatný vstup: očekáváno pole, obdrženo řetězec).',
			),
		);
	});

	it('neúspěšné načtení nenechá v paměti data z předchozího', async () => {
		vaultHas({
			items: ['stare'],
			name: 'Stará složka',
		});
		const f = file();
		await f.load();
		expect(f.data.value.items).toEqual(['stare']);

		vaultHas({ items: 'rozbito' });
		await expect(f.load()).rejects.toThrow(
			new Error(
				'Soubor cenik.json má poškozený obsah (items: Neplatný vstup: očekáváno pole, obdrženo řetězec).',
			),
		);
		expect(f.data.value).toEqual(empty());
	});

	it('bez zvolené složky se nenačítá nic', async () => {
		useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value = null;
		const f = file();

		await f.load();
		expect(backend.calls.some((v) => v.command === 'read_data_file')).toBe(false);
		expect(f.loaded.value).toBe(false);
	});
});

describe('zápis souboru domény', () => {
	it('uloží data tak, že je vidí příští načtení', async () => {
		vaultHas({
			items: ['a'],
			name: 'Ceník',
		});
		const f = file();
		await f.load();

		f.data.value.items.push('b');
		await f.save();

		expect(backend.readFile('/vault', 'cenik.json')).toEqual({
			items: ['a', 'b'],
			name: 'Ceník',
		});
	});

	it('zapsaný JSON je čitelný, s odsazením', async () => {
		vaultHas({
			items: ['a'],
			name: 'Ceník',
		});
		const f = file();
		await f.load();

		await f.save();
		expect(backend.folder('/vault').files.get('cenik.json')).toBe(
			JSON.stringify(
				{
					items: ['a'],
					name: 'Ceník',
				},
				null,
				2,
			),
		);
	});

	it('uloží seznam složený z prvků reaktivního pole', async () => {
		// `filter`/`map` nad reaktivním polem vrací proxy prvků; `toRaw` je neodbalí.
		interface Rows {
			rows: { id: string; tag: string }[];
		}
		const nested = z.object({
			rows: z
				.array(
					z.object({
						id: z.string(),
						tag: z.string(),
					}),
				)
				.default([]),
		});
		const f = useNuxtApp().vueApp.runWithContext(() =>
			useVaultFile<Rows>('radky.json', () => ({ rows: [] }), nested),
		);
		backend.writeFile('/vault', 'radky.json', {
			rows: [
				{
					id: 'a',
					tag: 'x',
				},
				{
					id: 'b',
					tag: 'x',
				},
			],
		});
		await f.load();

		f.data.value.rows = f.data.value.rows.filter((row) => row.id !== 'b');
		await f.save();
		f.data.value.rows = f.data.value.rows.map((row) => ({
			...row,
			tag: 'y',
		}));
		await f.save();
		f.data.value.rows = [
			...f.data.value.rows,
			{
				id: 'c',
				tag: 'z',
			},
		];
		await f.save();

		expect(backend.readFile('/vault', 'radky.json')).toEqual({
			rows: [
				{
					id: 'a',
					tag: 'y',
				},
				{
					id: 'c',
					tag: 'z',
				},
			],
		});
	});

	it('obsah, který by se znovu nenačetl, nezapíše a paměť vrátí k souboru', async () => {
		vaultHas({
			items: ['a'],
			name: 'Ceník',
		});
		const f = file();
		await f.load();

		f.data.value.name = 'Změna';
		await f.save();
		Reflect.set(f.data.value, 'items', 'tohle není pole');
		await expect(f.save()).rejects.toThrow(
			new Error(
				'Data (cenik.json) mají tvar, který by se znovu nenačetl (items: Neplatný vstup: očekáváno pole, obdrženo řetězec).',
			),
		);

		expect(f.data.value).toEqual({
			items: ['a'],
			name: 'Změna',
		});
		expect(backend.readFile('/vault', 'cenik.json')).toEqual({
			items: ['a'],
			name: 'Změna',
		});
		expect(backend.calls.filter((v) => v.command === 'write_data_file')).toHaveLength(1);
	});

	it('bez úspěšného načtení se odmítne zapisovat', async () => {
		vaultHas({
			items: ['a'],
			name: 'Ceník',
		});

		await expect(file().save()).rejects.toThrow(
			new Error(
				'Data (cenik.json) se nepodařilo načíst, takže se neukládají. Zkontroluj datovou složku a zkus to znovu.',
			),
		);
		expect(backend.readFile('/vault', 'cenik.json')).toEqual({
			items: ['a'],
			name: 'Ceník',
		});
	});

	it('bez zvolené složky se neukládá a nic to neshodí', async () => {
		useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value = null;

		await expect(file().save()).resolves.toBeUndefined();
		expect(backend.calls.some((v) => v.command === 'write_data_file')).toBe(false);
	});

	it('nepovedený zápis vrátí paměť na obsah souboru', async () => {
		// Volající mění paměť dřív než disk; bez návratu by obrazovka ukazovala změnu, která po restartu zmizí.
		vaultHas({
			items: ['a'],
			name: 'Ceník',
		});
		const f = file();
		await f.load();
		backend.breaks('write_data_file', 'disk je plný');

		f.data.value.items.push('b');
		await expect(f.save()).rejects.toBe('disk je plný');

		expect(f.data.value).toEqual({
			items: ['a'],
			name: 'Ceník',
		});
	});

	it('po nepovedeném zápisu se paměť vrátí k poslednímu úspěšnému, ne k načtenému', async () => {
		vaultHas({
			items: ['a'],
			name: 'Ceník',
		});
		const f = file();
		await f.load();
		f.data.value.items.push('b');
		await f.save();
		backend.breaks('write_data_file', 'disk je plný');

		f.data.value.items.push('c');
		await expect(f.save()).rejects.toBe('disk je plný');

		expect(f.data.value).toEqual({
			items: ['a', 'b'],
			name: 'Ceník',
		});
	});

	it('odmítnutý zápis nenačtené domény změnu v paměti zahodí', async () => {
		vaultHas({
			items: ['a'],
			name: 'Ceník',
		});
		const f = file();

		f.data.value.items.push('b');
		await expect(f.save()).rejects.toThrow(
			new Error(
				'Data (cenik.json) se nepodařilo načíst, takže se neukládají. Zkontroluj datovou složku a zkus to znovu.',
			),
		);

		expect(f.data.value).toEqual(empty());
	});

	it('selhání staršího zápisu nevrátí paměť, dokud běží novější', async () => {
		// Novější zápis nese i starší změnu — kdyby starší selhání paměť vrátilo, zmizela by i ta novější.
		vaultHas({
			items: ['a'],
			name: 'Ceník',
		});
		const f = file();
		await f.load();
		const olderGate = backend.postpone('write_data_file');
		const newerGate = backend.postpone('write_data_file');
		backend.breaks('write_data_file', 'disk je plný');

		f.data.value.items.push('b');
		const older = f.save();
		f.data.value.items.push('c');
		const newer = f.save();
		olderGate.finish();
		await expect(older).rejects.toBe('disk je plný');

		expect(f.data.value.items).toEqual(['a', 'b', 'c']);

		backend.repairs('write_data_file');
		newerGate.finish();
		await newer;

		expect(f.data.value.items).toEqual(['a', 'b', 'c']);
		expect(backend.readFile('/vault', 'cenik.json')).toEqual({
			items: ['a', 'b', 'c'],
			name: 'Ceník',
		});
	});

	it('selhání novějšího zápisu vrátí paměť k poslednímu úspěšnému', async () => {
		vaultHas({
			items: ['a'],
			name: 'Ceník',
		});
		const f = file();
		await f.load();
		const olderGate = backend.postpone('write_data_file');
		const newerGate = backend.postpone('write_data_file');

		f.data.value.items.push('b');
		const older = f.save();
		f.data.value.items.push('c');
		const newer = f.save();
		olderGate.finish();
		await older;
		backend.breaks('write_data_file', 'disk je plný');
		newerGate.finish();
		await expect(newer).rejects.toBe('disk je plný');

		expect(f.data.value.items).toEqual(['a', 'b']);
	});
});

describe('hláška u chyby bez konkrétního pole', () => {
	/**
	 * Ne každá chyba schématu ukazuje na pole — kontrola nad celým objektem (tady „ceník nesmí být
	 * prázdný") žádnou cestu nemá.
	 */
	const schemaWithTotalCheck = schema.refine((d) => d.items.length > 0);

	it('uvede důvod, i když chyba nemíří na pole', async () => {
		vaultHas({
			items: [],
			name: 'Ceník',
		});
		const f = useNuxtApp().vueApp.runWithContext(() =>
			useVaultFile<Data>('cenik.json', empty, schemaWithTotalCheck),
		);

		await expect(f.load()).rejects.toThrow(new Error('Soubor cenik.json má poškozený obsah (Neplatný vstup).'));
	});
});

describe('soubor, který nejde přečíst', () => {
	it('poškozený JSON se ohlásí a soubor zůstane nezapsatelný', async () => {
		backend.writeText('/vault', 'cenik.json', '{ tohle není JSON');
		const f = file();

		await expect(f.load()).rejects.toBe('Soubor cenik.json má poškozený obsah: není to platný JSON.');
		expect(f.loaded.value).toBe(false);

		await expect(f.save()).rejects.toThrow(
			new Error(
				'Data (cenik.json) se nepodařilo načíst, takže se neukládají. Zkontroluj datovou složku a zkus to znovu.',
			),
		);
		expect(backend.folder('/vault').files.get('cenik.json')).toBe('{ tohle není JSON');
	});

	it('obsah null se ohlásí jako „není objekt"', async () => {
		backend.writeText('/vault', 'cenik.json', 'null');
		const f = file();

		await expect(f.load()).rejects.toBe('Soubor cenik.json musí být JSON objekt, ne pole nebo hodnota.');
		expect(f.loaded.value).toBe(false);
	});

	it('odmítnutí ze strany backendu nese dál i s důvodem', async () => {
		backend.breaks('read_data_file', 'Soubor cenik.json nejde přečíst');
		const f = file();

		await expect(f.load()).rejects.toBe('Soubor cenik.json nejde přečíst');
		expect(f.loaded.value).toBe(false);
	});

	it('selhání zápisu nese dál volajícímu', async () => {
		vaultHas({
			items: ['a'],
			name: 'Ceník',
		});
		const f = file();
		await f.load();
		backend.breaks('write_data_file', 'disk je plný');

		await expect(f.save()).rejects.toBe('disk je plný');
	});

	it('odmítnutý přepis nečitelného souboru nese důvod i cestu ke kopii', async () => {
		vaultHas({
			items: ['a'],
			name: 'Ceník',
		});
		const f = file();
		await f.load();
		backend.breaks(
			'write_data_file',
			'Soubor cenik.json ve vaultu není platný JSON, takže nejde poznat, co v něm bylo — přepsat ho ' +
				'by ta data zahodilo. Kopie je v /vault/.fakturian/snapshots. Oprav soubor, nebo ho odsud smaž.',
		);

		await expect(f.save()).rejects.toBe(
			'Soubor cenik.json ve vaultu není platný JSON, takže nejde poznat, co v něm bylo — přepsat ho by ta data zahodilo. Kopie je v /vault/.fakturian/snapshots. Oprav soubor, nebo ho odsud smaž.',
		);
	});

	it('chybějící datová složka nechá doménu nenačtenou a nezapsatelnou', async () => {
		backend.breaks('read_data_file', 'Datová složka /vault neexistuje.');
		const f = file();

		await expect(f.load()).rejects.toBe('Datová složka /vault neexistuje.');
		expect(f.loaded.value).toBe(false);
		await expect(f.save()).rejects.toThrow(
			new Error(
				'Data (cenik.json) se nepodařilo načíst, takže se neukládají. Zkontroluj datovou složku a zkus to znovu.',
			),
		);
	});
});

describe('soubor, který mezitím změnil někdo jiný', () => {
	const notSaved = {
		status: 'rejected',
		reason: new Error('Změna se neuložila: soubor cenik.json mezitím změnil jiný počítač nebo program.'),
	};

	it('zápis se neprovede a po potvrzení se appka načte znovu', async () => {
		vaultHas({
			items: ['a'],
			name: 'Ceník',
		});
		const f = file();
		await f.load();
		vaultHas({
			items: ['z jiného Macu'],
			name: 'Ceník',
		});
		mountUi({ render: () => h('div') });
		const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => undefined);

		f.data.value.items.push('b');
		const saving = Promise.allSettled([f.save()]);
		await flushPromises();
		expect(layer().find('[data-testid="dialog-heading"]').text()).toBe('Data ve složce se změnila');
		expect(layer().find('[data-testid="dialog-message"]').text()).toContain('cenik.json');
		await answerDialog(true);

		expect(await saving).toEqual([notSaved]);
		expect(reload).toHaveBeenCalledOnce();
		expect(backend.readFile('/vault', 'cenik.json')).toEqual({
			items: ['z jiného Macu'],
			name: 'Ceník',
		});
	});

	it('bez potvrzení appka zůstane, paměť se vrátí a cizí data zůstanou', async () => {
		vaultHas({
			items: ['a'],
			name: 'Ceník',
		});
		const f = file();
		await f.load();
		vaultHas({
			items: ['z jiného Macu'],
			name: 'Ceník',
		});
		mountUi({ render: () => h('div') });
		const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => undefined);

		f.data.value.items.push('b');
		const saving = Promise.allSettled([f.save()]);
		await answerDialog(false);

		expect(await saving).toEqual([notSaved]);
		expect(reload).not.toHaveBeenCalled();
		expect(f.data.value).toEqual({
			items: ['a'],
			name: 'Ceník',
		});
		expect(backend.readFile('/vault', 'cenik.json')).toEqual({
			items: ['z jiného Macu'],
			name: 'Ceník',
		});
	});

	it('vlastní zápisy po sobě konflikt nezpůsobí', async () => {
		vaultHas({
			items: ['a'],
			name: 'Ceník',
		});
		const f = file();
		await f.load();

		f.data.value.items.push('b');
		await f.save();
		f.data.value.items.push('c');
		await f.save();

		expect(backend.readFile('/vault', 'cenik.json')).toEqual({
			items: ['a', 'b', 'c'],
			name: 'Ceník',
		});
	});
});

describe('chyba načtení', () => {
	it('poškozený soubor zůstane vidět jako chyba, dokud se nenačte znovu', async () => {
		vaultHas({ items: 'rozbito' });
		const f = file();

		await expect(f.load()).rejects.toThrow(
			new Error(
				'Soubor cenik.json má poškozený obsah (items: Neplatný vstup: očekáváno pole, obdrženo řetězec).',
			),
		);
		expect(f.error.value).toContain('Soubor cenik.json má poškozený obsah');

		vaultHas({
			items: ['a'],
			name: 'Opraveno',
		});
		await f.load();

		expect(f.error.value).toBe('');
	});

	it('nečitelný soubor ohlásí chybou z backendu', async () => {
		backend.breaks('read_data_file', 'Soubor cenik.json nejde přečíst: Permission denied');
		const f = file();

		await expect(f.load()).rejects.toBe('Soubor cenik.json nejde přečíst: Permission denied');
		expect(f.error.value).toBe('Soubor cenik.json nejde přečíst: Permission denied');
	});
});
