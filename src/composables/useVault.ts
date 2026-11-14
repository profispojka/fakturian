import { commands } from '~/bindings';
import { errorText } from '~/utils/errors';

export function useVault() {
	const vaultPath = useState<string | null>('vaultPath', () => null);
	const ready = useState<boolean>('vaultReady', () => false);
	const toast = useToast();

	async function init() {
		vaultPath.value = await commands.loadVaultPath();
		ready.value = true;
		if (vaultPath.value) await commands.checkVault(vaultPath.value);
	}

	// `false` znamená, že se stránka kvůli přepnutí načítá znovu a volající už nemá co dělat.
	async function setVault(path: string): Promise<boolean> {
		if (vaultPath.value && vaultPath.value !== path) {
			await switchVault(path);
			return false;
		}
		await commands.ensureVault(path);
		vaultPath.value = path;

		// Zapamatování je až za nastavením `vaultPath`: když zápis selže, složka zůstane otevřená a
		// uživatel se dozví jen to, že se na ni appka po restartu zeptá znovu.
		try {
			await commands.saveVaultPath(path);
		} catch (e) {
			toast.add({
				title: 'Cestu k datové složce se nepodařilo zapamatovat',
				description: `${errorText(e)} — složka je otevřená, ale po restartu se na ni bude appka ptát znovu.`,
				color: 'warning',
			});
		}
		return true;
	}

	// Rozběhnutá práce by po `await` pokračovala nad novou složkou, proto se stránka zahodí celá.
	// Paměť drží starou cestu až do odjezdu, takže co ještě doběhne, zapíše tam, kde začalo.
	async function switchVault(path: string) {
		await commands.ensureVault(path);
		// Nová složka se otevře jedině z úložiště, takže bez zápisu se nepřepíná.
		await commands.saveVaultPath(path);
		window.location.replace('/');
	}

	// Dialog startuje ve stávající složce: uživatel, který ji přesunul, je nejblíž tomu, kde ji hledá.
	async function pickVault(): Promise<boolean> {
		let suggested = vaultPath.value;
		if (!suggested) suggested = await commands.defaultVaultPath();

		const selected = await commands.pickFolder(suggested);
		if (selected === null) return false;

		return setVault(selected);
	}

	async function openInFinder() {
		if (vaultPath.value) await commands.revealPath(vaultPath.value);
	}

	function requireVault(): string {
		if (!vaultPath.value) throw new Error('Není zvolena datová složka');
		return vaultPath.value;
	}

	return {
		vaultPath,
		ready,
		init,
		defaultVaultPath: commands.defaultVaultPath,
		setVault,
		pickVault,
		openInFinder,
		requireVault,
	};
}
