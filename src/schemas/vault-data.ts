import { contactStoredSchema } from '~/schemas/customers';
import { priceItemStoredSchema } from '~/schemas/pricelist';
import { supplierStoredSchema } from '~/schemas/suppliers';
import { z, type Zod } from '~/utils/zod';

// Soubory vaultu jsou textové a uživatel si do nich smí dopsat vlastní klíč. Uložená schémata jsou
// proto `looseObject`: obyčejný `z.object` by ho při načtení ořízl a první uložení smazalo.
export const vaultDataSchema = z.looseObject({
	supplier: supplierStoredSchema.nullable().default(null),
	contacts: z.array(contactStoredSchema).default([]),
	pricelist: z.array(priceItemStoredSchema).default([]),
});

export type VaultData = Zod.infer<typeof vaultDataSchema>;

export function emptyVaultData(): VaultData {
	return {
		supplier: null,
		contacts: [],
		pricelist: [],
	};
}
