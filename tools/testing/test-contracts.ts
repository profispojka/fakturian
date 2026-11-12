import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { build, type Plugin } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const outdir = `${root}node_modules/.cache/fakturian-contracts`;
const pkg: { dependencies: Record<string, string> } = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));

// Kontrakt Fio nesmí sahat na klíčenku uživatele; token drží most jen v paměti.
const memoryKeyring: Plugin = {
	name: 'memory-keyring',
	setup(bundle) {
		bundle.onResolve({ filter: /^@napi-rs\/keyring$/ }, () => ({
			path: 'keyring',
			namespace: 'memory-keyring',
		}));
		bundle.onLoad(
			{
				filter: /.*/,
				namespace: 'memory-keyring',
			},
			() => ({
				loader: 'js',
				contents: `let password = null;
export class AsyncEntry {
	getPassword() { return Promise.resolve(password); }
	setPassword(value) { password = value; return Promise.resolve(); }
	deleteCredential() { password = null; return Promise.resolve(true); }
}`,
			}),
		);
	},
};

// Most se staví stejně jako hlavní proces v `tools/desktop/build.ts`, validátor ISDOC vedle něj.
await build({
	entryPoints: {
		'contract-bridge': 'desktop/test/contract-bridge.ts',
		validator: 'desktop/isdoc/validator.ts',
	},
	bundle: true,
	platform: 'node',
	target: 'node24',
	format: 'esm',
	outdir,
	outExtension: {
		'.js': '.mjs',
	},
	external: Object.keys(pkg.dependencies).filter((name) => name !== '@napi-rs/keyring'),
	alias: {
		'~': `${root}src`,
	},
	loader: {
		'.typ': 'text',
		'.xsd': 'text',
	},
	banner: {
		js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
	},
	plugins: [memoryKeyring],
	logLevel: 'warning',
	absWorkingDir: root,
});

execFileSync(
	process.execPath,
	['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.contracts.config.ts', ...process.argv.slice(2)],
	{
		cwd: root,
		stdio: 'inherit',
		env: {
			...process.env,
			FAKTURIAN_CONTRACT_BRIDGE: `${outdir}/contract-bridge.mjs`,
		},
	},
);
