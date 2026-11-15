import { readFile } from 'node:fs/promises';

import xmllint from 'xmllint-wasm/xmllint-node.js';

export interface Validation {
	code: number;
	stderr: string;
}

// Modul se přeloží jednou za život workeru. Instance je na každou kontrolu nová: xmllint po doběhnutí
// `main` skončí a znovu spustit nejde.
async function compile(): Promise<WebAssembly.Module> {
	const bytes = await readFile(new URL('xmllint.wasm', import.meta.resolve('xmllint-wasm/xmllint-node.js')));
	return WebAssembly.compile(bytes);
}

const compiled = compile();

// XSD jde s každou kontrolou: ze zdrojů ho Node jako text nenačte, v bundlu vedle workeru neleží.
export default async function validate({ xml, schema }: { xml: string; schema: string }): Promise<Validation> {
	const module = await compiled;
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
	return {
		code,
		stderr,
	};
}
