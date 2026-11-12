import { commands } from '~/bindings';
import {
	brokenReceivedListSchema,
	receivedDocumentSchema,
	type BrokenReceived,
	type ReceivedDocument,
} from '~/schemas/expenses';
import { issuesText } from '~/utils/errors';
import { z } from '~/utils/zod';

// `file` u neúspěchu je jméno kopie, která už v `prijate/` leží; bez něj by tam soubor zůstal
// navždycky bez záznamu ve `vydaje.json`.
export type ImportReceivedResult =
	| { success: true; doc: ReceivedDocument }
	| { success: false; error: string; file: string };

export const expenseServices = {
	// Nečitelná odpověď se vrací jako neúspěch místo výjimky: nese i jméno kopie v trezoru, které se
	// proto ověřuje zvlášť — na úklid stačí ono samo.
	async importReceived(vaultPath: string, sourcePath: string): Promise<ImportReceivedResult> {
		const raw = await commands.importReceived(vaultPath, sourcePath);
		const result = receivedDocumentSchema.safeParse(raw);
		if (result.success)
			return {
				success: true,
				doc: result.data,
			};

		const named = z.object({ file: z.string() }).safeParse(raw);
		return {
			success: false,
			error: `Přijatý doklad se nepodařilo přečíst: ${issuesText(result.error)}`,
			file: named.success ? named.data.file : '',
		};
	},
	async listBrokenReceived(vaultPath: string): Promise<BrokenReceived[]> {
		const raw = await commands.listBrokenReceived(vaultPath);
		const result = brokenReceivedListSchema.safeParse(raw);
		if (!result.success)
			throw new Error(`Kontrola složky prijate/ vrátila nečitelnou odpověď (${issuesText(result.error)}).`);
		return result.data;
	},
	async removeReceived(vaultPath: string, file: string): Promise<void> {
		await commands.removeReceived(vaultPath, file);
	},
	documentPath(vaultPath: string, file: string): Promise<string> {
		return commands.receivedPath(vaultPath, file);
	},
};
