// Hlavní proces se typuje bez `lib.dom`, kde TypeScript WebAssembly popisuje; tady je jen to, co
// používá `validator.ts`.
declare namespace WebAssembly {
	type Imports = Record<string, Record<string, unknown>>;
	class Module {
		readonly [Symbol.toStringTag]: string;
	}
	class Instance {
		constructor(module: Module, imports?: Imports);
		readonly exports: Record<string, unknown>;
	}
	class Memory {
		constructor(descriptor: { initial: number; maximum?: number });
		readonly buffer: ArrayBuffer;
	}
	function compile(bytes: Uint8Array): Promise<Module>;
}

// Lepidlo Emscriptenu, které `xmllint-wasm` pouští ve vlastním workeru; balíček typuje jen obal kolem něj.
declare module 'xmllint-wasm/xmllint-node.js' {
	interface XmllintRun {
		inputFiles: { fileName: string; contents: string }[];
		arguments: string[];
		printErr: (line: string) => void;
		onExit: (code: number) => void;
		wasmMemory: WebAssembly.Memory;
		instantiateWasm: (
			imports: WebAssembly.Imports,
			done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
		) => Record<string, unknown>;
	}

	export default function xmllint(run: XmllintRun): Promise<unknown>;
}
