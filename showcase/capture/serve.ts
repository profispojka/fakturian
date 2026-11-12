#!/usr/bin/env node
/**
 * Statický server pro focení — Fakturian je SPA, takže `/invoice` musí vrátit
 * `index.html`, ne 404.
 *
 *   node showcase/capture/serve.ts [--dir .output/public] [--port 3902]
 */
import { createServer } from 'node:http';
import path from 'node:path';

import sirv from 'sirv';

import { parseArgs } from './lib/util.ts';

const args = parseArgs();
const root = path.resolve(process.cwd(), args.dir ?? '.output/public');
const port = Number(args.port ?? 3902);

// `dev` čte soubory při každém dotazu a posílá `no-store`: build se mezi focením přepisuje.
const serve = sirv(root, { dev: true, single: true });

createServer((req, res) => {
	serve(req, res);
}).listen(port, '127.0.0.1', () => {
	console.log(`[serve] ${root} → http://127.0.0.1:${port}`);
});
