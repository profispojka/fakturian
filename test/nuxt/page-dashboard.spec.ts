import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useVault } from '~/composables/useVault';
import { VAT_LIMIT_CENTS, VAT_LIMIT_IMMEDIATE_CENTS } from '~/constants/dashboard';
import { DocumentKind } from '~/constants/invoice';
import { newInvoice } from '~/schemas/invoices';
import { yearOf } from '~/utils/date';
import { czkFromCents } from '~/utils/money';

import { backend, wireInvoice } from '../setup/backend';
import { date } from '../setup/dates';
import { summary } from '../setup/fixtures';
import { mountPage, currentPath, CHART_TOKENS } from '../setup/mount';
import { documentInVault, prepareVault } from '../setup/vault';

import type { Expense } from '~/schemas/expenses';
import type { InvoiceSummary } from '~/schemas/invoices';
import type { Payments } from '~/schemas/payments';
import type { PriceItem } from '~/schemas/pricelist';
import type { PriceUsageRecord } from '~/utils/pricelist';

/**
 * Hodiny jsou zmrazené (viz `beforeEach`): „dnes" je pevné datum, ne to, co zrovna ukazuje kalendář
 * stroje.
 */
const TODAY = date('2026-08-31');
const THIS_YEAR = yearOf(TODAY);
const LONG_AGO = date('2020-01-01');
// Letošní doklad splatný dnes: Přehled ho počítá do tržeb roku, ale ne do dokladů po splatnosti.
const THIS_YEARS = {
	issueDate: date('2026-01-15'),
	dueDate: TODAY,
};

/** Graf bere barvy z CSS proměnných a test nenačítá `main.css`, takže je dodá sám. */
function mount() {
	return mountPage('/', { attrs: CHART_TOKENS });
}

beforeEach(async () => {
	// `shouldAdvanceTime`: časovače Nuxt UI a echarts musí běžet dál — zmrazit se má jen datum.
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime('2026-08-31T10:00');

	await vaultS();
});

async function vaultS(
	content: {
		invoices?: InvoiceSummary[];
		payments?: Payments;
		expenses?: Expense[];
		pricelist?: PriceItem[];
		records?: PriceUsageRecord[];
	} = {},
): Promise<void> {
	await prepareVault({
		'nastaveni.json': {
			supplier: null,
			contacts: [],
			pricelist: content.pricelist ?? [],
		},
		'platby.json': {
			payments: content.payments ?? {},
		},
		'vydaje.json': {
			expenses: content.expenses ?? [],
		},
	});
	for (const sh of content.invoices ?? []) documentInVault(sh);
	// Vykázané množství nese archiv, takže se čerpání limitu zakládá dokladem.
	for (const r of content.records ?? []) usageInVault(r);
	backend.returns('scan_vault', {
		candidates: [],
		skipped: [],
		supplier: null,
		truncated: false,
	});
}

function usageInVault(r: PriceUsageRecord): void {
	const inv = newInvoice(null, r.invoiceNumber);
	inv.issueDate = TODAY;
	inv.lines = [
		{
			id: 'r1',
			description: 'Práce',
			quantity: r.quantity,
			unit: 'hod',
			unitPriceCents: 100_000,
			itemId: r.itemId,
			usageYear: r.year,
		},
	];
	backend.folder('/vault').invoices.set(r.invoiceNumber, wireInvoice(inv));
}

function withoutFolder(): void {
	useNuxtApp().vueApp.runWithContext(useVault).vaultPath.value = null;
}

describe('načtení dokladů', () => {
	it('bez datové složky se nečte', async () => {
		withoutFolder();
		await mount();

		expect(backend.args('list_invoices')).toEqual([]);
	});

	it('chybu při čtení ohlásí místo tvrzení, že je vše zaplaceno', async () => {
		// Nula je v lednu platný stav — bez hlášky se „nic jsi nevystavil" nepozná od „nepodařilo se to přečíst".
		backend.breaks('list_invoices', 'vault je nedostupný');
		const c = await mount();

		expect(c.find('[data-testid="overview-load-error"]').text()).toBe(
			'Doklady se nepodařilo načíst: vault je nedostupný',
		);
		expect(c.find('[data-testid="overview-unpaid"]').text()).not.toContain('Vše zaplaceno');
	});
});

