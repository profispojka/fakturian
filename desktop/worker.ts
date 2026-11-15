import { readPdf, rewritePdf, type PdfAnswer, type PdfRequest } from './pdf-document.ts';

// Chyba pdf-lib je odpověď o dokumentu; odmítnutí z poolu znamená, že worker práci nedokončil.
export default async function runPdfTask(request: PdfRequest): Promise<PdfAnswer> {
	try {
		if ('read' in request) {
			const content = await readPdf(request.read, request.budget);
			return { result: content };
		}
		const saved = await rewritePdf(request.rewrite, request.budget, request);
		return { result: saved };
	} catch (error) {
		return { error };
	}
}
