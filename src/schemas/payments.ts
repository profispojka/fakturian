import { today } from '~/utils/date';
import { z, type Zod } from '~/utils/zod';

// Částka je kladná i u dobropisu, kde znamená vrácené peníze. Podle `fioId` (ID pohybu z Fia)
// synchronizace pozná pohyb, který už zapsala.
export const receivedPaymentSchema = z.looseObject({
	id: z.string().min(1),
	date: z.dateString(),
	amountCents: z.number('Zadej číslo.').int('Zadej celé číslo.').positive('Zadej číslo > 0.'),
	fioId: z.string().min(1).optional(),
});

// Jen formulář: soubor s platbami nesmí přestat jít načíst kvůli posunutým hodinám.
export const paymentFormSchema = receivedPaymentSchema.extend({
	date: z.dateString().refine((date) => date <= today(), 'Platba nemůže přijít v budoucnu.'),
});

export const paymentsFileSchema = z.looseObject({
	payments: z.record(z.string(), z.array(receivedPaymentSchema)).default({}),
});

export type ReceivedPayment = Zod.infer<typeof receivedPaymentSchema>;
export type PaymentsFile = Zod.infer<typeof paymentsFileSchema>;
export type Payments = PaymentsFile['payments'];

export function emptyPayments(): PaymentsFile {
	return { payments: {} };
}
