import { array, assert, asyncProperty, boolean, constantFrom, integer, scheduler, tuple } from 'fast-check';
import { describe, expect, it } from 'vitest';

import { clearNuxtState } from '#app';
import { useAdopt } from '~/composables/useAdopt';
import { useImport } from '~/composables/useImport';
import { useInvoices } from '~/composables/useInvoices';
import { useVaultFile } from '~/composables/useVaultFile';
import { newInvoice } from '~/schemas/invoices';
import { z } from '~/utils/zod';

import { backend, resetBackend, wireInvoice } from '../setup/backend';
import { validInvoice } from '../setup/fixtures';
import { prepareVault } from '../setup/vault';

const NUMBERS = ['20260001', '20260002', '20260003'];

const action = tuple(constantFrom('list', 'archived', 'remove', 'markSent'), constantFrom(...NUMBERS));

describe('souběh příkazů a selhání IPC', () => {
	it('zapamatovaný archiv faktur sedí s obsahem složky, ať odpovědi doběhnou v jakémkoli pořadí', async () => {
		await assert(
			asyncProperty(
				scheduler(),
				array(action, {
					minLength: 1,
					maxLength: 6,
				}),
				array(boolean(), {
					maxLength: 20,
				}),
				async (s, actions, faults) => {
					// Nuxt runtime žije přes celý soubor, takže každý běh začíná od čistého stavu sám.
					clearNuxtState();
					resetBackend();
					await prepareVault();
					for (const number of NUMBERS) {
						backend.folder('/vault').invoices.set(
							number,
							wireInvoice({
								...newInvoice(null, number),
								lines: [
									{
										id: 'r1',
										description: 'Práce',
										quantity: 1,
										unit: 'hod',
										unitPriceCents: 100_000,
									},
								],
							}),
						);
					}

					const invoices = useNuxtApp().vueApp.runWithContext(useInvoices);
					const steps = {
						list: invoices.list,
						archived: invoices.archived,
						remove: invoices.remove,
						markSent: invoices.markSent,
					};
					const pendingFaults = [...faults];
					backend.scheduler = s;
					backend.fault = () => (pendingFaults.shift() ? 'Disk je odpojený.' : null);
					// Výsledek ani selhání jednotlivých kroků se tu nehodnotí; rozhoduje stav po doběhnutí všech.
					const running = Promise.allSettled(actions.map(([kind, number]) => steps[kind](number)));
					await s.waitFor(running);

					backend.scheduler = null;
					backend.fault = null;
					const remembered = await invoices.archived();
					const onDisk = await invoices.list();
					expect(remembered).toEqual(onDisk);
				},
			),
		);
	});

	it('po souběžných uloženích s nepovedenými zápisy ukazuje paměť přesně to, co leží na disku', async () => {
		await assert(
			asyncProperty(
				array(integer(), {
					minLength: 1,
					maxLength: 6,
				}),
				array(boolean(), {
					maxLength: 6,
				}),
				async (edits, faults) => {
					clearNuxtState();
					resetBackend();
					await prepareVault({
						'zkouska.json': {
							items: [],
						},
					});
					const file = useNuxtApp().vueApp.runWithContext(() =>
						useVaultFile(
							'zkouska.json',
							() => ({
								items: [],
							}),
							z.object({
								items: z.array(z.number()),
							}),
						),
					);
					await file.load();

					const pendingFaults = [...faults];
					backend.fault = (command) =>
						command === 'write_data_file' && pendingFaults.shift() ? 'Disk je plný.' : null;
					// Každá změna se ukládá hned, bez čekání na předchozí zápis; selhání se hodnotí jen stavem.
					const saving = Promise.allSettled(
						edits.map((n) => {
							file.data.value.items.push(n);
							return file.save();
						}),
					);
					await saving;

					expect(file.data.value).toEqual(backend.readFile('/vault', 'zkouska.json'));
				},
			),
		);
	});

	it('souběžná uložení formuláře a agenta roční limit položky nepřečerpají', async () => {
		const LIMIT = 10;
		await assert(
			asyncProperty(
				scheduler(),
				array(
					integer({
						min: 1,
						max: LIMIT,
					}),
					{
						minLength: 2,
						maxLength: 5,
					},
				),
				array(boolean(), {
					maxLength: 12,
				}),
				async (s, quantities, faults) => {
					clearNuxtState();
					resetBackend();
					await prepareVault({
						'nastaveni.json': {
							supplier: null,
							contacts: [],
							pricelist: [
								{
									id: 'p1',
									name: 'Konzultace',
									priceCents: 120_000,
									unit: 'hod',
									annualLimit: LIMIT,
								},
							],
						},
					});
					const invoices = useNuxtApp().vueApp.runWithContext(useInvoices);
					const pendingFaults = [...faults];
					backend.scheduler = s;
					backend.fault = (command) =>
						['list_invoices', 'save_invoice'].includes(command) && pendingFaults.shift()
							? 'Disk je odpojený.'
							: null;
					// Každé uložení je jiný doklad; čerpají tutéž položku za stejný rok.
					const saving = Promise.allSettled(
						quantities.map((quantity, i) => {
							const inv = validInvoice(`2026000${i + 1}`);
							inv.lines = inv.lines.map((line) => ({
								...line,
								quantity,
								itemId: 'p1',
							}));
							return invoices.save(inv, true);
						}),
					);
					await s.waitFor(saving);

					const used = [...backend.folder('/vault').invoices.values()]
						.flatMap((inv) => inv.lines)
						.reduce((sum, line) => sum + line.quantity, 0);
					expect(used).toBeLessThanOrEqual(LIMIT);
				},
			),
		);
	});

	it('import a převzetí souběžně s uložením a výpisem doklad neztratí ani nezdvojí', async () => {
		await assert(
			asyncProperty(
				scheduler(),
				array(constantFrom('import', 'adopt', 'save', 'list'), {
					minLength: 1,
					maxLength: 6,
				}),
				array(boolean(), {
					maxLength: 20,
				}),
				async (s, actions, faults) => {
					clearNuxtState();
					resetBackend();
					await prepareVault();
					const foreign = NUMBERS.map((number) => [`/vault/Faktura ${number}.pdf`, number] as const);
					for (const [path, number] of foreign) {
						backend.foreign.set(path, wireInvoice(validInvoice(number)));
					}
					const app = useNuxtApp().vueApp.runWithContext(() => ({
						invoices: useInvoices(),
						importing: useImport(),
						adopting: useAdopt(),
					}));
					const steps = {
						import: () => app.importing.importFiles(foreign.map(([path]) => path)),
						adopt: async () => {
							const scan = await app.adopting.refresh();
							if (scan) await app.adopting.adopt(scan);
						},
						save: () => app.invoices.save(validInvoice(NUMBERS[0]!), true),
						list: () => app.invoices.list(),
					};
					const pendingFaults = [...faults];
					backend.scheduler = s;
					backend.fault = () => (pendingFaults.shift() ? 'Disk je odpojený.' : null);
					const running = Promise.allSettled(actions.map((kind) => steps[kind]()));
					await s.waitFor(running);

					backend.scheduler = null;
					backend.fault = null;
					// Každý cizí doklad je buď pořád venku, nebo právě jednou v `faktury/`; číslo z formuláře taky.
					const inArchive = [...backend.folder('/vault').invoices.keys()];
					const outside = [...backend.foreign.values()].map((inv) => inv.number);
					for (const number of NUMBERS) {
						expect(inArchive.includes(number) || outside.includes(number)).toBe(true);
					}
					expect(new Set(inArchive).size).toBe(inArchive.length);
					expect(await app.invoices.archived()).toEqual(await app.invoices.list());
				},
			),
		);
	});
});
