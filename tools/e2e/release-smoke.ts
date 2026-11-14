import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bun = 'bun';
const reportDirectory = path.join(root, '.output-release-smoke');
const appBundle = path.join(root, '.output', 'release', `mac-${process.arch}`, 'Fakturian.app');
const appExecutable = path.join(appBundle, 'Contents', 'MacOS', 'Fakturian');
const appOutput = {
	stdout: '',
	stderr: '',
};

interface McpResponse {
	id?: number;
	result?: {
		serverInfo?: { name?: string };
		tools?: { name?: string }[];
		isError?: boolean;
		content?: { text?: string }[];
	};
}

let appProcess: ChildProcess | undefined;
let connectorProcess: ChildProcess | undefined;

if (process.platform !== 'darwin') {
	throw new Error('Smoke test distribučního .app balíčku musí běžet na macOS.');
}

rmSync(reportDirectory, {
	recursive: true,
	force: true,
});
mkdirSync(reportDirectory, { recursive: true });

function recordAppOutput(stream: NodeJS.ReadableStream | null, name: 'stdout' | 'stderr'): void {
	stream?.setEncoding('utf8');
	stream?.on('data', (chunk) => {
		appOutput[name] = `${appOutput[name]}${chunk}`.slice(-64 * 1024);
	});
}

// Musí sedět s `LOADING` v `src/composables/useMcpTools.ts`.
const LOADING = 'Data se ještě načítají. Zkus to za chvíli.';

async function stop(child: ChildProcess, name: string): Promise<boolean> {
	if (child.exitCode !== null || child.signalCode !== null) return false;
	child.kill('SIGTERM');
	const stopped = await Promise.race([
		new Promise((resolve) => child.once('exit', () => resolve(true))),
		delay(5_000, false),
	]);
	if (stopped) return false;
	child.kill('SIGKILL');
	await new Promise((resolve) => child.once('exit', resolve));
	process.stderr.write(`${name} nereagoval na SIGTERM a musel být ukončen SIGKILL.\n`);
	return true;
}

async function waitForSocket(
	socketPath: string,
	appExit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
): Promise<void> {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if (existsSync(socketPath)) {
			const connected = await new Promise((resolve) => {
				const socket = net.createConnection(socketPath);
				socket.once('connect', () => {
					socket.end();
					resolve(true);
				});
				socket.once('error', () => resolve(false));
			});
			if (connected) return;
		}
		const exited = await Promise.race([appExit, delay(100, null)]);
		if (exited) throw new Error(`Distribuční aplikace skončila před připraveností (${JSON.stringify(exited)}).`);
	}
	throw new Error(`Distribuční aplikace do 30 s neotevřela MCP socket ${socketPath}.`);
}

// Connector je tentýž spustitelný soubor jako appka, jen s `--mcp`.
function startConnector(executable: string, env: NodeJS.ProcessEnv) {
	const child = spawn(executable, ['--mcp'], {
		cwd: root,
		env,
		stdio: ['pipe', 'pipe', 'pipe'],
	});
	connectorProcess = child;
	let stderr = '';
	child.stderr.setEncoding('utf8');
	child.stderr.on('data', (chunk) => {
		stderr = `${stderr}${chunk}`.slice(-64 * 1024);
	});

	const responses = new Map<number, { resolve: (message: McpResponse) => void; reject: (error: unknown) => void }>();
	const exit = new Promise((resolve) => {
		child.once('error', (error) => resolve({ error }));
		child.once('exit', (code, signal) =>
			resolve({
				code,
				signal,
			}),
		);
	});
	child.once('exit', (code, signal) => {
		const error = new Error(
			`MCP connector skončil během čekání na odpověď (${JSON.stringify({
				code,
				signal,
			})}).`,
		);
		for (const response of responses.values()) response.reject(error);
		responses.clear();
	});
	const lines = readline.createInterface({ input: child.stdout });
	lines.on('line', (line) => {
		let message: McpResponse;
		try {
			message = JSON.parse(line);
		} catch (error) {
			for (const response of responses.values()) response.reject(error);
			responses.clear();
			return;
		}
		const { id } = message;
		if (id === undefined) return;
		const response = responses.get(id);
		if (!response) return;
		responses.delete(id);
		response.resolve(message);
	});

	function request(id: number, method: string, params?: Record<string, unknown>): Promise<McpResponse> {
		return new Promise<McpResponse>((resolve, reject) => {
			const timeout = setTimeout(() => {
				responses.delete(id);
				reject(new Error(`MCP metoda ${method} do 15 s neodpověděla. ${stderr}`));
			}, 15_000);
			responses.set(id, {
				resolve: (message) => {
					clearTimeout(timeout);
					resolve(message);
				},
				reject: (error) => {
					clearTimeout(timeout);
					reject(error);
				},
			});
			child.stdin.write(
				`${JSON.stringify({
					jsonrpc: '2.0',
					id,
					method,
					params,
				})}\n`,
			);
		});
	}

	return {
		child,
		exit,
		request,
		stderr: () => stderr,
	};
}

