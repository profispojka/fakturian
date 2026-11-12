import { contactSchema, type Contact } from '~/schemas/customers';
import { emptySupplier, type Supplier } from '~/schemas/suppliers';
import { normalizeSearchText } from '~/utils/crud';
import { issuesText } from '~/utils/errors';
import { ibanMatchesAccount } from '~/utils/validators';

import type { AdoptedSupplier, ImportedCustomer } from '~/schemas/import';

// IČO a DIČ bez mezer, jinak na nich neuspěje deduplikace odběratelů.
export function contactFromImported(c: ImportedCustomer): Contact {
	return {
		id: crypto.randomUUID(),
		name: c.name.trim(),
		ico: c.ico.replace(/\s/g, ''),
		dic: c.dic.replace(/\s/g, '') || undefined,
		address: {
			street: c.address.street.trim(),
			city: c.address.city.trim(),
			zip: c.address.zip.trim(),
		},
		email: c.email.trim() || undefined,
	};
}

export function supplierFromAdopted(d: AdoptedSupplier): Supplier {
	const defaultValue = emptySupplier();
	return {
		...defaultValue,
		name: d.name,
		ico: d.ico,
		address: d.address,
		registration: d.registration,
		bankAccount: d.bankAccount,
		bankCode: d.bankCode,
		// IBAN z převzatých dokladů jen tehdy, když patří k jejich účtu; jinak si ho QR platba dopočítá.
		iban: ibanMatchesAccount(d.iban, d.bankAccount, d.bankCode) ? d.iban : undefined,
		email: d.email || undefined,
		defaultDueDays: d.defaultDueDays ?? defaultValue.defaultDueDays,
		// Bez toho by řada uprostřed roku změnila tvar: po `2026022` z iDokladu by výchozí šablona
		// vystavila `20260023`, což účetní čte jako jinou řadu.
		invoiceNumberFormat: d.invoiceNumberFormat || defaultValue.invoiceNumberFormat,
	};
}

export interface RefusedCustomer {
	name: string;
	reason: string;
}

export interface ContactsFromImport {
	contacts: Contact[];
	refused: RefusedCustomer[];
}

// Odběratel z cizího dokladu se založí, jen když projde formulářem; neúplný by v evidenci visel
// jako kontakt, na který nejde fakturovat.
export function newContactsFromImport(existing: Contact[], imported: ImportedCustomer[]): ContactsFromImport {
	const contacts: Contact[] = [];
	const refused: RefusedCustomer[] = [];
	for (const candidate of imported.map(contactFromImported)) {
		const known = existing.some((contact) => {
			if (candidate.ico) return contact.ico === candidate.ico;
			return normalizeSearchText(contact.name) === normalizeSearchText(candidate.name);
		});
		if (known) continue;
		const checked = contactSchema.safeParse(candidate);
		if (checked.success) contacts.push(candidate);
		else
			refused.push({
				name: candidate.name || 'odběratel bez jména',
				reason: issuesText(checked.error),
			});
	}
	return {
		contacts,
		refused,
	};
}