describe('doklady, se kterými appka nepracuje', () => {
	it('bez vadných dokladů upozornění nesvítí', async () => {
		const c = await mount();

		expect(backend.args('list_broken_received')).toEqual([{ vaultPath: '/vault' }]);
		expect(c.find('[data-testid="overview-broken-documents"]').exists()).toBe(false);
	});

	it('vyjmenuje vadné vydané faktury i přijaté doklady s důvodem', async () => {
		backend.returns('list_invoices', {
			items: [],
			broken: [
				{
					fileName: '2026001.pdf',
					path: '/vault/faktury/2026001.pdf',
					reason: 'ISDOC chybí',
				},
			],
		});
		backend.folder('/vault').brokenReceived = [
			{
				file: 'sken.pdf',
				reason: 'sken.pdf nemá čitelný vložený ISDOC',
			},
		];
		const c = await mount();

		expect(c.findAll('[data-testid="overview-broken-document"]').map((row) => row.text())).toEqual([
			'faktury/2026001.pdf — ISDOC chybí',
			'prijate/sken.pdf — sken.pdf nemá čitelný vložený ISDOC',
		]);
	});

	it('nepovedenou kontrolu složky prijate/ ohlásí', async () => {
		backend.fails('list_broken_received', 'Složku prijate/ nejde přečíst: zamčeno');
		const c = await mount();

		expect(c.find('[data-testid="overview-broken-documents"]').exists()).toBe(false);
		expect(useNuxtApp().vueApp.runWithContext(useToast).toasts.value).toContainEqual(
			expect.objectContaining({
				title: 'Složku prijate/ se nepodařilo zkontrolovat',
				description: 'Složku prijate/ nejde přečíst: zamčeno',
				color: 'error',
			}),
		);
	});
});

describe('fakturace za období', () => {
	it('přepínač nabízí měsíce, kvartály i roky', async () => {
		const c = await mount();
		const options = c
			.find('[data-testid="sales-period"]')
			.findAll('[data-slot="label"]')
			.map((b) => b.text());

		expect(options).toEqual(['Měsíce', 'Kvartály', 'Roky']);
	});

	it('přepnutí na roky změní graf', async () => {
		await vaultS({ invoices: [summary('20260001', THIS_YEARS)] });
		const c = await mount();
		const columns = () => Number(c.find('[data-testid="dashboard-revenue-chart"]').attributes('data-periods'));
		const monthlyColumns = columns();
		expect(monthlyColumns).toBe(12);

		const years = c.find('[data-testid="sales-period-year"]');
		await years.trigger('click');
		await flushPromises();

		expect(columns()).toBe(1);
	});
});

describe('bilance', () => {
	it('nabízí letos, loni i vše', async () => {
		const c = await mount();
		const options = c
			.find('[data-testid="balance-period"]')
			.findAll('[data-slot="label"]')
			.map((b) => b.text());

		expect(options).toEqual(['Letos', 'Loni', 'Vše']);
	});

	it('rozepisuje tržby na zaplacené a nezaplacené', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					...THIS_YEARS,
					totalCents: 100_000,
				}),
				summary('20260002', {
					...THIS_YEARS,
					totalCents: 50_000,
				}),
			],
			payments: {
				'20260001': [
					{
						id: 'p1',
						date: TODAY,
						amountCents: 100_000,
					},
				],
			},
		});
		const c = await mount();

		const balance = c.find('[data-testid="overview-balance"]').text();
		expect(balance).toContain(czkFromCents(100_000));
		expect(balance).toContain(czkFromCents(50_000));
	});

	it('přepnutím na „Vše" se sečtou i loňské doklady', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					...THIS_YEARS,
					issueDate: date('2020-05-05'),
					totalCents: 90_000,
				}),
			],
		});
		const c = await mount();

		const all = c.find('[data-testid="balance-period-all"]');
		await all.trigger('click');
		await flushPromises();

		expect(c.find('[data-testid="overview-balance"]').text()).toContain(czkFromCents(90_000));
	});

	it('zahrne i nákup z výdajů', async () => {
		await vaultS({
			expenses: [
				{
					id: 'v1',
					supplier: 'Server',
					description: '',
					amountCents: 30_000,
					date: date('2026-02-01'),
				},
			],
		});
		const c = await mount();

		expect(c.find('[data-testid="overview-balance"]').text()).toContain(czkFromCents(30_000));
	});
});