// Socket MCP leží v tomhle domově a `sun_path` unese 104 bajtů; `tmpdir()` v dlouhé `/var/folders/…`
// cestě by limit přetekl. PID odliší souběžné běhy.
const runRoot = mkdtempSync(`/tmp/frs-${process.pid}-`);
const isolatedHome = path.join(runRoot, 'home');
const socketPath = path.join(isolatedHome, 'Library', 'Application Support', 'com.fakturian.desktop', 'mcp.sock');
mkdirSync(isolatedHome, { recursive: true });
const isolatedEnvironment = {
	...process.env,
	HOME: isolatedHome,
	XDG_CACHE_HOME: path.join(runRoot, 'cache'),
	XDG_CONFIG_HOME: path.join(runRoot, 'config'),
	XDG_DATA_HOME: path.join(runRoot, 'data'),
};

let forcedTermination = false;
let result = 'failed';
try {
	// Job `package` v CI balíček staví sám a `--prebuilt` spustí právě ten, ze kterého vznikly DMG a ZIP.
	if (!process.argv.includes('--prebuilt')) {
		// Stačí rozbalená `.app` bez podpisu: smoke ověřuje obsah balíčku, ne identitu vývojáře, a hledání
		// identity by sahalo do klíčenky toho, kdo ho pouští.
		for (const args of [
			['run', 'generate'],
			['run', 'desktop:build'],
			['x', 'electron-builder', '--config', 'electron-builder.yml', '--dir', '-c.mac.identity=null'],
		]) {
			execFileSync(bun, args, {
				cwd: root,
				stdio: 'inherit',
			});
		}
	}
	accessSync(appExecutable, constants.X_OK);

	const launchedApp = spawn(appExecutable, [], {
		cwd: runRoot,
		env: isolatedEnvironment,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	appProcess = launchedApp;
	recordAppOutput(launchedApp.stdout, 'stdout');
	recordAppOutput(launchedApp.stderr, 'stderr');
	const appExit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
		launchedApp.once('error', reject);
		launchedApp.once('exit', (code, signal) =>
			resolve({
				code,
				signal,
			}),
		);
	});
	await waitForSocket(socketPath, appExit);

	const connector = startConnector(appExecutable, isolatedEnvironment);
	const initialized = await connector.request(1, 'initialize', {
		protocolVersion: '2024-11-05',
		capabilities: {},
		clientInfo: {
			name: 'release-smoke',
			version: '1.0.0',
		},
	});
	assert.equal(initialized.result?.serverInfo?.name, 'fakturian');

	const tools = await connector.request(2, 'tools/list');
	assert.ok(tools.result?.tools?.some((tool) => tool.name === 'list_invoices'));

	// Okno se k mostu připojí dřív, než dočte nastavení; do té doby nástroj hlásí načítání.
	let text = LOADING;
	for (let id = 3; text === LOADING && id < 63; id++) {
		const call = await connector.request(id, 'tools/call', {
			name: 'list_invoices',
			arguments: {},
		});
		assert.equal(call.result?.isError, true);
		const answer = call.result?.content?.[0]?.text;
		assert.ok(answer !== undefined);
		text = answer;
		if (text === LOADING) await delay(250);
	}
	assert.equal(text, 'Fakturian nemá zvolenou datovou složku.');

	connector.child.stdin.end();
	const connectorExit = await connector.exit;
	assert.deepEqual(
		connectorExit,
		{
			code: 0,
			signal: null,
		},
		connector.stderr(),
	);
	connectorProcess = undefined;
	result = 'passed';
	process.stdout.write(
		'Distribuční Fakturian nastartoval, načetl frontend a odpověděl agentovi přes MCP connector.\n',
	);
} finally {
	if (connectorProcess) forcedTermination = (await stop(connectorProcess, 'MCP connector')) || forcedTermination;
	if (appProcess) forcedTermination = (await stop(appProcess, 'Fakturian')) || forcedTermination;
	if (forcedTermination) result = 'failed';
	writeFileSync(path.join(reportDirectory, 'app.stdout.log'), appOutput.stdout);
	writeFileSync(path.join(reportDirectory, 'app.stderr.log'), appOutput.stderr);
	writeFileSync(
		path.join(reportDirectory, 'report.json'),
		`${JSON.stringify(
			{
				result,
				forcedTermination,
				bundle: appBundle,
			},
			null,
			2,
		)}\n`,
	);
	rmSync(runRoot, {
		recursive: true,
		force: true,
	});
}

if (forcedTermination) throw new Error('Některý proces se nepodařilo bezpečně ukončit.');
