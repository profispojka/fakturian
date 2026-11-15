import { aresServices } from '~/services/ares';
import { errorText } from '~/utils/errors';
import { isValidIco } from '~/utils/validators';

import type { AresParty } from '~/schemas/ares';

export function useAres() {
	const loading = ref(false);
	const error = ref('');

	async function lookup(input: string): Promise<AresParty | null> {
		const ico = input.replace(/\s+/g, '');
		error.value = '';
		if (!ico) {
			error.value = 'Zadej nejdřív IČO.';
			return null;
		}
		// Překlep v kontrolní číslici se pozná hned, bez vteřiny čekání na hlášku o nenalezené firmě.
		if (!isValidIco(ico)) {
			error.value = 'Neplatné IČO (8 číslic).';
			return null;
		}

		loading.value = true;
		try {
			const company = await aresServices.query(ico);
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
