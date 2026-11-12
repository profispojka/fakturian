import { execFile } from 'node:child_process';

import { NodeCompiler, type NodeTypstDocument } from '@myriaddreamin/typst-ts-node-compiler';
import { expect } from 'vitest';

import { MINIMAL_ISDOC } from './invoices.ts';

import { buildSpayd, qrPng } from '../invoice/payment.ts';
import { invoiceData } from '../invoice/template.ts';
import { ISDOC_ATTACHMENT, type TypstFiles } from '../pdf.ts';

import type { Invoice } from '../invoice/model.ts';

const RENDERER = NodeCompiler.create();
const TEXT_LAYER = /<h5:div class="tsel"[^>]*>([^<]*)<\/h5:div>/g;
const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: '\u00A0',
};

function unescape(text: string): string {
	return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (entity, name: string) => {
		if (name.startsWith('#x') || name.startsWith('#X'))
			return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
		if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)));
		return ENTITIES[name] ?? entity;
	});
}

// Vrstva pro výběr textu v SVG od typst.ts nese každý vysázený úsek i s nezlomitelnou mezerou, kterou
// čtečky PDF převádějí na obyčejnou.
export function printedText(document: NodeTypstDocument): string[] {
	return Array.from(RENDERER.svg(document).matchAll(TEXT_LAYER), ([, text = '']) => unescape(text));
}

export function imageCount(pdf: Uint8Array): number {
	return new TextDecoder('latin1').decode(pdf).match(/\/Subtype\s*\/Image\b/g)?.length ?? 0;
}

export function invoiceFiles(invoice: Invoice, logo?: Uint8Array): TypstFiles {
	const spayd = buildSpayd(invoice);
	const data = invoiceData(invoice, spayd !== undefined, logo !== undefined);
	return {
		'invoice.json': new TextEncoder().encode(JSON.stringify(data)),
		[ISDOC_ATTACHMENT]: new TextEncoder().encode(MINIMAL_ISDOC),
		...(spayd !== undefined && { 'qr.png': qrPng(spayd) }),
		...(logo && { 'logo.png': logo }),
	};
}

// Jedno spuštění na všechny soubory: JVM startuje déle než samotná validace. Chybějící veraPDF je pád
// testu, ne zelená.
export async function expectPdfA3a(paths: string[]): Promise<void> {
	const stdout = await new Promise<string>((resolve, reject) => {
		execFile('verapdf', ['--format', 'text', '--flavour', '3a', ...paths], (error, output) => {
			// Neprošlý soubor vrátí nenulový kód, výpis ale dorazí; bez výpisu se veraPDF nespustil.
			if (error && !output) {
				reject(
					new Error('veraPDF se nepodařilo spustit — nainstaluj `brew install verapdf`.', { cause: error }),
				);
			} else resolve(output);
		});
	});
	const report = stdout.trim().split('\n');
	expect(report).toEqual(paths.map((path) => `PASS ${path} 3a`));
}
