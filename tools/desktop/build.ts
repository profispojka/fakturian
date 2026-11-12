import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { build, type BuildOptions } from 'esbuild';

const root = fileURLToPath(new URL('../..', import.meta.url));
const pkg: { dependencies: Record<string, string> } = JSON.parse(await readFile(`${root}package.json`, 'utf8'));

// V balíčku `.app` leží jen `dependencies`: nativní addony a wasm, které esbuild nezabalí. Všechno
// ostatní je v bundlu, proto frontend a nástroje patří do `devDependencies`.
const shared: BuildOptions = {
	bundle: true,
	platform: 'node',
	target: 'node24',
	sourcemap: 'linked',
	external: ['electron', ...Object.keys(pkg.dependencies)],
	alias: {
		'~': `${root}src`,
	},
	loader: {
		'.typ': 'text',
		'.xsd': 'text',
	},
	logLevel: 'warning',
	absWorkingDir: root,
};

await Promise.all([
	build({
		...shared,
		entryPoints: {
			main: 'desktop/main.ts',
			validator: 'desktop/isdoc/validator.ts',
		},
		outdir: '.output/desktop',
		format: 'esm',
		outExtension: {
			'.js': '.mjs',
		},
		// Bundle v ESM nemá `require`; závislosti psané v CommonJS si ho berou z `createRequire`. Alias,
		// protože zabalený modul smí `createRequire` importovat sám.
		banner: {
			js: "import { createRequire as bannerRequire } from 'node:module'; const require = bannerRequire(import.meta.url);",
		},
	}),
	// Preload v sandboxu Electronu nesmí být ES modul.
	build({
		...shared,
		entryPoints: {
			preload: 'desktop/preload.ts',
		},
		outdir: '.output/desktop',
		format: 'cjs',
		outExtension: {
			'.js': '.cjs',
		},
	}),
]);
