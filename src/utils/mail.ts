import { LOCALE } from '~/constants/locales';
import { czkFromCents } from '~/utils/money';

const DAYS = new Intl.NumberFormat(LOCALE, {
	style: 'unit',
	unit: 'day',
	unitDisplay: 'long',
	maximumFractionDigits: 2,
});

// Kóduje se i příjemce: adresa se do vaultu dostane i mimo formulář a nekódované
// `klient@firma.cz?bcc=utocnik@evil.example&` by se stalo další hlavičkou.
export function mailtoUrl(to: string, subject: string, body: string): string {
	const parts: string[] = [];
	if (subject) parts.push(`subject=${encodeURIComponent(subject)}`);
	if (body) parts.push(`body=${encodeURIComponent(body)}`);
	let query = '';
	if (parts.length) query = `?${parts.join('&')}`;
	return `mailto:${encodeURIComponent(to.trim()).replace(/%40/g, '@')}${query}`;
}

export function defaultInvoiceMail(number: string, totalCents: number): { subject: string; body: string } {
	return {
		subject: `Faktura ${number}`,
		body: `Dobrý den,\n\nv příloze zasílám fakturu ${number} na částku ${czkFromCents(totalCents)}.\n\nS pozdravem`,
	};
}

export function reminderMail(
	number: string,
	totalCents: number,
	daysOverdue: number,
): { subject: string; body: string } {
	const days = DAYS.format(daysOverdue);
	return {
		subject: `Upomínka: faktura ${number} po splatnosti`,
		body:
			`Dobrý den,\n\ndovoluji si připomenout fakturu ${number} na částku ` +
			`${czkFromCents(totalCents)}, která je ${days} po splatnosti.\n\n` +
			`Pokud už je uhrazena, berte prosím tuto zprávu za bezpředmětnou.\n\nS pozdravem`,
	};
}
