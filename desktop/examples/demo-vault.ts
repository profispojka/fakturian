import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DocumentKind, type DocumentType } from '~/constants/invoice';
import { addDays, dateIn, daysBetween, monthOf, parseDate, yearOf, type DateString } from '~/utils/date';
import { errorText } from '~/utils/errors';
import { invoiceTotalCents } from '~/utils/invoice';

import { listInvoices } from '../invoice/index.ts';
import { invoiceUuid } from '../invoice/isdoc.ts';
import { saveInvoice } from '../invoice/mod.ts';
import { asciiLower } from '../numbering.ts';
import { errorCode } from '../util.ts';

import type { Invoice, InvoiceLine, InvoiceParty } from '../invoice/model.ts';

const USAGE = 'Použití: node desktop/examples/run.ts demo-vault <cesta k ukázkové složce> [RRRR-MM-DD]';

// LCG z Knuthova MMIX modulo 2^64 v `BigInt`, v `number` by se nižší bity ztratily. Stejné semínko dá
// stejný vault, a tím i stejné snímky vizuální sady.
class Rng {
	#state: bigint;

	constructor(seed: number) {
		this.#state = BigInt(seed);
	}

	next(): number {
		this.#state = BigInt.asUintN(64, this.#state * 6_364_136_223_846_793_005n + 1_442_695_040_888_963_407n);
		return Number(this.#state >> 33n);
	}

	range(lo: number, hi: number): number {
		return lo + (this.next() % (hi - lo + 1));
	}

	chance(percent: number): boolean {
		return this.range(1, 100) <= percent;
	}
}

interface Client {
	id: string;
	name: string;
	ico: string;
	dic: string;
	street: string;
	city: string;
	zip: string;
	email: string;
}

const REGISTRATION = 'Zapsáno v obchodním rejstříku vedeném Městským soudem v Praze, oddíl C, vložka 123456';
const BANK = '2901234567';
const BANK_CODE = '2010';
const IBAN = 'CZ5520100000002901234567';

const SUPPLIER: InvoiceParty = {
	name: 'Ukázková dílna s.r.o.',
	ico: '27458318',
	// Neplátce DPH DIČ na dokladu neuvádí.
	dic: '',
	address: {
		street: 'Vzorová 12',
		city: 'Praha',
		zip: '16000',
	},
	email: 'fakturace@ukazkova-dilna.example',
	registration: REGISTRATION,
};

const KOVO: Client = {
	id: 'c-kovo',
	name: 'Kovo Trade a.s.',
	ico: '45678901',
	dic: 'CZ45678901',
	street: 'Průmyslová 88',
	city: 'Ostrava',
	zip: '70200',
	email: 'ucto@kovotrade.cz',
};
const HLEDACEK: Client = {
	id: 'c-hledacek',
	name: 'Portál Hledáček a.s.',
	ico: '27000001',
	dic: 'CZ27000001',
	street: 'Smyšlená 3294/10',
	city: 'Praha 5',
	zip: '15000',
	email: 'fakturace@hledacek.example',
};
const MRAZ: Client = {
	id: 'c-mraz',
	name: 'Studio Mráz s.r.o.',
	ico: '28456785',
	dic: 'CZ28456785',
	street: 'Na příkopě 22',
	city: 'Praha 1',
	zip: '11000',
	email: 'fakturace@studiomraz.cz',
};
const SEVERNI: Client = {
	id: 'c-nordic',
	name: 'Severní web s.r.o.',
	ico: '06543219',
	dic: 'CZ06543219',
	street: 'Veveří 44',
	city: 'Brno',
	zip: '60200',
	email: 'faktury@severniweb.cz',
};
const KOTVA: Client = {
	id: 'c-kotva',
	name: 'Bistro Kotva s.r.o.',
	ico: '07713347',
	dic: '',
	street: 'Sokolská 14',
	city: 'Brno',
	zip: '60200',
	email: 'kotva@bistrokotva.cz',
};
const VLK: Client = {
	id: 'c-vlk',
	name: 'Doprava Vlk s.r.o.',
	ico: '63219841',
	dic: 'CZ63219841',
	street: 'Nádražní 401',
	city: 'Olomouc',
	zip: '77900',
	email: 'faktury@dopravavlk.cz',
};
const NOVAKOVA: Client = {
	id: 'c-novakova',
	name: 'Nováková Design',
	ico: '87654326',
	dic: '',
	street: 'Husova 12',
	city: 'Brno',
	zip: '60200',
	email: 'eva@novakovadesign.cz',
};
const POLEDNIK: Client = {
	id: 'c-meridian',
	name: 'Poledník Digital s.r.o.',
	ico: '09123458',
	dic: 'CZ09123458',
	street: 'Přístavní 12',
	city: 'Ústí nad Labem',
	zip: '40001',
	email: 'ucetni@polednikdigital.cz',
};
const FITNESS: Client = {
	id: 'c-fitness',
	name: 'Praha Fitness Group s.r.o.',
	ico: '24215678',
	dic: 'CZ24215678',
	street: 'Vinohradská 1200/40',
	city: 'Praha 2',
	zip: '12000',
	email: 'ucetni@prahafitness.cz',
};
const BENES: Client = {
	id: 'c-benes',
	name: 'Lukáš Beneš',
	ico: '99887762',
	dic: '',
	street: 'Bezručova 7',
	city: 'Plzeň',
	zip: '30100',
	email: 'lukas@benes.cz',
};

const CLIENTS = [KOVO, HLEDACEK, MRAZ, SEVERNI, KOTVA, VLK, NOVAKOVA, POLEDNIK, FITNESS, BENES];
const OCCASIONAL_CLIENTS = [NOVAKOVA, FITNESS, BENES];

const PRICELIST = [
	{
		id: 'p-frontend',
		name: 'Front-end vývoj',
		note: '',
		priceCents: 140_000,
		unit: 'hod',
		icon: 'i-lucide-code',
	},
	{
		id: 'p-programator',
		name: 'Programátorské práce',
		note: '',
		priceCents: 140_000,
		unit: 'hod',
		icon: 'i-lucide-laptop',
	},
	{
		id: 'p-konzultace',
		name: 'Konzultace k architektuře',
		note: '',
		priceCents: 180_000,
		unit: 'hod',
		icon: 'i-lucide-users',
	},
	{
		id: 'p-mobil',
		name: 'Vývoj mobilní aplikace',
		note: '',
		priceCents: 150_000,
		unit: 'hod',
		icon: 'i-lucide-code',
	},
	{
		id: 'p-devops',
		name: 'Nasazení a DevOps',
		note: '',
		priceCents: 160_000,
		unit: 'hod',
		icon: 'i-lucide-server',
	},
	{
		id: 'p-udrzba',
		name: 'Měsíční údržba webu',
		note: '',
		priceCents: 550_000,
		unit: 'měsíc',
		icon: 'i-lucide-calendar',
		annualLimit: 12,
	},
	{
		id: 'p-web',
		name: 'Webová prezentace — návrh a kódování',
		note: '',
		priceCents: 7_800_000,
		unit: 'projekt',
		icon: 'i-lucide-paintbrush',
	},
	{
		id: 'p-logo',
		name: 'Grafický návrh loga',
		note: '',
		priceCents: 1_600_000,
		unit: 'ks',
		icon: 'i-lucide-paintbrush',
	},
	{
		id: 'p-skoleni',
		name: 'Školení týmu',
		note: '',
		priceCents: 1_200_000,
		unit: 'den',
		icon: 'i-lucide-graduation-cap',
	},
	{
		id: 'p-audit',
		name: 'Technický audit',
		note: '',
		priceCents: 4_800_000,
		unit: 'projekt',
		icon: 'i-lucide-file-text',
	},
	{
		id: 'p-dovolena',
		name: 'Konzultační činnost',
		note: 'Dovolená',
		priceCents: 140_000,
		unit: 'hod',
		icon: 'i-lucide-tree-palm',
		annualLimit: 160,
	},
];

const VACATION = 'Konzultační činnost';

const EXPENSES = [
	{
		id: 'e-0001',
		supplier: 'Wedos Internet, a.s.',
		supplierIco: '28115708',
		description: 'Hosting a doména',
		czk: 590,
		date: '2026-01-08',
	},
	{
		id: 'e-0002',
		supplier: 'Adobe Systems',
		description: 'Creative Cloud',
		czk: 1_690,
		date: '2026-01-12',
	},
	{
		id: 'e-0003',
		supplier: 'T-Mobile Czech Republic a.s.',
		supplierIco: '64949681',
		description: 'Mobilní tarif',
		czk: 749,
		date: '2026-01-15',
	},
	{
		id: 'e-0004',
		supplier: 'Coworking Vinohrady s.r.o.',
		supplierIco: '24762342',
		description: 'Pronájem místa',
		czk: 4_500,
		date: '2026-01-05',
	},
	{
		id: 'e-0005',
		supplier: 'Ing. Marie Kučerová',
		supplierIco: '74125896',
		description: 'Vedení účetnictví',
		czk: 2_800,
		date: '2026-01-20',
	},
	{
		id: 'e-0006',
		supplier: 'JetBrains s.r.o.',
		supplierIco: '26502275',
		description: 'All Products Pack',
		czk: 6_890,
		date: '2026-02-03',
	},
	{
		id: 'e-0007',
		supplier: 'GitHub, Inc.',
		description: 'Team plan',
		czk: 1_150,
		date: '2026-01-09',
	},
	{
		id: 'e-0101',
		supplier: 'Alza.cz a.s.',
		supplierIco: '27082440',
		description: 'MacBook Pro 14"',
		czk: 62_990,
		date: '2025-09-18',
	},
	{
		id: 'e-0102',
		supplier: 'Alza.cz a.s.',
		supplierIco: '27082440',
		description: 'Monitor Dell U2723QE',
		czk: 14_490,
		date: '2025-09-18',
	},
	{
		id: 'e-0103',
		supplier: 'Petr Horák — grafika',
		supplierIco: '88991122',
		description: 'Grafický návrh e-shopu',
		czk: 38_000,
		date: '2026-02-24',
	},
	{
		id: 'e-0104',
		supplier: 'Petr Horák — grafika',
		supplierIco: '88991122',
		description: 'Ikonografie a ilustrace',
		czk: 12_500,
		date: '2026-04-14',
	},
	{
		id: 'e-0105',
		supplier: 'Tomáš Řehák — vývoj',
		supplierIco: '77553311',
		description: 'Subdodávka backend API',
		czk: 96_000,
		date: '2026-03-31',
	},
	{
		id: 'e-0106',
		supplier: 'Tomáš Řehák — vývoj',
		supplierIco: '77553311',
		description: 'Subdodávka — integrace ERP',
		czk: 84_000,
		date: '2026-06-30',
	},
	{
		id: 'e-0107',
		supplier: 'Testovací zařízení s.r.o.',
		supplierIco: '29012345',
		description: 'Zapůjčení testovacích telefonů',
		czk: 9_800,
		date: '2026-05-12',
	},
	{
		id: 'e-0108',
		supplier: 'Czechitas z.s.',
		supplierIco: '22833571',
		description: 'Školení — přístupnost',
		czk: 8_900,
		date: '2026-03-06',
	},
	{
		id: 'e-0109',
		supplier: 'WebExpo s.r.o.',
		supplierIco: '27654321',
		description: 'Konference WebExpo 2026',
		czk: 6_500,
		date: '2026-05-28',
	},
	{
		id: 'e-0110',
		supplier: 'Amazon Web Services',
		description: 'Provoz testovacího prostředí',
		czk: 3_240,
		date: '2026-06-04',
	},
	{
		id: 'e-0111',
		supplier: 'Fotky&Foto s.r.o.',
		supplierIco: '27918967',
		description: 'Licence fotobanky',
		czk: 4_290,
		date: '2026-02-11',
	},
	{
		id: 'e-0112',
		supplier: 'IKEA Česká republika, s.r.o.',
		supplierIco: '27081052',
		description: 'Židle a stůl do kanceláře',
		czk: 18_700,
		date: '2025-11-07',
	},
	{
		id: 'e-0113',
		supplier: 'Apple Distribution International',
		description: 'iPhone 16 — testovací zařízení',
		czk: 24_990,
		date: '2026-01-27',
	},
	{
		id: 'e-0114',
		supplier: 'Nakladatelství Grada',
		supplierIco: '48240206',
		description: 'Odborná literatura',
		czk: 2_180,
		date: '2025-10-15',
	},
	{
		id: 'e-0115',
		supplier: 'Petr Horák — grafika',
		supplierIco: '88991122',
		description: 'Logo a vizuální styl',
		czk: 9_500,
		date: '2025-10-22',
	},
	{
		id: 'e-0116',
		supplier: 'Servis Novák',
		supplierIco: '61234567',
		description: 'Oprava notebooku',
		czk: 3_450,
		date: '2026-07-09',
	},
	{
		id: 'e-0117',
		supplier: 'ČSOB Leasing',
		supplierIco: '63998980',
		description: 'Pojištění techniky',
		czk: 5_400,
		date: '2026-04-02',
	},
];

interface Planned {
	client: Client;
	lines: InvoiceLine[];
	day: number;
	dueDays: number;
}

interface Header {
	number: string;
	client: Client;
	issue: DateString;
	due: DateString;
	periodStart: DateString;
	kind: DocumentType;
	original: string;
	originalIssueDate: string;
	originalUuid: string;
	note: string;
}

interface Issued {
	number: string;
	client: Client;
	issue: DateString;
	due: DateString;
	periodStart: DateString;
	totalCents: number;
	uuid: string;
	kind: DocumentType;
	lines: InvoiceLine[];
}

function line(description: string, quantity: number, unit: string, unitPriceCents: number): InvoiceLine {
	return {
		description,
		quantity,
		unit,
		unitPriceCents,
		itemId: '',
	};
}

function invoiceHeader(
	number: string,
	client: Client,
	issue: DateString,
	due: DateString,
	periodStart: DateString,
): Header {
	return {
		number,
		client,
		issue,
		due,
		periodStart,
		kind: DocumentKind.Invoice,
		original: '',
		originalIssueDate: '',
		originalUuid: '',
		note: '',
	};
}

const [vaultArgument, todayArgument] = process.argv.slice(2);
if (vaultArgument === undefined) {
	console.error(USAGE);
	process.exit(2);
}
const vault = vaultArgument;
const parsedToday = todayArgument === undefined ? dateIn(2026, 8, 21) : parseDate(todayArgument);
if (parsedToday === undefined) {
	console.error(`Datum ${todayArgument} není RRRR-MM-DD.\n${USAGE}`);
	process.exit(2);
}
const today = parsedToday;

let existing: string[] = [];
try {
	existing = await readdir(vault);
} catch (error) {
	if (errorCode(error) !== 'ENOENT') throw error;
}
if (existing.length > 0) {
	console.error(`Složka ${vault} není prázdná — ukázková data by přepsala cizí vault.`);
	process.exit(1);
}
await mkdir(join(vault, 'faktury'), { recursive: true });
await mkdir(join(vault, 'prijate'), { recursive: true });

const issued: Issued[] = [];
const sequence = new Map<number, number>();
let creditNotes = 0;

function nextNumber(year: number): string {
	const number = (sequence.get(year) ?? 0) + 1;
	sequence.set(year, number);
	return `${year}${String(number).padStart(4, '0')}`;
}

async function saveDocument(header: Header, planned: InvoiceLine[]): Promise<Issued> {
	const periodYear = yearOf(header.periodStart);
	// Vazbu na ceník i rok čerpání nese doklad — appka z nich počítá vykázané množství. Práce
	// z prosince fakturovaná v lednu čerpá limit loňska.
	const lines = planned.map((plannedLine) => {
		const item = PRICELIST.find(
			({ name, unit }) =>
				asciiLower(plannedLine.description.trim()) === asciiLower(name) &&
				asciiLower(plannedLine.unit.trim()) === asciiLower(unit),
		);
		if (item === undefined) return plannedLine;
		return {
			...plannedLine,
			itemId: item.id,
			...(periodYear !== yearOf(header.issue) && { usageYear: periodYear }),
		};
	});
	const { client } = header;
	const invoice: Invoice = {
		number: header.number,
		uuid: '',
		documentType: header.kind,
		originalInvoice: header.original,
		originalIssueDate: header.originalIssueDate,
		originalUuid: header.originalUuid,
		issueDate: header.issue,
		dueDate: header.due,
		supplier: SUPPLIER,
		customer: {
			name: client.name,
			ico: client.ico,
			dic: client.dic,
			address: {
				street: client.street,
				city: client.city,
				zip: client.zip,
			},
			email: client.email,
			registration: '',
		},
		vatNote: '',
		bankAccount: BANK,
		bankCode: BANK_CODE,
		iban: IBAN,
		variableSymbol: header.number,
		note: header.note,
		lines,
	};
	const uuid = invoiceUuid(invoice);
	try {
		await saveInvoice({
			vaultPath: vault,
			invoice,
			isNew: true,
		});
	} catch (error) {
		throw new Error(`Doklad ${header.number}: ${errorText(error)}`, { cause: error });
	}
	const totalCents = invoiceTotalCents(invoice);
	const label = header.kind === DocumentKind.CreditNote ? 'dobropis' : 'faktura';
	const wholeCzk = String(Math.trunc(totalCents / 100)).padStart(10);
	console.log(`  ${label} ${header.number}  ${client.name.padEnd(28)} ${wholeCzk} Kč`);
	return {
		number: header.number,
		client,
		issue: header.issue,
		due: header.due,
		periodStart: header.periodStart,
		totalCents,
		uuid,
		kind: header.kind,
		lines,
	};
}

// Pořadí volání `rng` určuje, jaký vault vznikne; přeskládání změní všechna data.
function retainerInvoices(rng: Rng, periodStart: DateString): Planned[] {
	const month = monthOf(periodStart);
	const batch: Planned[] = [];
	const maintenanceHours = rng.range(8, 19);
	const maintenance = [
		line('Měsíční údržba webu', 1, 'měsíc', 550_000),
		line('Programátorské práce', maintenanceHours, 'hod', 140_000),
	];
	if ([2, 5, 7, 12].includes(month)) maintenance.push(line(VACATION, rng.range(2, 5) * 8, 'hod', 140_000));
	batch.push({
		client: KOVO,
		lines: maintenance,
		day: rng.range(2, 6),
		dueDays: 14,
	});

	if (periodStart >= dateIn(2025, 1, 1) && rng.chance(85)) {
		const hours = rng.range(4, 13);
		batch.push({
			client: HLEDACEK,
			lines: [line('Konzultace k architektuře', hours, 'hod', 180_000)],
			day: rng.range(3, 8),
			dueDays: 21,
		});
	}

	if (month % 2 === 1) {
		const hours = rng.range(12, 29);
		batch.push({
			client: MRAZ,
			lines: [line('Front-end vývoj', hours, 'hod', 140_000)],
			day: rng.range(4, 9),
			dueDays: 14,
		});
	}

	if (month % 3 === 0) {
		const hours = rng.range(35, 90);
		batch.push({
			client: SEVERNI,
			lines: [line('Vývojové práce', hours, 'hod', 135_000)],
			day: rng.range(5, 10),
			dueDays: 30,
		});
	}

	if (periodStart >= dateIn(2026, 1, 1) && periodStart <= dateIn(2026, 6, 1)) {
		const hours = rng.range(12, 25);
		batch.push({
			client: KOTVA,
			lines: [line('Front-end vývoj', hours, 'hod', 140_000)],
			day: rng.range(5, 11),
			dueDays: 21,
		});
	}

	if (periodStart >= dateIn(2025, 10, 1) && month % 2 === 0) {
		const hours = rng.range(18, 38);
		batch.push({
			client: VLK,
			lines: [line('Vývoj mobilní aplikace', hours, 'hod', 150_000)],
			day: rng.range(6, 12),
			dueDays: 21,
		});
	}
	return batch;
}

function occasionalLines(rng: Rng): InvoiceLine[] {
	switch (rng.range(1, 5)) {
		case 1:
			return [line('Grafický návrh loga', 1, 'ks', 1_600_000)];
		case 2:
			return [line('Školení týmu', rng.range(1, 3), 'den', 1_200_000)];
		case 3:
			return [line('Webová prezentace — návrh a kódování', 1, 'projekt', 7_800_000)];
		case 4:
			return [
				line('Nasazení a DevOps', rng.range(4, 14), 'hod', 160_000),
				line('Konzultace k architektuře', rng.range(2, 8), 'hod', 180_000),
			];
		default:
			return [line('Front-end vývoj', rng.range(10, 34), 'hod', 140_000)];
	}
}

function occasionalInvoices(rng: Rng, periodStart: DateString): Planned[] {
	const batch: Planned[] = [];
	if (rng.chance(30)) {
		const client = OCCASIONAL_CLIENTS[rng.range(0, 2)];
		if (client === undefined) throw new Error('Příležitostný odběratel je mimo seznam.');
		const lines = occasionalLines(rng);
		batch.push({
			client,
			lines,
			day: rng.range(6, 14),
			dueDays: 14,
		});
	}

	if ([4, 10].includes(monthOf(periodStart))) {
		batch.push({
			client: POLEDNIK,
			lines: [line('Technický audit', 1, 'projekt', 4_800_000)],
			day: rng.range(8, 12),
			dueDays: 30,
		});
	}
	return batch;
}

async function issueCreditNote(issueMonth: DateString): Promise<void> {
	const original = issued.findLast(({ client, kind }) => client === MRAZ && kind === DocumentKind.Invoice);
	if (original === undefined) return;
	// Dobropis vrací vždy celou fakturu, jinak by ho appka neuložila.
	const lines = original.lines.map((originalLine) => ({
		...originalLine,
		unitPriceCents: -originalLine.unitPriceCents,
	}));
	const issue = dateIn(yearOf(issueMonth), monthOf(issueMonth), 18);
	const creditNote = await saveDocument(
		{
			number: nextNumber(yearOf(issue)),
			client: MRAZ,
			issue,
			due: addDays(issue, 14),
			periodStart: original.periodStart,
			kind: DocumentKind.CreditNote,
			original: original.number,
			originalIssueDate: original.issue,
			originalUuid: original.uuid,
			note: `Dobropis k faktuře ${original.number}.`,
		},
		lines,
	);
	creditNotes += 1;
	issued.push(creditNote);
}

const history = new Rng(0x5eed_fa47);
let periodStart = dateIn(2024, 9, 1);
while (periodStart <= dateIn(2026, 7, 1)) {
	// Prvního plus 31 dní padne vždy do následujícího měsíce.
	const nextMonth = addDays(periodStart, 31);
	const issueMonth = dateIn(yearOf(nextMonth), monthOf(nextMonth), 1);
	const batch = [...retainerInvoices(history, periodStart), ...occasionalInvoices(history, periodStart)];
	for (const { client, lines, day, dueDays } of batch) {
		const issue = dateIn(yearOf(issueMonth), monthOf(issueMonth), day);
		// Doklad z budoucnosti se nevystavuje.
		if (issue > today) continue;
		const number = nextNumber(yearOf(issue));
		const document = await saveDocument(
			invoiceHeader(number, client, issue, addDays(issue, dueDays), periodStart),
			lines,
		);
		issued.push(document);
	}
	if (issueMonth === dateIn(2025, 8, 1) || issueMonth === dateIn(2026, 4, 1)) await issueCreditNote(issueMonth);
	periodStart = issueMonth;
}

const thisPeriod = dateIn(yearOf(today), monthOf(today), 1);
const recent = [
	{
		daysAgo: 4,
		client: FITNESS,
		dueDays: 14,
		lines: [line('Front-end vývoj', 18, 'hod', 140_000)],
	},
	{
		daysAgo: 2,
		client: VLK,
		dueDays: 14,
		lines: [line('Nasazení a DevOps', 9, 'hod', 160_000), line('Konzultace k architektuře', 4, 'hod', 180_000)],
	},
	{
		daysAgo: 1,
		client: KOTVA,
		dueDays: 21,
		lines: [line('Webová prezentace — návrh a kódování', 1, 'projekt', 7_800_000)],
	},
];
for (const { daysAgo, client, dueDays, lines } of recent) {
	const issue = addDays(today, -daysAgo);
	const number = nextNumber(yearOf(today));
	const document = await saveDocument(
		invoiceHeader(number, client, issue, addDays(issue, dueDays), thisPeriod),
		lines,
	);
	issued.push(document);
}

// Tři dlužníci, každý jinak dlouho po splatnosti; poslední okno doplní, kdyby užší okna nic nenašla.
const debtors: string[] = [];
for (const [from, to] of [
	[60, 150],
	[20, 55],
	[3, 18],
	[0, 400],
] as const) {
	if (debtors.length >= 3) break;
	const debtor = issued.findLast(({ due, totalCents, number }) => {
		const after = daysBetween(due, today);
		return after >= from && after <= to && totalCents > 0 && !debtors.includes(number);
	});
	if (debtor) debtors.push(debtor.number);
}

const payments: Record<string, { id: string; date: DateString; amountCents: number }[]> = {};
for (const [i, document] of issued.entries()) {
	// Splatnost teprve běží, nebo klient prostě neplatí.
	if (today < document.due || debtors.includes(document.number)) continue;
	const rng = new Rng(0x00c0_ffee + i);
	const offset = rng.chance(78) ? -rng.range(0, 6) : rng.range(1, 9);
	let paid = addDays(document.due, offset);
	if (paid <= document.issue) paid = addDays(document.issue, 2);
	if (paid > today) paid = today;
	payments[document.number] = [
		{
			id: `pay-${document.number}`,
			date: paid,
			amountCents: Math.abs(document.totalCents),
		},
	];
}

const expenses = EXPENSES.map((expense) => ({
	id: expense.id,
	supplier: expense.supplier,
	...(expense.supplierIco !== undefined && { supplierIco: expense.supplierIco }),
	description: expense.description,
	amountCents: expense.czk * 100,
	date: expense.date,
	paid: true,
}));

const settings = {
	supplier: {
		name: SUPPLIER.name,
		ico: SUPPLIER.ico,
		dic: SUPPLIER.dic,
		address: SUPPLIER.address,
		registration: REGISTRATION,
		bankAccount: BANK,
		bankCode: BANK_CODE,
		iban: IBAN,
		email: SUPPLIER.email,
		defaultDueDays: 14,
		invoiceNumberFormat: '{RRRR}{NNNN}',
	},
	contacts: CLIENTS.map((client) => ({
		id: client.id,
		name: client.name,
		ico: client.ico,
		...(client.dic && { dic: client.dic }),
		address: {
			street: client.street,
			city: client.city,
			zip: client.zip,
		},
		email: client.email,
	})),
	pricelist: PRICELIST,
};

const data = join(vault, '.fakturian');
await mkdir(data, { recursive: true });
for (const [name, content] of Object.entries({
	'nastaveni.json': settings,
	'platby.json': {
		payments,
	},
	'vydaje.json': {
		expenses,
	},
})) {
	await writeFile(join(data, name), JSON.stringify(content, null, 2));
}

const year = yearOf(today);
const yearAgo = addDays(today, -365);
let thisYearCents = 0;
let rollingCents = 0;
for (const { issue, totalCents } of issued) {
	if (yearOf(issue) === year) thisYearCents += totalCents;
	if (issue > yearAgo) rollingCents += totalCents;
}
const paidCount = Object.keys(payments).length;
const seen = await listInvoices({ vaultPath: vault });
const usageLines = seen.items.reduce((sum, item) => sum + item.usageLines.length, 0);
console.log(`\nHotovo → ${vault}`);
console.log(`  appka ve složce načte: ${seen.items.length} dokladů`);
console.log(`  faktur: ${issued.length} (z toho ${creditNotes} dobropisy)`);
console.log(`  zaplaceno: ${paidCount}, nezaplaceno: ${issued.length - paidCount}`);
console.log(`  letos (${year}) vyfakturováno: ${Math.trunc(thisYearCents / 100)} Kč`);
console.log(
	`  klouzavých 12 měsíců: ${Math.trunc(rollingCents / 100)} Kč (${Math.trunc(rollingCents / 2_000_000)} % limitu 2 000 000)`,
);
console.log(`  výdajů: ${EXPENSES.length}, řádků s vazbou na ceník: ${usageLines}`);
