import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { homeDir } from './preferences.ts';

export async function log(message: string): Promise<void> {
	try {
		const file = join(homeDir(), 'Library', 'Logs', 'com.fakturian.desktop', 'Fakturian.log');
		await mkdir(dirname(file), { recursive: true });
		await appendFile(file, `${new Date().toISOString()} ${message}\n`);
	} catch {
		// Zprávu uvidí aspoň terminál, ze kterého appka běží. Zápis nesmí shodit to, co se loguje.
		try {
			process.stderr.write(`${message}\n`);
		} catch {
			// Když selže i stderr, není komu to ohlásit.
		}
	}
}
