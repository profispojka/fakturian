import { commands } from '~/bindings';
import { errorText } from '~/utils/errors';
import { mailtoUrl } from '~/utils/mail';

export function useMail() {
	const toast = useToast();
	const { requireVault } = useVault();

	async function emailWithAttachment(to: string, subject: string, body: string, attachmentPath?: string) {
		if (attachmentPath) {
			const vault = requireVault();
			try {
				await commands.mailComposeWithAttachment(vault, to, subject, body, attachmentPath);
				return;
			} catch (e) {
				// Říct se to musí — jinak by uživatel odeslal mail bez PDF.
				toast.add({
					title: 'Mail.app nevyšel — zpráva se připraví bez přílohy, PDF přetáhni z Finderu',
					description: errorText(e),
					color: 'info',
				});
			}
		}
		await commands.openUrl(mailtoUrl(to, subject, body));
		if (attachmentPath) await commands.revealPath(attachmentPath);
	}

	return { emailWithAttachment };
}
