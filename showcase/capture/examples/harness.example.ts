/**
 * Harness = to, co appce v prohlížeči podstrčí demo data.
 *
 * Injektuje se přes `initScripts` do **každého** dokumentu ještě před během
 * appky, takže stihne obsadit `fetch`, `localStorage` i nativní most.
 * Zkopíruj do `showcase/harness/demo-data.ts` a nech si jen tu variantu,
 * která odpovídá tvé aplikaci.
 *
 * Tři pravidla, ať z toho nevznikne problém:
 *   1. **Data si vymysli, ale ať sedí.** Částky, jména a data musí dávat smysl
 *      dohromady — návštěvník pozná „lorem ipsum" i v číslech.
 *   2. **Nikdy skutečná data.** Žádní opravdoví zákazníci, e-maily, IBANy.
 *      Používej neutrální jména a jasně smyšlené identifikátory.
 *   3. **Harness nesmí do produkce.** Žije v `showcase/`, ne v appce.
 */
(() => {
	interface HarnessArgs {
		name?: string;
		json?: string;
	}

	type HarnessHandler = (args: HarnessArgs) => unknown;

	// ————————————————————————————————————————————————————————————————
	// A) Aplikace s nativním mostem (Tauri, Electron, WebView)
	//    Appka volá `invoke('command', args)`; tady mu odpovídáme z paměti.
	//    Názvy příkazů zjistíš v kódu appky (u Tauri `generate_handler![…]`).
	// ————————————————————————————————————————————————————————————————
	const files: Record<string, unknown> & {
		items: { id: string; title: string; amount: number; state: string }[];
	} = {
		settings: {
			name: 'Ukázkový provoz',
			currency: 'CZK',
		},
		items: [
			{
				id: 'a1',
				title: 'První položka',
				amount: 12_400,
				state: 'done',
			},
			{
				id: 'a2',
				title: 'Druhá položka',
				amount: 3_900,
				state: 'open',
			},
		],
	};

	const handlers: Record<string, HarnessHandler> = {
		read_data_file: ({ name }) => JSON.stringify((name && files[name]) ?? {}),
		// `conflict` by znamenal, že soubor mezitím změnil někdo jiný; harness nic takového nemá.
		write_data_file: ({ name, json }) => {
			if (!name || !json) throw new Error('Chybí název nebo obsah souboru.');
			files[name] = JSON.parse(json) as unknown;
			return 'written';
		},
		list_items: () => files.items,
		// Cokoli, co harness neumí (generování PDF, tisk, přístup k síti),
		// nahraď hotovým výsledkem — statickým fixturem.
		preview_document: () => '<html><body><h1>Ukázkový doklad</h1></body></html>',
	};

	window.__TAURI_INTERNALS__ = {
		invoke: async (cmd: string, args: unknown = {}) => {
			const fn = handlers[cmd];
			if (!fn) {
				console.warn('[harness] nepokrytý příkaz:', cmd, args);
				return null;
			}
			const commandArgs = typeof args === 'object' && args !== null ? (args as HarnessArgs) : {};
			return await fn(commandArgs);
		},
		transformCallback: (fn: (...args: unknown[]) => unknown) => fn,
		metadata: {
			currentWindow: {
				label: 'main',
			},
			currentWebview: {
				label: 'main',
			},
		},
	};

	// ————————————————————————————————————————————————————————————————
	// B) Aplikace s HTTP API
	//    Jednodušší varianta je `page.route()` na straně Playwrightu (viz
	//    `prepare` ve stage.ts). Tohle použij, když appka volá fetch hned
	//    při startu a nechceš řešit časování.
	// ————————————————————————————————————————————————————————————————
	const api: Record<string, unknown> = {
		'/api/me': {
			name: 'Alex Novák',
			plan: 'pro',
		},
		'/api/items': files.items,
	};
	const realFetch = window.fetch.bind(window);
	window.fetch = async (input, init) => {
		let url: string;
		if (typeof input === 'string') url = input;
		else if (input instanceof Request) url = input.url;
		else url = input.href;
		const hit = Object.keys(api).find((k) => url.includes(k));
		if (!hit) return await realFetch(input, init);
		return new Response(JSON.stringify(api[hit]), {
			status: 200,
			headers: {
				'content-type': 'application/json',
			},
		});
	};

	// ————————————————————————————————————————————————————————————————
	// C) Aplikace, která si stav drží v prohlížeči
	// ————————————————————————————————————————————————————————————————
	localStorage.setItem('onboarding-done', '1');
	localStorage.setItem('theme', 'light');

	// Vlaječka pro appku: může podle ní schovat pravé okno průvodce, telemetrii
	// nebo vyskakovací hlášky. Ať je vidět, že jde o demo režim.
	window.__DEMO_MODE__ = true;
})();
