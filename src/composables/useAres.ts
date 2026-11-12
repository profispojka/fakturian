import { aresServices } from '~/services/ares';
import { errorText } from '~/utils/errors';
import { isValidIco } from '~/utils/validators';

import type { AresParty } from '~/schemas/ares';

export function useAres() {
	const loading = ref(false);
	const error = ref('');

	async function lookup(ico: string): Promise<AresParty | null> {
		error.value = '';
		const digits = ico.replace(/\s+/g, '');
		if (!digits) {
			error.value = 'Zadej nejdřív IČO.';
			return null;
		}
		// Překlep v kontrolní číslici se pozná hned, bez vteřiny čekání na hlášku o nenalezené firmě.
		if (!isValidIco(digits)) {
			error.value = 'Neplatné IČO (8 číslic).';
			return null;
		}

		loading.value = true;
		try {
			const company = await aresServices.query(digits);
			return company;
		} catch (e) {
			error.value = errorText(e);
			return null;
		} finally {
			loading.value = false;
		}
	}

	return {
		loading,
		error,
		lookup,
	};
}
