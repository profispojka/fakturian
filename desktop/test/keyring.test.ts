import { spawnSync } from 'node:child_process';

import { AsyncEntry } from '@napi-rs/keyring';
import { describe, expect, it } from 'vitest';

const SERVICE = 'com.fakturian.desktop.test';
const ACCOUNT = 'keyring-backend-probe';
const SECRET = 'hodnota-ktera-musi-prezit-novy-zaznam';

describe('skutečná klíčenka', () => {
	it('nový záznam přečte uložené heslo a po smazání vrátí null', async () => {
		const written = new AsyncEntry(SERVICE, ACCOUNT);
		try {
			await written.setPassword(SECRET);
		} catch (error) {
			throw new Error(
				'Do klíčenky nejde zapsat. Test ověřuje skutečné úložiště macOS; v sandboxu Claude Code ho pusť s vypnutým sandboxem.',
				{ cause: error },
			);
		}
		// `fioHasToken` se ptá hledáním přes `security`, aby nečetl heslo; skutečné úložiště musí položku
		// knihovny najít a po smazání už ne.
		const search = () =>
			spawnSync('/usr/bin/security', ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT]).status;
		try {
			expect(await new AsyncEntry(SERVICE, ACCOUNT).getPassword()).toBe(SECRET);
			expect(search()).toBe(0);
		} finally {
			await written.deleteCredential();
		}

		expect(await new AsyncEntry(SERVICE, ACCOUNT).getPassword()).toBe(null);
		expect(search()).toBe(44);
		expect(await written.deleteCredential()).toBe(false);
	});
});
