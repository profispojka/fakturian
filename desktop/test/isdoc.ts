import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SCHEMA = fileURLToPath(new URL('../isdoc/isdoc-invoice-6.0.2.xsd', import.meta.url));

export function fixture(name: string): Promise<string> {
	return readFile(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
}

interface Output {
	success: boolean;
	stdout: string;
	stderr: string;
}

// Nezávislá kontrola systémovým xmllintem, ne tou knihovnou, kterou doklad čte appka. Chybějící xmllint
// je pád testu, ne zelená.
function xmllint(args: string[], xml: string): Promise<Output> {
	return new Promise((resolve, reject) => {
		const child = spawn('xmllint', [...args, '-']);
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
			stderr += chunk;
		});
		child.on('error', (error) => {
			reject(new Error('xmllint se nepodařilo spustit — na macOS je v /usr/bin.', { cause: error }));
		});
		child.on('close', (code) => {
			resolve({
				success: code === 0,
				stdout,
				stderr,
			});
		});
		child.stdin.end(xml);
	});
}

// Výstup xmllintu tak, jak ho vypíše: `- validates`, nebo chyby schématu.
export async function schemaReport(xml: string): Promise<string> {
	const output = await xmllint(['--noout', '--schema', SCHEMA], xml);
	return output.stderr;
}

// Kanonický tvar podle C14N: pořadí atributů, entity a CDATA sjednotí, ale prvky, texty, komentáře
// i instrukce zachová.
export async function canonical(xml: string): Promise<string> {
	const output = await xmllint(['--c14n'], xml);
	if (!output.success) throw new Error(`xmllint --c14n selhal: ${output.stderr}`);
	return output.stdout;
}
