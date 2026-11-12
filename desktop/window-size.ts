// Rozvržení appky počítá s oknem aspoň takhle velkým a `bun run lint:scales` z něj bere nejmenší šířku.
// Modul nic neimportuje, aby ho načetly i nástroje v Node.
export const MIN_WINDOW_SIZE = {
	width: 760,
	height: 480,
};