describe('žebříčky', () => {
	it('bez dluhů to řekne', async () => {
		const c = await mount();
		expect(c.find('[data-testid="overview-debtors"] [data-testid="empty-state"]').text()).toBe('Žádné dluhy');
	});

	it('vypíše dlužníky podle částky', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					...THIS_YEARS,
					customer: 'Dlužník',
					dueDate: LONG_AGO,
				}),
			],
		});
		const c = await mount();

		expect(c.find('[data-testid="overview-debtors"]').text()).toContain('Dlužník');
	});

	it('bez dokladů nemá ani top odběratele', async () => {
		const c = await mount();

		expect(c.text()).toContain('Zatím žádné doklady');
	});

	it('vypíše top odběratele', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					...THIS_YEARS,
					customer: 'Největší',
				}),
			],
		});
		const c = await mount();

		expect(c.find('[data-testid="overview-customers"]').text()).toContain('Největší');
	});
});

describe('limit plátcovství DPH', () => {
	it('hlídá se vždy, i bez dokladů', async () => {
		const c = await mount();

		expect(c.text()).toContain('Limit plátce DPH');
		expect(c.find('[data-testid="overview-vat-fill"]').exists()).toBe(true);
	});

	it('bez obratu je pruh v klidu', async () => {
		const c = await mount();

		expect(c.find('[data-testid="overview-vat-fill"]').attributes('data-level')).toBe('ok');
	});

	it('nad limitem je pruh v nebezpečí', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					...THIS_YEARS,
					totalCents: 2_000_000_00,
				}),
			],
		});
		const c = await mount();

		expect(c.find('[data-testid="overview-vat-fill"]').attributes('data-level')).toBe('danger');
	});

	it('před dosažením limitu ukáže varování a aktuální procento', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					...THIS_YEARS,
					totalCents: 1_600_000_00,
				}),
			],
		});
		const c = await mount();
		expect(c.find('[data-testid="overview-vat-fill"]').attributes('data-level')).toBe('warn');
		expect(c.find('[data-testid="overview-vat-fill"] [role="progressbar"]').attributes('aria-valuenow')).toBe('80');
	});

	it('pod limitem o plátcovství nic neříká', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					...THIS_YEARS,
					totalCents: 1_600_000_00,
				}),
			],
		});
		const c = await mount();

		expect(c.find('[data-testid="overview-vat-notice"]').exists()).toBe(false);
	});

	it('nad dolním prahem řekne, že plátcovství začíná 1. ledna dalšího roku', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					...THIS_YEARS,
					totalCents: 2_100_000_00,
				}),
			],
		});
		const c = await mount();

		expect(c.find('[data-testid="overview-vat-notice"]').text()).toBe(
			'Obrat překročil 2\u00a0000\u00a0000,00 Kč — plátcem DPH od 1. 1. 2027.',
		);
	});

	it('nad horním prahem řekne datum, od kterého je plátcem', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					...THIS_YEARS,
					issueDate: date('2026-06-10'),
					totalCents: 2_600_000_00,
				}),
			],
		});
		const c = await mount();

		expect(c.find('[data-testid="overview-vat-notice"]').text()).toBe(
			'Obrat překročil 2\u00a0536\u00a0500,00 Kč — plátcem DPH od 11. 6. 2026.',
		);
	});
});

