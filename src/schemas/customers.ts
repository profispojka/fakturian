import { z, type Zod } from '~/utils/zod';

// E-mail je nepovinný: fakturu jde předat i papírem a cizí doklad ho v ISDOC většinou nenese.
export const contactSchema = z.object({
	name: z.string().trim().min(1, 'Povinné pole.'),
	ico: z.ico(),
	address: z.object({
		street: z.string().trim().min(1, 'Povinné pole.'),
		city: z.string().trim().min(1, 'Povinné pole.'),
		zip: z.zip(),
	}),
	email: z.email('Neplatný e-mail.').optional(),
});

export const contactStoredSchema = z.looseObject({
	...contactSchema.shape,
	id: z.string(),
	address: z.looseObject(contactSchema.shape.address.shape),
	note: z.string().optional(),
});

export type Contact = Zod.infer<typeof contactStoredSchema>;

export function emptyContact(): Contact {
	return {
		id: crypto.randomUUID(),
		name: '',
		ico: '',
		address: {
			street: '',
			city: '',
			zip: '',
		},
	};
}
