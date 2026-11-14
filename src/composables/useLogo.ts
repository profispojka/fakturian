import { commands } from '~/bindings';

import type { LogoState } from '~/bindings';

// Logo žije jako `logo.png` přímo ve vaultu, ne v konfiguraci appky, aby cestovalo s daty.
export function useLogo() {
	const { vaultPath, requireVault } = useVault();
	const logoState = useState<LogoState>('vaultLogoState', () => 'missing');
	// I logo, které nejde přečíst, ve vaultu leží: jde nahradit i odebrat.
	const hasLogo = computed(() => logoState.value !== 'missing');
	const logoUnreadable = computed(() => logoState.value === 'unreadable');

	async function refreshLogo() {
		if (!vaultPath.value) {
			logoState.value = 'missing';
			return;
		}
		logoState.value = await commands.vaultLogoState(vaultPath.value);
	}

	async function setLogo(): Promise<boolean> {
		const vault = requireVault();
		const [source] = await commands.pickFiles('Obrázek', ['png'], false);
		if (!source) return false;
		await commands.setVaultLogo(vault, source);
		logoState.value = 'ready';
		return true;
	}

	// Stav se po odebrání čte znovu: zástupce loga nestaženého z iCloudu ve složce zůstane.
	async function removeLogo() {
		if (!vaultPath.value) return;
		await commands.removeVaultLogo(vaultPath.value);
		await refreshLogo();
	}

	return {
		setLogo,
		removeLogo,
		hasLogo,
		logoUnreadable,
		refreshLogo,
	};
}
