import { commands } from '~/bindings';
import { fioPaymentSchema, type FioPayment } from '~/schemas/fio';
import { issuesText } from '~/utils/errors';
import { z } from '~/utils/zod';

import type { DateString } from '~/utils/date';

export const fioServices = {
	hasToken(): Promise<boolean> {
		return commands.fioHasToken();
	},
	async setToken(token: string): Promise<void> {
		await commands.fioSetToken(token);
	},
	async clearToken(): Promise<void> {
		await commands.fioClearToken();
	},
	async fetchPayments(from: DateString, to: DateString): Promise<FioPayment[]> {
		const raw = await commands.fioFetch(from, to);
		const payments = z.array(fioPaymentSchema).safeParse(raw);
		if (!payments.success) throw new Error(`Výpis z Fia má poškozený obsah (${issuesText(payments.error)}).`);
		return payments.data;
	},
};
