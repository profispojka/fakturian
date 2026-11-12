import { type ChildProcess, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// Dev server Nuxtu s HMR a Electron na jeho adrese jedním příkazem. Změna v `desktop/` potřebuje
// nový start, frontend se obnoví sám. Další argumenty (`--remote-debugging-port=9222`) jdou Electronu.
const root = fileURLToPath(new URL('../..', import.meta.url));
const DEV_URL = 'http://127.0.0.1:1420';
// Binárka Electronu přímo, ne obal z `.bin`: ten signál neposílá dál a okno by přežilo konec.
const electronBinary: string = createRequire(import.meta.url)('electron');

const children = new Set<ChildProcess>();

function start(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): ChildProcess {
	const child = spawn(command, args, {
		cwd: root,
		stdio: 'inherit',
		env,
	});
	children.add(child);
	child.on('exit', () => children.delete(child));
	return child;
}

function stop(code: number): never {
	for (const child of children) child.kill('SIGTERM');
	process.exit(code);
}

function exited(child: ChildProcess): Promise<number> {
	return new Promise((done) => child.on('exit', (code) => done(code ?? 1)));
}

process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));

const nuxt = start(`${root}node_modules/.bin/nuxt`, ['dev']);
// Bez dev serveru by Electron ukazoval prázdné okno.
nuxt.on('exit', (code) => {
	console.error(`Dev server Nuxtu skončil s kódem ${code}.`);
	stop(code === null || code === 0 ? 1 : code);
});

const built = await exited(start(process.execPath, ['tools/desktop/build.ts']));
if (built !== 0) stop(built);

for (;;) {
	const [answer] = await Promise.allSettled([fetch(DEV_URL)]);
	if (answer.status === 'fulfilled') break;
	await sleep(300);
}

const electron = start(electronBinary, ['.', ...process.argv.slice(2)], {
	...process.env,
	FAKTURIAN_DEV_URL: DEV_URL,
});
stop(await exited(electron));
