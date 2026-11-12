import { commands } from '~/bindings';
import { errorText, issuesText } from '~/utils/errors';

import type { Zod } from '~/utils/zod';

// Soubor na doménu, ať konflikt v cloudu vezme jednu doménu. `load()` souběh nehlídá — volající ho
// pouští, až nic neběží (`busy` ve `vault/Wizard.vue`), jinak by pozdní odpověď přepsala novější paměť.
export function useVaultFile<T extends object>(name: string, empty: () => T, schema: Zod.ZodType<T>) {
	const data = useState<T>(`vaultFile:${name}`, empty);
	const loaded = useState<boolean>(`vaultFileLoaded:${name}`, () => false);
	// Bez ní výpis ukáže nenačtená data jako „zatím nic" a uživatel usoudí, že o ně přišel.
	const error = useState<string>(`vaultFileError:${name}`, () => '');
	// Obsah, který na disku skutečně leží. Volající mění `data` dřív, než zavolá `save()`, takže
	// nepovedený zápis musí paměť vrátit sem — jinak by obrazovka ukazovala změnu, která po restartu zmizí.
	const persisted = useState<T>(`vaultFilePersisted:${name}`, empty);
	const writing = useState<number>(`vaultFileWrite:${name}`, () => 0);
	const { vaultPath } = useVault();

	async function load() {
		if (!vaultPath.value) return;
		// Bez zahození by neúspěšné opakované načtení pustilo do zápisu data, která už na disku neleží.
		loaded.value = false;
		error.value = '';
		data.value = empty();
		persisted.value = empty();
		try {
			const json = await commands.readDataFile(vaultPath.value, name);
			const body: unknown = JSON.parse(json);
			const parsedBody = schema.safeParse(body);
			if (!parsedBody.success)
				throw new Error(`Soubor ${name} má poškozený obsah (${issuesText(parsedBody.error)}).`);

			data.value = parsedBody.data;
			persisted.value = structuredClone(parsedBody.data);
			loaded.value = true;
		} catch (e) {
			error.value = errorText(e);
			throw e;
		}
	}

	async function save() {
		if (!vaultPath.value) return;
		// Po neúspěšném načtení drží `data` prázdnou hodnotu a zápis by s ní přepsal skutečný obsah
		// souboru.
		if (!loaded.value) {
			data.value = structuredClone(toRaw(persisted.value));
			throw new Error(
				`Data (${name}) se nepodařilo načíst, takže se neukládají. ` +
					`Zkontroluj datovou složku a zkus to znovu.`,
			);
		}
		const json = JSON.stringify(data.value, null, 2);
		// Snímek přes JSON: `toRaw` odbalí jen vrchol a proxy prvků z `filter`/`map` by klon shodily.
		// Rozbor odmítne obsah, který by příští načtení neprošlo.
		const written = schema.safeParse(JSON.parse(json));
		if (!written.success) {
			data.value = structuredClone(toRaw(persisted.value));
			throw new Error(`Data (${name}) mají tvar, který by se znovu nenačetl (${issuesText(written.error)}).`);
		}

		const mine = ++writing.value;
		// Novější zápis nese i tuhle změnu, takže o paměti rozhodne až jeho výsledek.
		const restore = () => {
			if (mine === writing.value) data.value = structuredClone(toRaw(persisted.value));
		};
		let outcome;
		try {
			outcome = await commands.writeDataFile(vaultPath.value, name, json);
		} catch (e) {
			restore();
			throw e;
		}
		if (outcome === 'conflict') {
			restore();
			// Převzít cizí obsah do rozdělané paměti je složité; čisté načtení z disku ne.
			const reload = await getUserConfirmation(
				`Soubor ${name} mezitím změnil jiný počítač nebo program. Appka se načte znovu z disku ` +
					`a neuložené změny se ztratí.`,
				{
					title: 'Data ve složce se změnila',
					confirmLabel: 'Načíst znovu',
				},
			);
			if (reload) window.location.reload();
			throw new Error(`Změna se neuložila: soubor ${name} mezitím změnil jiný počítač nebo program.`);
		}
		persisted.value = written.data;
	}

	return {
		data,
		loaded,
		error,
		load,
		save,
	};
}
