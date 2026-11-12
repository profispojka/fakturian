import { commands } from '~/bindings';
import { adoptScanSchema, importReportSchema, type AdoptScan, type ImportReport } from '~/schemas/import';
import { issuesText } from '~/utils/errors';

export const importServices = {
	async importFiles(vaultPath: string, paths: string[], ico: string | null): Promise<ImportReport> {
		const raw = await commands.importDocuments(vaultPath, paths, ico);
		const report = importReportSchema.safeParse(raw);
		if (!report.success) throw new Error(`Zpráva o importu má poškozený obsah (${issuesText(report.error)}).`);
		return report.data;
	},
	async adoptFiles(vaultPath: string, paths: string[], ico: string | null): Promise<ImportReport> {
		const raw = await commands.adoptDocuments(vaultPath, paths, ico);
		const report = importReportSchema.safeParse(raw);
		if (!report.success) throw new Error(`Zpráva o převzetí má poškozený obsah (${issuesText(report.error)}).`);
		return report.data;
	},
	async scan(vaultPath: string, ico: string | null): Promise<AdoptScan> {
		const raw = await commands.scanVault(vaultPath, ico);
		const scan = adoptScanSchema.safeParse(raw);
		if (!scan.success) throw new Error(`Nález ve složce má poškozený obsah (${issuesText(scan.error)}).`);
		return scan.data;
	},
};
