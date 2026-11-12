import { DocumentKind } from '~/constants/invoice';
import { dateIn } from '~/utils/date';

import type { Invoice } from '~/schemas/invoices';

export const SAMPLE_INVOICE: Invoice = {
	number: 'UKÁZKA',
	uuid: '',
	documentType: DocumentKind.Invoice,
	originalInvoice: '',
	originalUuid: '',
	issueDate: dateIn(2026, 3, 2),
	dueDate: dateIn(2026, 3, 16),
	supplier: {
		name: 'Jan Dodavatel',
		ico: '12345678',
		dic: '',
		address: {
			street: 'Dlouhá 1',
			city: 'Praha 1',
			zip: '110 00',
		},
		email: 'jan@dodavatel.cz',
		registration: 'Fyzická osoba zapsaná v živnostenském rejstříku',
	},
	customer: {
		name: 'Ukázkový odběratel s.r.o.',
		ico: '27154893',
		dic: 'CZ27154893',
		address: {
			street: 'Sokolovská 651/136a',
			city: 'Praha 8',
			zip: '186 00',
		},
		email: '',
		registration: '',
	},
	vatNote: 'Nejsem plátce DPH.',
	bankAccount: '2000145399',
	bankCode: '0800',
	iban: 'CZ6508000000192000145399',
	variableSymbol: '20260142',
	note: 'Takhle bude vypadat poznámka pod položkami.',
	lines: [
		{
			id: 'ukazka-1',
			description: 'Vývoj klientského portálu — sprint 14',
			quantity: 72,
			unit: 'h',
			unitPriceCents: 110_000,
		},
		{
			id: 'ukazka-2',
			description: 'Konzultace k migraci databáze',
			quantity: 6.5,
			unit: 'h',
			unitPriceCents: 140_000,
		},
		{
			id: 'ukazka-3',
			description: 'Údržba a hotline (paušál)',
			quantity: 1,
			unit: 'měs',
			unitPriceCents: 850_000,
		},
	],
};
