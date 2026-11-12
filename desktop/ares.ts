import { isValidIco } from '~/utils/validators';

import { parseJson } from './store.ts';
import { USER_AGENT } from './util.ts';

const ARES_BASE = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest';
const TIMEOUT = 15_000;

// Syrová odpověď rejstříku; tvar ověřuje `parseAres` ve frontendu.
export async function aresSubject({ ico }: { ico: string }): Promise<unknown> {
	// IČO jde do cesty URL a `isValidIco` mezery mezi číslicemi toleruje.
	if (/\s/.test(ico) || !isValidIco(ico)) throw new Error('Neplatné IČO (8 číslic).');
	let response: Response;
	try {
		// Přesměrování by dotaz poslalo na adresu, kterou appka nezná.
		response = await fetch(`${ARES_BASE}/ekonomicke-subjekty/${ico}`, {
			redirect: 'manual',
			signal: AbortSignal.timeout(TIMEOUT),
			headers: {
				'User-Agent': USER_AGENT,
			},
		});
	} catch (error) {
		throw new Error('Nepodařilo se spojit s ARES (jste offline?).', { cause: error });
	}
	if (!response.ok) {
		await response.body?.cancel();
		if (response.status === 404) throw new Error('Firma s tímto IČO nebyla v ARES nalezena.');
		throw new Error(`ARES vrátil chybu ${response.status}.`);
	}
	try {
		const text = await response.text();
		return parseJson(text);
	} catch (error) {
		throw new Error('Odpověď z ARES se nepodařilo přečíst.', { cause: error });
	}
}
