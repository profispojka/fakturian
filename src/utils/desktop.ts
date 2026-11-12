// Most vystavuje preload Electronu; v obyčejném prohlížeči chybí.
export function isDesktop(): boolean {
	return globalThis.fakturian !== undefined;
}

export const NOT_DESKTOP_MESSAGE =
	'Tohle je desktopová aplikace — v prohlížeči nefunguje, protože všechna data ' +
	'obsluhuje nativní vrstva. Spusť ji přes `bun run dev` (nebo z hotového .app).';
