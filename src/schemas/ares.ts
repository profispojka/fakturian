import { z } from '~/utils/zod';

export interface AresParty {
	name: string;
	ico: string;
	dic?: string;
	address: {
		street: string;
		city: string;
		zip: string;
	};
	registration: string;
}

// Klíče jsou tvar odpovědi ARESu. Údaj, který subjekt nemá, ARES vynechá, takže je každé pole
// nepovinné; jiný typ, než slibuje jeho API, ale odpověď odmítne celou.
const seatSchema = z.looseObject({
	nazevUlice: z.string().optional(),
	cisloDomovni: z.number().int().optional(),
	cisloOrientacni: z.number().int().optional(),
	// Písmeno čísla orientačního („14a") chodí zvlášť; bez něj vznikne adresa o dům vedle.
	cisloOrientacniPismeno: z.string().optional(),
	nazevObce: z.string().optional(),
	psc: z.number().int().optional(),
	textovaAdresa: z.string().optional(),
});

export const aresAnswerSchema = z.looseObject({
	obchodniJmeno: z.string().optional(),
	ico: z.string().optional(),
	dic: z.string().optional(),
	sidlo: seatSchema.optional(),
	seznamRegistraci: z
		.looseObject({
			stavZdrojeVr: z.string().optional(),
			stavZdrojeRzp: z.string().optional(),
		})
		.optional(),
});
