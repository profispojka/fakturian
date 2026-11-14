import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEMO_VAULT, E2E_APP, ROOT } from './app.ts';
import { E2E_TODAY } from './constants.ts';

function run(command: string, args: string[]): void {
	execFileSync(command, args, {
		cwd: ROOT,
		stdio: 'inherit',
	});
}

// Sada pouští appku z `.output-e2e`: frontend z prostředí `e2e` (posunutý dnešek, bez animací,
// `e2e/e2e.client.ts`) a vedle něj tentýž hlavní proces, jaký jde do balíčku.
export default function globalSetup(): void {
	run('bun', ['x', 'nuxt', 'generate', '--envName', 'e2e']);
	run('bun', ['run', 'desktop:build']);
	cpSync(join(ROOT, '.output', 'desktop'), join(E2E_APP, 'desktop'), { recursive: true });
	const { version }: { version: string } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
	// Vlastní jméno odliší sadu od běžného Fakturianu v nabídce i ve výpisu procesů.
	writeFileSync(
		join(E2E_APP, 'package.json'),
		JSON.stringify({
			name: 'fakturian-e2e',
			productName: 'Fakturian E2E',
			version,
			type: 'module',
			main: 'desktop/main.mjs',
		}),
	);
	rmSync(DEMO_VAULT, {
		recursive: true,
		force: true,
	});
	run('node', ['desktop/examples/run.ts', 'demo-vault', DEMO_VAULT, E2E_TODAY]);
}
