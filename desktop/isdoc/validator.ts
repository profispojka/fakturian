import { readFile } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';

// Modul se přeloží jednou za život workeru. Instance je na každou kontrolu nová: xmllint po doběhnutí
// `main` skončí a znovu spustit nejde.
async function compile(): Promise<WebAssembly.Module> {
	const bytes = await readFile(new URL('xmllint.wasm', import.meta.resolve('xmllint-wasm/xmllint-node.js')));
	return WebAssembly.compile(bytes);
}

if (!parentPort || typeof workerData !== 'string')
	throw new Error('Validátor ISDOC běží jen jako worker se schématem.');
const port = parentPort;
const schema = workerData;
const compiled = compile();
// Dynamický import se vyhodnotí až za registrací našeho posluchače. `xmllint-node.js` přidá vlastní,
// který zprávy bez své značky zahodí; zpráva doručená před tím naším by se ztratila.
const glue = import('xmllint-wasm/xmllint-node.js');

async function validate(xml: string): Promise<void> {
	const [{ default: xmllint }, module] = await Promise.all([glue, compiled]);
	let code = -1;
	let stderr = '';
	await xmllint({
		inputFiles: [
			{
				fileName: 'invoice.isdoc',
				contents: xml,
			},
			{
				fileName: 'isdoc.xsd',
				contents: schema,
			},
		],
		arguments: ['--schema', 'isdoc.xsd', '--noout', 'invoice.isdoc'],
		printErr: (line: string) => {
			stderr += `${line}\n`;
		},
		onExit: (exit: number) => {
			code = exit;
		},
		// Doklad, kterému 32 MiB nestačí, libxml2 odmítne jako vadný, místo aby zabral paměť appky.
		wasmMemory: new WebAssembly.Memory({
			initial: 256,
			maximum: 512,
		}),
		instantiateWasm: (
			imports: WebAssembly.Imports,
			done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
		) => {
			const instance = new WebAssembly.Instance(module, imports);
			done(instance, module);
			return instance.exports;
		},
	});
	// Prázdný seznam přenášených bufferů: bez něj lint plete `postMessage` s tím z `window`.
	port.postMessage(
		{
			code,
			stderr,
		},
		[],
	);
}

// Posluchač zpráv je synchronní; kontrolu, která vyhodí, ohlásí hlavnímu vláknu událost `error` workeru.
port.on('message', (xml: string) => {
	void validate(xml);
});
