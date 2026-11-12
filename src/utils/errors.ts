import { czechList } from '~/utils/locales';
import { z, type Zod } from '~/utils/zod';

/**
 * Jediný převod odchycené chyby na větu pro uživatele: příkaz backendu hlásí holý řetězec, `String(Error)` by
 * lepil jméno třídy a `ZodError.message` je víceřádkový JSON.
 */
export function errorText(cause: unknown): string {
	if (cause instanceof z.ZodError) return issuesText(cause);
	if (cause instanceof Error) return cause.message;
	return String(cause);
}

const ISSUE_LIMIT = 3;

export function issuesText(error: Zod.ZodError): string {
	const issues = error.issues.slice(0, ISSUE_LIMIT).map((issue) => {
		if (issue.path.length) return `${issue.path.join('.')}: ${issue.message}`;
		return issue.message;
	});
	return czechList.format(issues);
}
