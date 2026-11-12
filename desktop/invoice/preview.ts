import { invoiceFiles } from './mod.ts';
import { invoiceArgument } from './model.ts';
import { invoiceTypst } from './template.ts';

import { renderTypstSvg } from '../pdf.ts';
import { overVault } from '../vault.ts';

// Stránky dokladu jako SVG, bez PDF a bez zápisu na disk.
export async function previewInvoice({
	vaultPath,
	invoice: argument,
}: {
	vaultPath: string;
	invoice: unknown;
}): Promise<string[]> {
	const invoice = invoiceArgument(argument);
	// Náhled čte z vaultu logo — a nad odpojenou složkou nemá vypadat, jako by se povedl.
	await overVault(vaultPath);
	const files = await invoiceFiles(vaultPath, invoice);
	return renderTypstSvg(invoiceTypst(), files);
}
