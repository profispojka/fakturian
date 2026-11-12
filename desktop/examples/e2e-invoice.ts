import { DocumentKind, NON_VAT_PAYER_NOTE } from '~/constants/invoice';
import { addDays, parseDate, yearOf } from '~/utils/date';
import { errorText } from '~/utils/errors';

import { saveInvoice } from '../invoice/mod.ts';

import type { Invoice } from '../invoice/model.ts';

// Údaje musí sedět s `e2e/fixtures/vault/.fakturian/nastaveni.json`: specy hledají odběratele
// i dodavatele podle jména a appka číslo řady odvozuje z formátu v nastavení.

const USAGE = 'Použití: node desktop/examples/run.ts e2e-invoice <vault> <RRRR-MM-DD>';

const [vault, issueArgument] = process.argv.slice(2);
if (vault === undefined || issueArgument === undefined) {
	console.error(USAGE);
	process.exit(2);
}
const issue = parseDate(issueArgument);
if (issue === undefined) {
	console.error(`Datum ${issueArgument} není RRRR-MM-DD.\n${USAGE}`);
	process.exit(2);
}
const number = `${yearOf(issue)}0001`;

const invoice: Invoice = {
	number,
	uuid: '',
	documentType: DocumentKind.Invoice,
	originalInvoice: '',
	originalIssueDate: '',
	originalUuid: '',
	issueDate: issue,
	dueDate: addDays(issue, 14),
	supplier: {
		name: 'E2E dodavatel',
		ico: '12345679',
		dic: '',
		address: {
			street: 'Testovací 1',
			city: 'Praha',
			zip: '11000',
		},
		email: '',
		registration: 'Fyzická osoba zapsaná v živnostenském rejstříku, Živnostenský úřad Praha 1',
	},
	customer: {
		name: 'E2E odběratel',
		ico: '25596641',
		dic: '',
		address: {
			street: 'Kontrolní 2',
			city: 'Brno',
			zip: '60200',
		},
		email: 'odberatel@example.invalid',
		registration: '',
	},
	vatNote: NON_VAT_PAYER_NOTE,
	bankAccount: '2000145399',
	bankCode: '0800',
	iban: '',
	variableSymbol: number,
	note: '',
	lines: [
		{
			description: 'E2E konzultace',
			quantity: 2,
			unit: 'ks',
			unitPriceCents: 125_050,
			itemId: '',
		},
	],
};
try {
	await saveInvoice({
		vaultPath: vault,
		invoice,
		isNew: true,
	});
} catch (error) {
	throw new Error(`Doklad ${number}: ${errorText(error)}`, { cause: error });
}
console.log(`  faktura ${number}  E2E odběratel  2 501 Kč`);
