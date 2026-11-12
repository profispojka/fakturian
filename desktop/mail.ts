import { stat } from 'node:fs/promises';
import { extname } from 'node:path';

import { OSASCRIPT, run } from './system.ts';
import { requireWithin } from './vault.ts';

// Údaje zprávy si skript bere z `argv`, takže text faktury nikdy není součástí zdrojáku AppleScriptu
// a nemá co rozbít — žádné escapování uvozovek ani konců řádků.
export const COMPOSE_SCRIPT = `on run argv
    set {recipientAddress, messageSubject, messageBody, attachmentPath} to argv
    set attachmentFile to (POSIX file attachmentPath) as alias
    tell application "Mail"
        set newMessage to make new outgoing message with properties {subject:messageSubject, content:messageBody, visible:true}
        tell newMessage
            if recipientAddress is not "" then make new to recipient at end of to recipients with properties {address:recipientAddress}
            make new attachment with properties {file name:attachmentFile} at after the last paragraph
        end tell
        activate
    end tell
end run`;

// Bez toho by se přiložilo cokoli, na co cesta ukazuje — `~/.ssh/id_rsa.pdf`, cizí smlouva, doklad
// jiného účtu.
export async function checkAttachment(vaultPath: string, path: string): Promise<string> {
	if (extname(path).toLowerCase() !== '.pdf') throw new Error('Přílohou e-mailu smí být jen PDF faktury.');
	const [info] = await Promise.allSettled([stat(path)]);
	if (info.status === 'rejected' || !info.value.isFile()) {
		throw new Error(`Příloha ${path} neexistuje nebo to není soubor.`);
	}
	const attachment = await requireWithin(vaultPath, path);
	return attachment;
}

export async function mailComposeWithAttachment({
	vaultPath,
	to,
	subject,
	body,
	attachment,
}: {
	vaultPath: string;
	to: string;
	subject: string;
	body: string;
	attachment: string;
}): Promise<null> {
	const file = await checkAttachment(vaultPath, attachment);
	// Pořadí sedí s `set {…} to argv` v `COMPOSE_SCRIPT`. Argument s NUL proces nespustí, takže znak,
	// který v e-mailu stejně nic neznamená, vypadne.
	const message = [to.trim(), subject, body].map((value) => value.replaceAll('\0', ''));
	await run(OSASCRIPT, ['-e', COMPOSE_SCRIPT, ...message, file], 'Mail.app zprávu nevytvořil');
	return null;
}
