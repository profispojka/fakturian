import { commands } from '~/bindings';
import { TRADE_REGISTER_ENTRY } from '~/constants/registration';
import { aresAnswerSchema, type AresParty } from '~/schemas/ares';
import { issuesText } from '~/utils/errors';

const ACTIVE = 'AKTIVNI';

export function parseAres(v: unknown): AresParty {
	const answer = aresAnswerSchema.safeParse(v);
	if (!answer.success) throw new Error(`Odpověď z ARES má neočekávaný tvar (${issuesText(answer.error)}).`);
	const { obchodniJmeno, ico = '', dic, sidlo = {}, seznamRegistraci = {} } = answer.data;
	// Firma bez názvu znamená odpověď v tvaru, který appka nezná — prázdná pole by přepsala rozepsané údaje.
	if (!obchodniJmeno) throw new Error('ARES k tomuto IČO nevrátil název firmy, údaje doplň ručně.');

	// Obchodní společnost mívá aktivní i živnost, ale na faktuře uvádí soud, oddíl a vložku.
	// Tu větu si doplní ručně; appka ji předvyplní jen OSVČ.
	const tradeOnly = seznamRegistraci.stavZdrojeRzp === ACTIVE && seznamRegistraci.stavZdrojeVr !== ACTIVE;

	const orientation = `${sidlo.cisloOrientacni ?? ''}${sidlo.cisloOrientacniPismeno ?? ''}`;

	let street = sidlo.textovaAdresa ?? '';
	if (sidlo.nazevUlice) {
		street = sidlo.nazevUlice;
		if (sidlo.cisloDomovni) {
			street += ` ${sidlo.cisloDomovni}`;
			if (orientation) street += `/${orientation}`;
		}
	}

	return {
		name: obchodniJmeno,
		ico,
		...(dic && { dic }),
		address: {
			street,
			city: sidlo.nazevObce ?? '',
			zip: sidlo.psc?.toString() ?? '',
		},
		registration: tradeOnly ? TRADE_REGISTER_ENTRY : '',
	};
}

// Síť (adresa, lhůta, přesměrování, stav odpovědi) obsluhuje `ares_subject` v hlavním procesu, tady
// se odpověď jen rozebere.
async function query(ico: string): Promise<AresParty> {
	const body = await commands.aresSubject(ico);
	return parseAres(body);
}

export const aresServices = { query };
