import { execFile, type ExecFileException } from 'node:child_process';
import { basename, join } from 'node:path';

import { DocumentKind } from '~/constants/invoice';
import { errorText } from '~/utils/errors';
import { validateNumber } from '~/utils/numbering';

import { invoiceWrites } from './mod.ts';

import { log } from '../log.ts';
import { overVault } from '../vault.ts';

import { documentNumberCount, findDocument, removeIndexEntry, scanInvoices } from './index.ts';

// `/usr/bin/trash` (macOS 15+) přesouvá přes NSFileManager: bez žádosti o ovládání Finderu a bez zvuku.
// Důvod selhání patří do logu, uživateli stačí věta bez výpisu nástroje.
export async function moveToTrash(path: string): Promise<void> {
	const failed = `Doklad ${path} se nepodařilo přesunout do Koše.`;
	const { error, stderr } = await new Promise<{ error: ExecFileException | null; stderr: string }>((resolve) => {
		execFile('/usr/bin/trash', [path], (failure, _stdout, output) => {
			resolve({
				error: failure,
				stderr: output,
			});
		});
	});
	if (!error) return;
	// Nespustitelný nástroj nic nevypíše, důvod nese až chyba.
	await log(`${failed} ${stderr.trim() || errorText(error)}`);
	throw new Error(failed, { cause: error });
}

// Úklid souboru jde vyměnit, aby testy neplnily skutečný Koš.
export function deleteInvoice(
	{ vaultPath, number }: { vaultPath: string; number: string },
	discard: (path: string) => Promise<void> = moveToTrash,
): Promise<null> {
	return invoiceWrites(async () => {
		const numberProblem = validateNumber(number);
		if (numberProblem) throw new Error(numberProblem);
		const root = await overVault(vaultPath);
		const invoices = join(root, 'faktury');
		const count = await documentNumberCount(invoices, number);
		if (count > 1) {
			throw new Error(
				`Číslo dokladu ${number} je ve složce faktury/ víckrát. Nejdřív rozhodni konflikt ve Finderu.`,
			);
		}
		const path = await findDocument(invoices, number);
		if (path === undefined) throw new Error(`Doklad ${number} se nepodařilo najít.`);
		// Dobropis bez faktury, kterou opravuje, by v evidenci vracel peníze z ničeho. Hledá se i mezi
		// vadnými doklady: konfliktní kopie od synchronizace je dobropis pořád.
		const { readable, unreadable } = await scanInvoices({ vaultPath });
		const found = readable
			.filter(
				({ documentType, originalInvoice }) =>
					documentType === DocumentKind.CreditNote && originalInvoice === number,
			)
			.map((summary) => summary.number);
		// Dobropis s konfliktní kopií leží ve složce dvakrát.
		const credits = [...new Set(found)];
		if (credits.length > 0) {
			throw new Error(
				`Faktura ${number} má dobropis ${credits.join(', ')}, smazat ji nejde. Nejdřív smaž dobropis.`,
			);
		}
		// Jiný soubor, který nejde přečíst, může být její dobropis; dobropis sám žádný nemá.
		const target = readable.find((summary) => summary.path === path);
		const others = unreadable.filter((name) => name !== basename(path));
		if (target?.documentType !== DocumentKind.CreditNote && others.length > 0) {
			throw new Error(
				`Fakturu ${number} smazat nejde, dokud appka nepřečte ${others.join(', ')}: může to být její dobropis. Oprav vadné doklady na Přehledu a zkus to znovu.`,
			);
		}
		await discard(path);
		await removeIndexEntry(root, path);
		return null;
	});
}
