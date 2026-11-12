import { FIO_REQUEST_INTERVAL_SECONDS } from '~/constants/fio';
import { fioServices } from '~/services/fio';
import { errorText } from '~/utils/errors';

import type { FioPayment } from '~/schemas/fio';
import type { DateString } from '~/utils/date';

export function useFio() {
	const hasToken = useState<boolean>('fioHasToken', () => false);

	// Chyba klíčenky je něco jiného než prázdná klíčenka: zamčená klíčenka vypadá jako „token není
	// uložený" a uložit ho do ní taky nejde.
	const tokenError = useState<string>('fioTokenError', () => '');

	// Toast o selhání zmizí, ale párování plateb stojí dál — Integrace to proto drží, dokud se další
	// synchronizace nepovede.
	const syncError = useState<string>('fioSyncError', () => '');

	// Druhý dotaz do 30 s Fio odmítne a limit se váže k tokenu, takže nový token čeká od nuly. Měří se
	// `performance.now()`: jde o uplynulý čas, ne o datum, a posun systémových hodin ho nerozhodí.
	const lastRequestAt = useState<number | null>('fioLastRequestAt', () => null);

	async function refreshHasToken() {
		try {
			hasToken.value = await fioServices.hasToken();
			tokenError.value = '';
		} catch (e) {
			hasToken.value = false;
			tokenError.value = errorText(e);
		}
	}

	// Chyba patřila starému tokenu; jestli nový funguje, řekne až další synchronizace.
	async function setToken(token: string) {
		await fioServices.setToken(token);
		syncError.value = '';
		lastRequestAt.value = null;
		await refreshHasToken();
	}

	async function clearToken() {
		await fioServices.clearToken();
		syncError.value = '';
		await refreshHasToken();
	}

	async function fetchPayments(from: DateString, to: DateString): Promise<FioPayment[]> {
		await refreshHasToken();
		if (!hasToken.value) {
			throw new Error(tokenError.value || 'Fio token není uložený — vlož ho v Integracích.');
		}
		const now = performance.now();
		if (lastRequestAt.value !== null) {
			const waitSeconds = Math.ceil(FIO_REQUEST_INTERVAL_SECONDS - (now - lastRequestAt.value) / 1000);
			if (waitSeconds > 0) throw new Error(`Fio dovolí další dotaz až za ${waitSeconds} s.`);
		}
		lastRequestAt.value = now;
		try {
			const payments = await fioServices.fetchPayments(from, to);
			return payments;
		} catch (e) {
			// Jestli nepovedený dotaz k Fiu vůbec došel, se odsud nepozná; když ano, další odmítne Fio samo.
			lastRequestAt.value = null;
			throw e;
		}
	}

	return {
		hasToken,
		tokenError,
		syncError,
		refreshHasToken,
		setToken,
		clearToken,
		fetchPayments,
	};
}