describe('splatnost v nezaplacených', () => {
	it('po splatnosti zvýrazní jen fakturu, ne dobropis čekající na vrácení', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					...THIS_YEARS,
					dueDate: LONG_AGO,
				}),
				summary('20260002', {
					...THIS_YEARS,
					documentType: DocumentKind.CreditNote,
					totalCents: -121_000,
					dueDate: LONG_AGO,
					originalInvoice: '20260003',
				}),
				summary('20260003', THIS_YEARS),
			],
			payments: {
				'20260003': [
					{
						id: 'p2',
						date: date('2026-01-20'),
						amountCents: 121_000,
					},
				],
			},
		});
		const c = await mount();

		expect(c.findAll('[data-testid="overview-unpaid-due"]').map((d) => d.attributes('data-overdue'))).toEqual([
			'true',
			undefined,
		]);
	});

	it('Přehled otevřený přes půlnoc zvýrazní fakturu, která mezitím propadla', async () => {
		await vaultS({ invoices: [summary('20260001', THIS_YEARS)] });
		const c = await mount();
		expect(c.find('[data-testid="overview-unpaid-due"]').attributes('data-overdue')).toBeUndefined();

		vi.setSystemTime('2026-09-01T00:05');
		await vi.advanceTimersByTimeAsync(60_000);
		await flushPromises();

		expect(c.find('[data-testid="overview-unpaid-due"]').attributes('data-overdue')).toBe('true');
	});
});

describe('loňské plátcovství', () => {
	it('upřednostní loňské plátcovství i při letošním překročení', async () => {
		await vaultS({
			invoices: [
				summary('20250001', {
					...THIS_YEARS,
					issueDate: date('2025-06-10'),
					totalCents: 2_600_000_00,
				}),
				summary('20250002', {
					...THIS_YEARS,
					issueDate: date('2025-07-10'),
					totalCents: -700_000_00,
				}),
				summary('20260001', {
					...THIS_YEARS,
					totalCents: 2_100_000_00,
				}),
			],
		});
		const c = await mount();
		expect(c.find('[data-testid="overview-vat-notice"]').text()).toBe(
			`Obrat za rok 2025 překročil ${czkFromCents(VAT_LIMIT_IMMEDIATE_CENTS)} — plátcem DPH od 11. 6. 2025.`,
		);
	});

	it('loňské překročení hlásí i v roce, kdy letošní obrat limit nedosáhl', async () => {
		await vaultS({
			invoices: [
				summary('20250001', {
					...THIS_YEARS,
					issueDate: date('2025-11-10'),
					totalCents: 2_100_000_00,
				}),
			],
		});
		const c = await mount();

		expect(c.find('[data-testid="overview-vat-notice"]').text()).toBe(
			`Obrat za rok 2025 překročil ${czkFromCents(VAT_LIMIT_CENTS)} — plátcem DPH od 1. 1. 2026.`,
		);
	});

	it('loňské okamžité plátcovství hlásí s dnem překročení', async () => {
		await vaultS({
			invoices: [
				summary('20250001', {
					...THIS_YEARS,
					issueDate: date('2025-06-10'),
					totalCents: 2_600_000_00,
				}),
			],
		});
		const c = await mount();

		expect(c.find('[data-testid="overview-vat-notice"]').text()).toBe(
			`Obrat za rok 2025 překročil ${czkFromCents(VAT_LIMIT_IMMEDIATE_CENTS)} — plátcem DPH od 11. 6. 2025.`,
		);
	});
});

describe('blíží se splatnost', () => {
	function card(c: Awaited<ReturnType<typeof mount>>) {
		return c.find('[data-testid="overview-soon-due"]');
	}

	it('bez ničeho blízkého to řekne', async () => {
		const c = await mount();

		expect(card(c).text()).toContain('V nejbližších dnech nic');
	});

	it('vypíše nezaplacenou fakturu se splatností v příštích dnech', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					...THIS_YEARS,
					customer: 'Blízko',
					dueDate: date('2026-09-02'),
				}),
			],
		});
		const c = await mount();

		expect(card(c).text()).toContain('Blízko');
	});

	it('fakturu po splatnosti nezahrne', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					...THIS_YEARS,
					customer: 'Pozdě',
					dueDate: LONG_AGO,
				}),
			],
		});
		const c = await mount();

		expect(card(c).text()).not.toContain('Pozdě');
	});

	it('zaplacenou fakturu nezahrne, i kdyby splatnost byla blízko', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					...THIS_YEARS,
					customer: 'Uhrazeno',
					dueDate: date('2026-09-02'),
				}),
			],
			payments: {
				'20260001': [
					{
						id: 'p3',
						date: TODAY,
						amountCents: 121_000,
					},
				],
			},
		});
		const c = await mount();

		expect(card(c).text()).not.toContain('Uhrazeno');
	});

	it('klik na fakturu ji otevře', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					...THIS_YEARS,
					dueDate: date('2026-09-02'),
				}),
			],
		});
		const c = await mount();

		await card(c).find('[data-testid="overview-soon-due-open"]').trigger('click');

		await vi.waitFor(() => expect(currentPath()).toBe('/invoice/20260001'));
	});
});

