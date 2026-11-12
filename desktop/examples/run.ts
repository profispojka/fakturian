import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

// Příklad sdílí kód appky s aliasem `~/` a šablonami Typstu jako text, takže se před spuštěním zabalí
// stejně jako v `tools/desktop/build.ts`. Validátor ISDOC běží jako worker vedle bundlu.
const root = fileURLToPath(new URL('../..', import.meta.url));
const EXAMPLES = ['demo-vault', 'e2e-invoice'];

const [example, ...args] = process.argv.slice(2);
if (example === undefined || !EXAMPLES.includes(example)) {
	console.error(`Použití: node desktop/examples/run.ts <${EXAMPLES.join('|')}> …`);
	process.exit(2);
}

const manifest = await readFile(`${root}package.json`, 'utf8');
const pkg: { dependencies: Record<string, string> } = JSON.parse(manifest);
const outdir = `${root}.output/examples`;
await build({
	bundle: true,
	platform: 'node',
	target: 'node24',
	format: 'esm',
	external: Object.keys(pkg.dependencies),
	alias: {
		'~': `${root}src`,
	},
	loader: {
		'.typ': 'text',
		'.xsd': 'text',
	},
	logLevel: 'warning',
	absWorkingDir: root,
	entryPoints: {
		[example]: `desktop/examples/${example}.ts`,
		validator: 'desktop/isdoc/validator.ts',
	},
	outdir,
	outExtension: {
		'.js': '.mjs',
	},
	// Bundle v ESM nemá `require`; jméno nesmí kolidovat s `createRequire`, který importuje kód sám.
	banner: {
		js: "import { createRequire as bannerRequire } from 'node:module'; const require = bannerRequire(import.meta.url);",
	},
});

const { status } = spawnSync(process.execPath, [`${outdir}/${example}.mjs`, ...args], { stdio: 'inherit' });
process.exitCode = status ?? 1;
