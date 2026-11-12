import { commands } from '~/bindings';
import { issuesText } from '~/utils/errors';
import { z } from '~/utils/zod';

export const snapshotServices = {
	// `null` znamená, že se ještě žádná záloha neuložila — složka neexistuje a nemá co ukazovat.
	async path(vaultPath: string): Promise<string | null> {
		const raw = await commands.snapshotsPath(vaultPath);
		const path = z.string().min(1).nullable().safeParse(raw);
		if (!path.success) throw new Error(`Cestu k zálohám nejde přečíst (${issuesText(path.error)}).`);
		return path.data;
	},
};
