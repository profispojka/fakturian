import { commands } from '~/bindings';

// Logo žije jako `logo.png` přímo ve vaultu, ne v konfiguraci appky, aby cestovalo s daty.
export function useLogo() {
	const { vaultPath, requireVault } = useVault();
	const hasLogo = useState<boolean>('vaultHasLogo', () => false);

	async function refreshLogo() {
		if (!vaultPath.value) {
			hasLogo.value = false;
			return;
		}
		hasLogo.value = await commands.vaultHasLogo(vaultPath.value);
	}

	async function setLogo(): Promise<boolean> {
		const vault = requireVault();
		const [source] = await commands.pickFiles('Obrázek', ['png'], false);
		if (!source) return false;
		await commands.setVaultLogo(vault, source);
		hasLogo.value = true;
		return true;
	}

	async function removeLogo() {
		if (!vaultPath.value) return;
		await commands.removeVaultLogo(vaultPath.value);
		hasLogo.value = false;
	}

	return {
		setLogo,
		removeLogo,
		hasLogo,
		refreshLogo,
	};
}