describe('ceník blízko limitu', () => {
	function card(c: Awaited<ReturnType<typeof mount>>) {
		return c.find('[data-testid="overview-near-limit"]');
	}

	function item(over: Partial<PriceItem> = {}): PriceItem {
		return {
			id: 'p1',
			name: 'Dovolená',
			unit: 'hod',
			priceCents: 0,
			annualLimit: 160,
			...over,
		};
	}

	it('bez ničeho blízkého to řekne', async () => {
		const c = await mount();

		expect(card(c).text()).toContain('Nic se neblíží limitu');
	});

	it('vypíše položku blízko vyčerpání', async () => {
		await vaultS({
			pricelist: [item()],
			records: [
				{
					invoiceNumber: '20260001',
					year: THIS_YEAR,
					itemId: 'p1',
					quantity: 144,
				},
			],
		}); // 144/160 = 90 %
		const c = await mount();

		expect(card(c).text()).toContain('Dovolená');
		expect(card(c).text()).toContain('144 hod');
	});

	it('u položky s ikonkou ji vykreslí', async () => {
		await vaultS({
			pricelist: [item({ icon: 'i-lucide-tree-palm' })],
			records: [
				{
					invoiceNumber: '20260001',
					year: THIS_YEAR,
					itemId: 'p1',
					quantity: 144,
				},
			],
		});
		const c = await mount();

		expect(card(c).find('[data-testid="near-limit-icon"]').classes()).toContain('i-lucide:tree-palm');
	});

	it('položku pod prahem nevypíše', async () => {
		await vaultS({
			pricelist: [item()],
			records: [
				{
					invoiceNumber: '20260001',
					year: THIS_YEAR,
					itemId: 'p1',
					quantity: 50,
				},
			],
		}); // 50/160 ≈ 31 %
		const c = await mount();

		expect(card(c).text()).toContain('Nic se neblíží limitu');
	});

	it('položku bez limitu nevypíše, i kdyby byla vykázaná hodně', async () => {
		await vaultS({
			pricelist: [item({ annualLimit: undefined })],
			records: [
				{
					invoiceNumber: '20260001',
					year: THIS_YEAR,
					itemId: 'p1',
					quantity: 9999,
				},
			],
		});
		const c = await mount();

		expect(card(c).text()).toContain('Nic se neblíží limitu');
	});
});

describe('nezaplacené doklady', () => {
	it('bez nezaplacených to řekne', async () => {
		await vaultS({
			invoices: [summary('20260001', THIS_YEARS)],
			payments: {
				'20260001': [
					{
						id: 'p4',
						date: TODAY,
						amountCents: 121_000,
					},
				],
			},
		});
		const c = await mount();

		expect(c.find('[data-testid="overview-unpaid"]').text()).toContain('Vše zaplaceno');
	});

	it('vypíše nezaplacené i s počtem', async () => {
		await vaultS({ invoices: [summary('20260001', THIS_YEARS), summary('20260002', THIS_YEARS)] });
		const c = await mount();

		expect(c.find('[data-testid="unpaid-count"]').text()).toContain('2');
		expect(c.findAll('[data-testid="overview-unpaid-open"]').map((b) => b.text())).toEqual([
			'20260001',
			'20260002',
		]);
	});

	it('při dokladech po splatnosti je odznak červený', async () => {
		await vaultS({
			invoices: [
				summary('20260001', {
					...THIS_YEARS,
					dueDate: LONG_AGO,
				}),
			],
		});
		const c = await mount();

		expect(c.find('[data-testid="unpaid-count"]').attributes('data-overdue')).toBe('true');
	});

	it('klik na doklad ho otevře', async () => {
		await vaultS({ invoices: [summary('20260001', THIS_YEARS)] });
		const c = await mount();

		await c.find('[data-testid="overview-unpaid-open"]').trigger('click');

		await vi.waitFor(() => expect(currentPath()).toBe('/invoice/20260001'));
	});
});
