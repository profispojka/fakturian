import { flushPromises } from '@vue/test-utils';
import { asyncModelRun, assert, asyncProperty, commands, constant, nat } from 'fast-check';
import { describe, expect, it } from 'vitest';

import { clearNuxtState } from '#app';
import { useInvoices } from '~/composables/useInvoices';
import { useSettings } from '~/composables/useSettings';
import { useVault } from '~/composables/useVault';
import { useVaultData } from '~/composables/useVaultData';

import { backend, resetBackend } from '../setup/backend';
import { completeSupplier, validInvoice } from '../setup/fixtures';
import { prepareVault } from '../setup/vault';

import type { AsyncCommand } from 'fast-check';

const VAULTS = ['/vault-a', '/vault-b'] as const;

/** Co má ve které složce ležet; appka se proti tomu kontroluje po každém kroku. */
interface Model {
	current: (typeof VAULTS)[number];
	numbers: Record<(typeof VAULTS)[number], string[]>;
}

interface Real {
	invoices: ReturnType<typeof useInvoices>;
}

function app(): ReturnType<typeof useInvoices> {
	return useNuxtApp().vueApp.runWithContext(useInvoices);
}

/** Restart appky: paměť zmizí, cestu ke složce si appka přečte z úložiště a data znovu ze složky. */
async function restart(real: Real): Promise<void> {
	clearNuxtState();
	await useNuxtApp().vueApp.runWithContext(() => useVault().init());
	await useNuxtApp().vueApp.runWithContext(() => useVaultData().load());
	real.invoices = app();
}

async function check(model: Model, real: Real): Promise<void> {
	const listed = await real.invoices.list();
	expect({
		vault: useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value,
		listed: listed.map((i) => i.number).toSorted(),
	}).toEqual({
		vault: model.current,
		listed: model.numbers[model.current].toSorted(),
	});
	for (const vault of VAULTS) {
		expect([...backend.folder(vault).invoices.keys()].toSorted()).toEqual(model.numbers[vault].toSorted());
	}
}

class Create implements AsyncCommand<Model, Real> {
	check = () => true;
	async run(model: Model, real: Real): Promise<void> {
		const number = await real.invoices.nextNumber();
		if (model.numbers[model.current].includes(number)) throw new Error(`Číslo ${number} už ve složce je.`);
		await real.invoices.save(validInvoice(number), true);
		model.numbers[model.current].push(number);
		await check(model, real);
	}
	toString = () => 'založit';
}

class Edit implements AsyncCommand<Model, Real> {
	constructor(readonly pick: number) {}
	check = (model: Readonly<Model>) => model.numbers[model.current].length > 0;
	async run(model: Model, real: Real): Promise<void> {
		const numbers = model.numbers[model.current];
		const number = numbers[this.pick % numbers.length]!;
		const document = await real.invoices.load(number);
		await real.invoices.save(
			{
				...document,
				note: `Úprava ${this.pick}`,
			},
			false,
		);
		await check(model, real);
	}
	toString = () => `upravit ${this.pick}`;
}

class Remove implements AsyncCommand<Model, Real> {
	constructor(readonly pick: number) {}
	check = (model: Readonly<Model>) => model.numbers[model.current].length > 0;
	async run(model: Model, real: Real): Promise<void> {
		const numbers = model.numbers[model.current];
		const [number] = numbers.splice(this.pick % numbers.length, 1);
		await real.invoices.remove(number!);
		await check(model, real);
	}
	toString = () => `smazat ${this.pick}`;
}

class Switch implements AsyncCommand<Model, Real> {
	check = () => true;
	async run(model: Model, real: Real): Promise<void> {
		const other = model.current === VAULTS[0] ? VAULTS[1] : VAULTS[0];
		await useNuxtApp().vueApp.runWithContext(() => useVault().setVault(other));
		// Přepnutí stránku znovu načte; v testu je odjezd zachycený, takže se restart dohraje ručně.
		await restart(real);
		model.current = other;
		await check(model, real);
	}
	toString = () => 'přepnout složku';
}

class Restart implements AsyncCommand<Model, Real> {
	check = () => true;
	async run(model: Model, real: Real): Promise<void> {
		await restart(real);
		await check(model, real);
	}
	toString = () => 'restart';
}

describe('modelové posloupnosti', () => {
	it('založení, úpravy, mazání, přepínání složek a restarty nepromíchají vaulty ani čísla', async () => {
		await assert(
			asyncProperty(
				commands(
					[
						constant(new Create()),
						nat().map((n) => new Edit(n)),
						nat().map((n) => new Remove(n)),
						constant(new Switch()),
						constant(new Restart()),
					],
					{
						maxCommands: 12,
					},
				),
				async (steps) => {
					clearNuxtState();
					resetBackend();
					await prepareVault({}, VAULTS[1]);
					clearNuxtState();
					await prepareVault({}, VAULTS[0]);
					const real = { invoices: app() };
					await asyncModelRun(
						() => ({
							model: {
								current: VAULTS[0],
								numbers: {
									[VAULTS[0]]: [],
									[VAULTS[1]]: [],
								},
							},
							real,
						}),
						steps,
					);
				},
			),
			{
				numRuns: 64,
			},
		);
	});
});

describe('přepnutí složky během rozběhnutých příkazů', () => {
	it('faktura uložená před přepnutím skončí ve staré složce, ne v nové', async () => {
		await prepareVault({}, VAULTS[1]);
		clearNuxtState();
		await prepareVault({}, VAULTS[0]);
		const invoices = app();
		const pending = backend.postpone('save_invoice');

		const saving = invoices.save(validInvoice('20260001'), true);
		await flushPromises();
		await useNuxtApp().vueApp.runWithContext(() => useVault().setVault(VAULTS[1]));
		pending.finish();
		await saving;

		expect([...backend.folder(VAULTS[0]).invoices.keys()]).toEqual(['20260001']);
		expect([...backend.folder(VAULTS[1]).invoices.keys()]).toEqual([]);
	});

	it('nastavení zapsané před přepnutím skončí ve staré složce, ne v nové', async () => {
		await prepareVault({}, VAULTS[1]);
		clearNuxtState();
		await prepareVault({}, VAULTS[0]);
		const pending = backend.postpone('write_data_file');

		const saving = useNuxtApp().vueApp.runWithContext(() => useSettings().setSupplier(completeSupplier()));
		await flushPromises();
		await useNuxtApp().vueApp.runWithContext(() => useVault().setVault(VAULTS[1]));
		pending.finish();
		await saving;

		expect(backend.readFile(VAULTS[0], 'nastaveni.json').supplier).toEqual(completeSupplier());
		expect(backend.readFile(VAULTS[1], 'nastaveni.json')).toEqual({});
	});
});
