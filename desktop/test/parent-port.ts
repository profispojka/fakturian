// Podproces Node se tváří jako `utilityProcess` Electronu: `process.parentPort` předává zprávy přes IPC.
process.type = 'utility';

process.parentPort = {
	on: (_event: string, listener: (message: { data: unknown }) => void) =>
		process.on('message', (data) => listener({ data })),
	postMessage: (message: unknown) => process.send(message),
};
