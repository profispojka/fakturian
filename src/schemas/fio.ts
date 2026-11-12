import { z, type Zod } from '~/utils/zod';

import type { FioPayment as WireFioPayment } from '~/bindings';

const fioPaymentSchemaDefinition = z.strictObject({
	id: z.string(),
	amountCents: z.number().int(),
	vs: z.string(),
	date: z.dateString(),
	message: z.string(),
});

export type FioPayment = Zod.infer<typeof fioPaymentSchemaDefinition>;
export const fioPaymentSchema = fioPaymentSchemaDefinition satisfies Zod.ZodType<FioPayment, WireFioPayment>;
